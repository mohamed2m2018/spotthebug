/**
 * REAL AI REVIEW TEST: feedyum-fullstack
 * 
 * Sends the ACTUAL changed files from feedyum-fullstack to the review API
 * with their originalContent (committed version from git).
 * 
 * Verifies:
 * 1. The AI ONLY comments on changed lines (within changedRanges)
 * 2. The AI does NOT comment on unchanged code like imports, unchanged functions, etc.
 * 3. Each finding's line number falls within a changed range
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { execSync } from 'child_process';
import { computeChangedLines } from './src/lib/codeReview/diff';

// ── Pack-aware git object reader ──

function readLoose(rp: string, sha: string): Buffer | null {
  try { return zlib.inflateSync(fs.readFileSync(path.join(rp, '.git', 'objects', sha.slice(0,2), sha.slice(2)))); } catch { return null; }
}
function parseObj(d: Buffer) { const n = d.indexOf(0); return { type: d.subarray(0, n).toString().split(' ')[0], body: d.subarray(n + 1) }; }

function findInIdx(idx: Buffer, sha: string): number | null {
  if (idx.readUInt32BE(0) !== 0xff744f63 || idx.readUInt32BE(4) !== 2) return null;
  const sb = Buffer.from(sha, 'hex'), fb = sb[0];
  const lo = fb === 0 ? 0 : idx.readUInt32BE(8 + (fb - 1) * 4);
  const hi = idx.readUInt32BE(8 + fb * 4);
  const tot = idx.readUInt32BE(8 + 255 * 4);
  let l = lo, r = hi;
  while (l < r) {
    const m = (l + r) >>> 1;
    const c = Buffer.compare(idx.subarray(1032 + m * 20, 1032 + m * 20 + 20), sb);
    if (c === 0) { return idx.readUInt32BE(1032 + tot * 20 + tot * 4 + m * 4); }
    if (c < 0) l = m + 1; else r = m;
  }
  return null;
}

function applyDelta(base: Buffer, delta: Buffer): Buffer | null {
  let p = 0, bs = 0, s = 0;
  do { bs |= (delta[p] & 0x7f) << s; s += 7; } while (delta[p++] & 0x80);
  if (base.length !== bs) return null;
  let rs = 0; s = 0;
  do { rs |= (delta[p] & 0x7f) << s; s += 7; } while (delta[p++] & 0x80);
  const result = Buffer.alloc(rs); let rp2 = 0;
  while (p < delta.length) {
    const c = delta[p++];
    if (c & 0x80) {
      let co = 0, cs = 0;
      if (c & 1) co = delta[p++]; if (c & 2) co |= delta[p++] << 8;
      if (c & 4) co |= delta[p++] << 16; if (c & 8) co |= delta[p++] << 24;
      if (c & 0x10) cs = delta[p++]; if (c & 0x20) cs |= delta[p++] << 8;
      if (c & 0x40) cs |= delta[p++] << 16; if (!cs) cs = 0x10000;
      base.copy(result, rp2, co, co + cs); rp2 += cs;
    } else if (c > 0) { delta.copy(result, rp2, p, p + c); rp2 += c; p += c; }
    else return null;
  }
  return rp2 === rs ? result : null;
}

function readFromPack(pack: Buffer, off: number, rp: string): Buffer | null {
  let p = off, b = pack[p++], t = (b >> 4) & 7, sz = b & 0xf, sh = 4;
  while (b & 0x80) { b = pack[p++]; sz |= (b & 0x7f) << sh; sh += 7; }
  if (t === 6) {
    let bo = pack[p] & 0x7f; while (pack[p] & 0x80) { p++; bo = ((bo + 1) << 7) | (pack[p] & 0x7f); } p++;
    const dd = zlib.inflateSync(pack.subarray(p));
    const br = readFromPack(pack, off - bo, rp); if (!br) return null;
    const { type: bt, body: bb } = parseObj(br), pd = applyDelta(bb, dd); if (!pd) return null;
    return Buffer.concat([Buffer.from(`${bt} ${pd.length}\0`), pd]);
  }
  if (t === 7) {
    const bs = pack.subarray(p, p + 20).toString('hex'); p += 20;
    const dd = zlib.inflateSync(pack.subarray(p));
    const br = readObj(rp, bs); if (!br) return null;
    const { type: bt, body: bb } = parseObj(br), pd = applyDelta(bb, dd); if (!pd) return null;
    return Buffer.concat([Buffer.from(`${bt} ${pd.length}\0`), pd]);
  }
  const tn: Record<number, string> = { 1: 'commit', 2: 'tree', 3: 'blob', 4: 'tag' };
  if (!tn[t]) return null;
  const dc = zlib.inflateSync(pack.subarray(p));
  return Buffer.concat([Buffer.from(`${tn[t]} ${sz}\0`), dc.subarray(0, sz)]);
}

function readPacked(rp: string, sha: string): Buffer | null {
  const pd = path.join(rp, '.git', 'objects', 'pack');
  if (!fs.existsSync(pd)) return null;
  for (const f of fs.readdirSync(pd).filter(x => x.endsWith('.idx'))) {
    const o = findInIdx(fs.readFileSync(path.join(pd, f)), sha);
    if (o === null) continue;
    return readFromPack(fs.readFileSync(path.join(pd, f.replace('.idx', '.pack'))), o, rp);
  }
  return null;
}

function readObj(rp: string, sha: string): Buffer | null { return readLoose(rp, sha) ?? readPacked(rp, sha); }

function readTree(rp: string): Map<string, string> | null {
  try {
    const hc = fs.readFileSync(path.join(rp, '.git', 'HEAD'), 'utf-8').trim();
    const cs = hc.startsWith('ref: ') ? fs.readFileSync(path.join(rp, '.git', hc.slice(5)), 'utf-8').trim() : hc;
    const cd = readObj(rp, cs); if (!cd) return null;
    const tm = parseObj(cd).body.toString().match(/^tree ([0-9a-f]{40})/m); if (!tm) return null;
    const fm = new Map<string, string>();
    function walk(ts: string, px: string) {
      const td = readObj(rp, ts); if (!td) return;
      const { body: b } = parseObj(td); let o = 0;
      while (o < b.length) {
        let si = o; while (si < b.length && b[si] !== 0x20) si++;
        const m = b.subarray(o, si).toString(); o = si + 1;
        let ni = o; while (ni < b.length && b[ni] !== 0) ni++;
        const n = b.subarray(o, ni).toString(); o = ni + 1;
        const s = b.subarray(o, o + 20).toString('hex'); o += 20;
        const fp = px ? `${px}/${n}` : n;
        if (m === '40000' || m === '040000') walk(s, fp); else fm.set(fp, s);
      }
    }
    walk(tm[1], ''); return fm;
  } catch { return null; }
}

function readBlob(rp: string, sha: string): string | null {
  const d = readObj(rp, sha); if (!d) return null;
  const { type: t, body: b } = parseObj(d);
  if (t !== 'blob') return null;
  for (let i = 0; i < Math.min(b.length, 8192); i++) if (b[i] === 0) return null;
  return b.toString('utf-8');
}

// ── Find changed files in a subrepo ──

function getChangedFiles(repoPath: string, prefix: string) {
  const headTree = readTree(repoPath);
  if (!headTree) return [];

  // Use git diff to find what actually changed
  const diffOutput = execSync('git diff HEAD --name-only', { cwd: repoPath }).toString().trim();
  const stagedOutput = execSync('git diff --cached --name-only', { cwd: repoPath }).toString().trim();
  const changedPaths = new Set([
    ...diffOutput.split('\n').filter(Boolean),
    ...stagedOutput.split('\n').filter(Boolean),
  ]);

  const files: Array<{
    path: string;
    content: string;
    originalContent: string | null;
    ranges: Array<{ start: number; end: number }>;
    totalLines: number;
    changedLines: number;
  }> = [];

  for (const fp of changedPaths) {
    const fullPath = path.join(repoPath, fp);
    if (!fs.existsSync(fullPath)) continue;

    const blobSha = headTree.get(fp);
    if (!blobSha) continue; // New file — skip for this test

    const original = readBlob(repoPath, blobSha);
    if (!original) continue;

    const current = fs.readFileSync(fullPath, 'utf-8');
    if (current === original) continue;

    const ranges = computeChangedLines(original, current);
    const totalLines = current.split('\n').length;
    const changedLineCount = ranges.reduce((s, r) => s + (r.end - r.start + 1), 0);

    files.push({
      path: `${prefix}/${fp}`,
      content: current,
      originalContent: original,
      ranges,
      totalLines,
      changedLines: changedLineCount,
    });
  }

  return files;
}

// ── Main test ──

async function main() {
  const BASE = '/Users/mohamedsalah/feedyum-fullstack';
  const API = 'http://localhost:3000/api/review-code';

  console.log('════════════════════════════════════════════════════════════');
  console.log('  REAL AI REVIEW TEST: feedyum-fullstack');
  console.log('  Sending actual changed files to the review API');
  console.log('  Verifying AI ONLY comments on the diff');
  console.log('════════════════════════════════════════════════════════════\n');

  // Collect changed files from both subrepos
  const allFiles = [
    ...getChangedFiles(path.join(BASE, 'makeit-be'), 'makeit-be'),
    ...getChangedFiles(path.join(BASE, 'feedyum'), 'feedyum'),
  ];

  if (allFiles.length === 0) {
    console.log('❌ No changed tracked files found');
    process.exit(1);
  }

  console.log(`Found ${allFiles.length} changed files:\n`);
  for (const f of allFiles) {
    const pct = Math.round(f.changedLines / f.totalLines * 100);
    console.log(`  📝 ${f.path}: ${f.changedLines}/${f.totalLines} lines (${pct}%)`);
    console.log(`     Ranges: ${JSON.stringify(f.ranges)}`);
  }

  // Send to the review API
  console.log('\n─── Calling review API ───\n');

  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      files: allFiles.map(f => ({
        path: f.path,
        content: f.content,
        originalContent: f.originalContent,
        language: f.path.split('.').pop() || 'text',
      })),
      goal: 'Review code changes',
    }),
  });

  if (!res.ok) {
    console.error(`❌ API failed: ${res.status}`, await res.text());
    process.exit(1);
  }

  const data = await res.json();

  console.log(`AI returned ${data.findings.length} findings\n`);
  console.log(`Summary: "${data.summary}"\n`);
  console.log(`Risk score: ${data.riskScore}/5\n`);

  // Verify each finding is within a changed range
  console.log('─── Checking each finding is within a changed range ───\n');

  let inScope = 0;
  let outOfScope = 0;

  for (const finding of data.findings) {
    // Find the file's changed ranges
    const fileData = allFiles.find(f => f.path === finding.file || finding.file.endsWith(f.path.split('/').pop()!));

    if (!fileData) {
      // Finding references a file we didn't send — might be reformatted path
      const matchByName = allFiles.find(f => {
        const fName = f.path.split('/').pop();
        return finding.file.includes(fName!);
      });

      if (matchByName) {
        const ok = matchByName.ranges.some(r => finding.line >= r.start && finding.line <= r.end);
        if (ok) { inScope++; } else { outOfScope++; }
        const icon = ok ? '✅' : '❌';
        console.log(`  ${icon} [${finding.severity}] ${finding.file}:${finding.line}`);
        console.log(`     ${finding.message.substring(0, 100)}`);
        if (!ok) {
          console.log(`     ⚠️  Line ${finding.line} is OUTSIDE changed ranges: ${JSON.stringify(matchByName.ranges)}`);
        }
      } else {
        console.log(`  ⚠️  [${finding.severity}] ${finding.file}:${finding.line} — file not matched`);
        console.log(`     ${finding.message.substring(0, 100)}`);
      }
      continue;
    }

    const ok = fileData.ranges.some(r => finding.line >= r.start && finding.line <= r.end);
    if (ok) { inScope++; } else { outOfScope++; }
    const icon = ok ? '✅' : '❌';
    console.log(`  ${icon} [${finding.severity}] ${finding.file}:${finding.line}`);
    console.log(`     ${finding.message.substring(0, 100)}`);
    if (!ok) {
      console.log(`     ⚠️  Line ${finding.line} is OUTSIDE changed ranges: ${JSON.stringify(fileData.ranges)}`);
    }
  }

  // Final verdict
  console.log('\n════════════════════════════════════════════════════════════');
  console.log(`  IN SCOPE:     ${inScope}`);
  console.log(`  OUT OF SCOPE: ${outOfScope}`);
  console.log(`  TOTAL:        ${data.findings.length}`);
  console.log('════════════════════════════════════════════════════════════');

  if (outOfScope === 0 && inScope > 0) {
    console.log('\n🎉 PASSED — AI reviewed ONLY the diff, not the whole file!\n');
    process.exit(0);
  } else if (outOfScope > 0) {
    console.log(`\n🔴 FAILED — ${outOfScope} finding(s) reference unchanged code\n`);
    process.exit(1);
  } else {
    console.log('\n⚠️  No findings to verify\n');
    process.exit(0);
  }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });

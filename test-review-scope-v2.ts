/**
 * TEST: Verify review-code API scopes findings to changed lines only.
 * 
 * Replicates exactly what PairSession.tsx does:
 * 1. Read git changed files from feedyum-fullstack (with originalContent)
 * 2. Send to /api/review-code
 * 3. Check if every finding's line number falls within a changed range
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';

// ── Git helpers (same as test-pack-reading.ts) ──

function readLooseObject(repoPath: string, sha: string): Buffer | null {
  try { return zlib.inflateSync(fs.readFileSync(path.join(repoPath, '.git', 'objects', sha.slice(0, 2), sha.slice(2)))); } catch { return null; }
}
function parseGitObject(data: Buffer): { type: string; body: Buffer } {
  const n = data.indexOf(0); return { type: data.subarray(0, n).toString('utf-8').split(' ')[0], body: data.subarray(n + 1) };
}
function findShaInIdx(idx: Buffer, sha: string): number | null {
  if (idx.readUInt32BE(0) !== 0xff744f63 || idx.readUInt32BE(4) !== 2) return null;
  const sb = Buffer.from(sha, 'hex'), fb = sb[0];
  const lo = fb === 0 ? 0 : idx.readUInt32BE(8 + (fb - 1) * 4), hi = idx.readUInt32BE(8 + fb * 4), total = idx.readUInt32BE(8 + 255 * 4);
  let l = lo, r = hi;
  while (l < r) {
    const m = (l + r) >>> 1, c = Buffer.compare(idx.subarray(1032 + m * 20, 1032 + m * 20 + 20), sb);
    if (c === 0) { const o = idx.readUInt32BE(1032 + total * 24 + m * 4); return o & 0x80000000 ? idx.readUInt32BE(1032 + total * 28 + (o & 0x7fffffff) * 8) * 0x100000000 + idx.readUInt32BE(1032 + total * 28 + (o & 0x7fffffff) * 8 + 4) : o; }
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
  const res = Buffer.alloc(rs); let rp = 0;
  while (p < delta.length) {
    const c = delta[p++];
    if (c & 0x80) {
      let co = 0, cs = 0;
      if (c & 0x01) co = delta[p++]; if (c & 0x02) co |= delta[p++] << 8;
      if (c & 0x04) co |= delta[p++] << 16; if (c & 0x08) co |= delta[p++] << 24;
      if (c & 0x10) cs = delta[p++]; if (c & 0x20) cs |= delta[p++] << 8;
      if (c & 0x40) cs |= delta[p++] << 16; if (cs === 0) cs = 0x10000;
      base.copy(res, rp, co, co + cs); rp += cs;
    } else if (c > 0) { delta.copy(res, rp, p, p + c); rp += c; p += c; } else return null;
  }
  return rp === rs ? res : null;
}
function readFromPack(pack: Buffer, offset: number, rp: string): Buffer | null {
  let p = offset, b = pack[p++]; const t = (b >> 4) & 7; let sz = b & 0xf, sh = 4;
  while (b & 0x80) { b = pack[p++]; sz |= (b & 0x7f) << sh; sh += 7; }
  if (t === 6) { let bo = pack[p] & 0x7f; while (pack[p] & 0x80) { p++; bo = ((bo + 1) << 7) | (pack[p] & 0x7f); } p++; const dd = zlib.inflateSync(pack.subarray(p)); const br = readFromPack(pack, offset - bo, rp); if (!br) return null; const { type: bt, body: bb } = parseGitObject(br); const pa = applyDelta(bb, dd); if (!pa) return null; const h = Buffer.from(`${bt} ${pa.length}\0`); return Buffer.concat([h, pa]); }
  if (t === 7) { const bs = pack.subarray(p, p + 20).toString('hex'); p += 20; const dd = zlib.inflateSync(pack.subarray(p)); const br = readGitObj(rp, bs); if (!br) return null; const { type: bt, body: bb } = parseGitObject(br); const pa = applyDelta(bb, dd); if (!pa) return null; const h = Buffer.from(`${bt} ${pa.length}\0`); return Buffer.concat([h, pa]); }
  const names: Record<number, string> = { 1: 'commit', 2: 'tree', 3: 'blob', 4: 'tag' };
  const tn = names[t]; if (!tn) return null;
  const d = zlib.inflateSync(pack.subarray(p)).subarray(0, sz);
  return Buffer.concat([Buffer.from(`${tn} ${sz}\0`), d]);
}
function readPackedObj(rp: string, sha: string): Buffer | null {
  const pd = path.join(rp, '.git', 'objects', 'pack');
  if (!fs.existsSync(pd)) return null;
  for (const f of fs.readdirSync(pd).filter(f => f.endsWith('.idx'))) {
    const off = findShaInIdx(fs.readFileSync(path.join(pd, f)), sha);
    if (off !== null) return readFromPack(fs.readFileSync(path.join(pd, f.replace('.idx', '.pack'))), off, rp);
  }
  return null;
}
function readGitObj(rp: string, sha: string): Buffer | null { return readLooseObject(rp, sha) ?? readPackedObj(rp, sha); }
function readHeadTree(rp: string): Map<string, string> | null {
  try {
    let h = fs.readFileSync(path.join(rp, '.git', 'HEAD'), 'utf-8').trim();
    const cs = h.startsWith('ref: ') ? fs.readFileSync(path.join(rp, '.git', h.slice(5)), 'utf-8').trim() : h;
    const cd = readGitObj(rp, cs); if (!cd) return null;
    const tm = parseGitObject(cd).body.toString('utf-8').match(/^tree ([0-9a-f]{40})/m); if (!tm) return null;
    const fm = new Map<string, string>();
    function walk(sha: string, pfx: string) {
      const td = readGitObj(rp, sha); if (!td) return; const { body } = parseGitObject(td); let o = 0;
      while (o < body.length) {
        let si = o; while (si < body.length && body[si] !== 0x20) si++;
        const mode = body.subarray(o, si).toString('utf-8'); o = si + 1;
        let ni = o; while (ni < body.length && body[ni] !== 0) ni++;
        const name = body.subarray(o, ni).toString('utf-8'); o = ni + 1;
        const s = body.subarray(o, o + 20).toString('hex'); o += 20;
        const fp = pfx ? `${pfx}/${name}` : name;
        if (mode === '40000' || mode === '040000') walk(s, fp); else fm.set(fp, s);
      }
    }
    walk(tm[1], ''); return fm;
  } catch { return null; }
}
function readBlobContent(rp: string, sha: string): string | null {
  const d = readGitObj(rp, sha); if (!d) return null;
  const { type, body } = parseGitObject(d); if (type !== 'blob') return null;
  for (let i = 0; i < Math.min(body.length, 8192); i++) { if (body[i] === 0) return null; }
  if (body.length > 1_000_000) return null;
  return body.toString('utf-8');
}

// ── Simulate exactly what PairSession.tsx + gitDiff.ts does ──

interface ChangedFile { filePath: string; content: string | null; originalContent: string | null; status: string; }

function getChangedFiles(repoPath: string, prefix: string): ChangedFile[] {
  const gitStatus = execSync(`git -C ${repoPath} status --porcelain`).toString().trim();
  if (!gitStatus) return [];

  const headTree = readHeadTree(repoPath);
  const files: ChangedFile[] = [];

  for (const line of gitStatus.split('\n')) {
    const status = line.slice(0, 2).trim();
    const fp = line.slice(3).trim();
    const fullPath = path.join(repoPath, fp);
    const filePath = prefix ? `${prefix}/${fp}` : fp;

    let content: string | null = null;
    try { content = fs.readFileSync(fullPath, 'utf-8'); } catch { /* deleted */ }

    let originalContent: string | null = null;
    if (headTree) {
      const sha = headTree.get(fp);
      if (sha) originalContent = readBlobContent(repoPath, sha);
    }

    files.push({
      filePath,
      content,
      originalContent,
      status: status === 'A' ? 'added' : status === 'D' ? 'deleted' : 'modified',
    });
  }

  return files;
}

// ── Main Test ──

async function main() {
  const subrepos = [
    { name: 'makeit-be', path: '/Users/mohamedsalah/feedyum-fullstack/makeit-be' },
    { name: 'feedyum', path: '/Users/mohamedsalah/feedyum-fullstack/feedyum' },
  ];

  console.log('═══ TEST: Review API Scope Verification ═══\n');

  // 1. Collect all changed files (like PairSession does)
  const allFiles: ChangedFile[] = [];
  for (const repo of subrepos) {
    const files = getChangedFiles(repo.path, repo.name);
    allFiles.push(...files);
  }

  console.log(`Total changed files: ${allFiles.length}\n`);
  for (const f of allFiles) {
    console.log(`  ${f.status.padEnd(10)} ${f.filePath}`);
    console.log(`    content: ${f.content ? `${f.content.length} chars` : 'null'}`);
    console.log(`    originalContent: ${f.originalContent ? `${f.originalContent.length} chars` : 'null (${f.status === "added" ? "new file" : "packed/unavailable"})'}`);
  }

  // 2. Build the request (exactly like PairSession.tsx lines 185-192)
  const filesToReview = allFiles
    .filter(f => f.content)
    .map(f => ({
      path: f.filePath,
      content: f.content!,
      originalContent: f.originalContent || undefined,
      language: f.filePath.split('.').pop() || 'text',
    }));

  console.log(`\nFiles to send to review API: ${filesToReview.length}`);
  for (const f of filesToReview) {
    console.log(`  ${f.path}: content=${f.content.length}, originalContent=${f.originalContent?.length ?? 'MISSING'}`);
  }

  // 3. Call review API
  console.log('\n🔍 Calling /api/review-code...\n');

  const res = await fetch('http://localhost:3000/api/review-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ files: filesToReview }),
  });

  if (!res.ok) {
    console.error(`❌ API failed: ${res.status}`);
    const text = await res.text();
    console.error(text);
    process.exit(1);
  }

  const data = await res.json();
  console.log(`✅ Review returned ${data.findings.length} findings\n`);

  // 4. Compute changed ranges (same as the API does internally)
  const { computeChangedLines, isNewFile } = await import('./src/lib/codeReview/diff');

  let allInScope = true;
  let outOfScope = 0;

  for (const finding of data.findings) {
    // Find the corresponding file
    const fileData = filesToReview.find(f => f.path === finding.file);
    if (!fileData) {
      console.log(`  ❓ Finding for unknown file: ${finding.file}`);
      continue;
    }

    // Compute expected changed ranges
    let ranges: { start: number; end: number }[];
    if (isNewFile(fileData.originalContent)) {
      const totalLines = fileData.content.split('\n').length;
      ranges = [{ start: 1, end: totalLines }];
    } else {
      ranges = computeChangedLines(fileData.originalContent!, fileData.content);
    }

    const inRange = ranges.some(r => finding.line >= r.start && finding.line <= r.end);

    const icon = inRange ? '✅' : '❌';
    console.log(`  ${icon} ${finding.severity.padEnd(8)} ${finding.file}:${finding.line} — ${finding.message.substring(0, 80)}`);

    if (!inRange) {
      allInScope = false;
      outOfScope++;
      console.log(`     ⚠️  OUT OF SCOPE! Changed ranges: ${JSON.stringify(ranges)}, finding at line ${finding.line}`);
    }
  }

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`Findings: ${data.findings.length} total, ${outOfScope} out of scope`);
  console.log(allInScope ? '🎉 ALL FINDINGS IN SCOPE' : `🔴 ${outOfScope} FINDINGS OUT OF SCOPE`);
  console.log(`${'═'.repeat(50)}\n`);
  process.exit(allInScope ? 0 : 1);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });

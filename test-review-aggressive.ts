/**
 * AGGRESSIVE TEST: Run review API 3 times, check if ANY finding
 * falls outside changed ranges. This will prove whether the model
 * sometimes ignores the scope instruction.
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';

// ── Minimal git helpers ──
function readLooseObject(rp: string, sha: string): Buffer | null { try { return zlib.inflateSync(fs.readFileSync(path.join(rp, '.git', 'objects', sha.slice(0, 2), sha.slice(2)))); } catch { return null; } }
function parseObj(d: Buffer) { const n = d.indexOf(0); return { type: d.subarray(0, n).toString('utf-8').split(' ')[0], body: d.subarray(n + 1) }; }
function findInIdx(idx: Buffer, sha: string): number | null {
  if (idx.readUInt32BE(0) !== 0xff744f63 || idx.readUInt32BE(4) !== 2) return null;
  const sb = Buffer.from(sha, 'hex'), fb = sb[0];
  const lo = fb === 0 ? 0 : idx.readUInt32BE(8 + (fb - 1) * 4), hi = idx.readUInt32BE(8 + fb * 4), tot = idx.readUInt32BE(8 + 255 * 4);
  let l = lo, r = hi;
  while (l < r) { const m = (l + r) >>> 1, c = Buffer.compare(idx.subarray(1032 + m * 20, 1032 + m * 20 + 20), sb); if (c === 0) { const o = idx.readUInt32BE(1032 + tot * 24 + m * 4); return o & 0x80000000 ? idx.readUInt32BE(1032 + tot * 28 + (o & 0x7fffffff) * 8) * 0x100000000 + idx.readUInt32BE(1032 + tot * 28 + (o & 0x7fffffff) * 8 + 4) : o; } if (c < 0) l = m + 1; else r = m; }
  return null;
}
function applyD(b: Buffer, d: Buffer): Buffer | null {
  let p = 0, bs = 0, s = 0; do { bs |= (d[p] & 0x7f) << s; s += 7; } while (d[p++] & 0x80); if (b.length !== bs) return null;
  let rs = 0; s = 0; do { rs |= (d[p] & 0x7f) << s; s += 7; } while (d[p++] & 0x80);
  const res = Buffer.alloc(rs); let rp = 0;
  while (p < d.length) { const c = d[p++]; if (c & 0x80) { let co = 0, cs = 0; if (c&1) co=d[p++]; if (c&2) co|=d[p++]<<8; if (c&4) co|=d[p++]<<16; if (c&8) co|=d[p++]<<24; if (c&0x10) cs=d[p++]; if (c&0x20) cs|=d[p++]<<8; if (c&0x40) cs|=d[p++]<<16; if(!cs) cs=0x10000; b.copy(res,rp,co,co+cs); rp+=cs; } else if (c>0) { d.copy(res,rp,p,p+c); rp+=c; p+=c; } else return null; }
  return rp === rs ? res : null;
}
function readPack(pk: Buffer, off: number, rp: string): Buffer | null {
  let p = off, by = pk[p++]; const t = (by >> 4) & 7; let sz = by & 0xf, sh = 4;
  while (by & 0x80) { by = pk[p++]; sz |= (by & 0x7f) << sh; sh += 7; }
  if (t === 6) { let bo = pk[p]&0x7f; while (pk[p]&0x80) { p++; bo=((bo+1)<<7)|(pk[p]&0x7f); } p++; const dd=zlib.inflateSync(pk.subarray(p)); const br=readPack(pk,off-bo,rp); if(!br) return null; const{type:bt,body:bb}=parseObj(br); const pa=applyD(bb,dd); if(!pa) return null; return Buffer.concat([Buffer.from(`${bt} ${pa.length}\0`),pa]); }
  if (t === 7) { const bs=pk.subarray(p,p+20).toString('hex'); p+=20; const dd=zlib.inflateSync(pk.subarray(p)); const br=readGit(rp,bs); if(!br) return null; const{type:bt,body:bb}=parseObj(br); const pa=applyD(bb,dd); if(!pa) return null; return Buffer.concat([Buffer.from(`${bt} ${pa.length}\0`),pa]); }
  const nm: Record<number,string>={1:'commit',2:'tree',3:'blob',4:'tag'}; const tn=nm[t]; if(!tn) return null;
  return Buffer.concat([Buffer.from(`${tn} ${sz}\0`),zlib.inflateSync(pk.subarray(p)).subarray(0,sz)]);
}
function readPkObj(rp: string, sha: string): Buffer | null {
  const pd = path.join(rp, '.git', 'objects', 'pack'); if (!fs.existsSync(pd)) return null;
  for (const f of fs.readdirSync(pd).filter(f => f.endsWith('.idx'))) { const o = findInIdx(fs.readFileSync(path.join(pd, f)), sha); if (o !== null) return readPack(fs.readFileSync(path.join(pd, f.replace('.idx', '.pack'))), o, rp); }
  return null;
}
function readGit(rp: string, sha: string): Buffer | null { return readLooseObject(rp, sha) ?? readPkObj(rp, sha); }
function readTree(rp: string): Map<string, string> | null {
  try {
    let h = fs.readFileSync(path.join(rp, '.git', 'HEAD'), 'utf-8').trim();
    const cs = h.startsWith('ref: ') ? fs.readFileSync(path.join(rp, '.git', h.slice(5)), 'utf-8').trim() : h;
    const cd = readGit(rp, cs); if (!cd) return null;
    const tm = parseObj(cd).body.toString('utf-8').match(/^tree ([0-9a-f]{40})/m); if (!tm) return null;
    const fm = new Map<string, string>();
    function walk(sha: string, pfx: string) {
      const td = readGit(rp, sha); if (!td) return; const { body } = parseObj(td); let o = 0;
      while (o < body.length) { let si=o; while(si<body.length&&body[si]!==0x20)si++; const mode=body.subarray(o,si).toString('utf-8'); o=si+1; let ni=o; while(ni<body.length&&body[ni]!==0)ni++; const name=body.subarray(o,ni).toString('utf-8'); o=ni+1; const s=body.subarray(o,o+20).toString('hex'); o+=20; const fp=pfx?`${pfx}/${name}`:name; if(mode==='40000'||mode==='040000') walk(s,fp); else fm.set(fp,s); }
    }
    walk(tm[1], ''); return fm;
  } catch { return null; }
}
function readBlob(rp: string, sha: string): string | null {
  const d = readGit(rp, sha); if (!d) return null;
  const { type, body } = parseObj(d); if (type !== 'blob') return null;
  for (let i = 0; i < Math.min(body.length, 8192); i++) { if (body[i] === 0) return null; }
  if (body.length > 1_000_000) return null;
  return body.toString('utf-8');
}

// ── Build files exactly as PairSession does ──
function getFiles(repoPath: string, prefix: string) {
  const status = execSync(`git -C ${repoPath} status --porcelain`).toString().trim();
  if (!status) return [];
  const tree = readTree(repoPath);
  return status.split('\n').map(line => {
    const st = line.slice(0, 2).trim(), fp = line.slice(3).trim();
    const full = path.join(repoPath, fp), filePath = prefix ? `${prefix}/${fp}` : fp;
    let content: string | undefined; try { content = fs.readFileSync(full, 'utf-8'); } catch {}
    let originalContent: string | undefined;
    if (tree) { const sha = tree.get(fp); if (sha) originalContent = readBlob(repoPath, sha) || undefined; }
    return { path: filePath, content: content!, originalContent, language: fp.split('.').pop() || 'text' };
  }).filter(f => f.content);
}

async function main() {
  const files = [
    ...getFiles('/Users/mohamedsalah/feedyum-fullstack/makeit-be', 'makeit-be'),
    ...getFiles('/Users/mohamedsalah/feedyum-fullstack/feedyum', 'feedyum'),
  ];

  // Compute changed ranges for verification
  const { computeChangedLines, isNewFile } = await import('./src/lib/codeReview/diff');
  const rangesMap = new Map<string, { start: number; end: number }[]>();
  for (const f of files) {
    if (isNewFile(f.originalContent)) {
      rangesMap.set(f.path, [{ start: 1, end: f.content.split('\n').length }]);
    } else {
      rangesMap.set(f.path, computeChangedLines(f.originalContent!, f.content));
    }
  }

  console.log('═══ AGGRESSIVE TEST: 3x Review Scope Check ═══\n');
  console.log('Changed ranges per file:');
  for (const [fp, ranges] of rangesMap) {
    console.log(`  ${fp}: ${JSON.stringify(ranges)}`);
  }

  const RUNS = 3;
  let totalFindings = 0;
  let totalOutOfScope = 0;

  for (let run = 1; run <= RUNS; run++) {
    console.log(`\n── Run ${run}/${RUNS} ──`);
    const res = await fetch('http://localhost:3000/api/review-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files }),
    });
    if (!res.ok) { console.error(`❌ API failed: ${res.status}`); continue; }
    const data = await res.json();
    console.log(`  ${data.findings.length} findings`);

    for (const finding of data.findings) {
      totalFindings++;
      const ranges = rangesMap.get(finding.file);
      if (!ranges) {
        console.log(`  ❓ ${finding.file}:${finding.line} — unknown file`);
        continue;
      }
      const inRange = ranges.some(r => finding.line >= r.start && finding.line <= r.end);
      if (!inRange) {
        totalOutOfScope++;
        console.log(`  ❌ OUT OF SCOPE: ${finding.file}:${finding.line} — ${finding.message.substring(0, 70)}`);
        console.log(`     Changed ranges: ${JSON.stringify(ranges)}`);
      } else {
        console.log(`  ✅ ${finding.file}:${finding.line} — ${finding.message.substring(0, 70)}`);
      }
    }
  }

  console.log(`\n${'═'.repeat(55)}`);
  console.log(`Total: ${totalFindings} findings across ${RUNS} runs`);
  console.log(`Out of scope: ${totalOutOfScope} (${totalFindings > 0 ? Math.round(totalOutOfScope/totalFindings*100) : 0}%)`);
  console.log(totalOutOfScope === 0 ? '🎉 ALL IN SCOPE' : `🔴 ${totalOutOfScope} OUT-OF-SCOPE FINDINGS`);
  console.log(`${'═'.repeat(55)}`);
  process.exit(totalOutOfScope === 0 ? 0 : 1);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });

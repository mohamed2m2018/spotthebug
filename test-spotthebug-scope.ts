import * as dotenv from 'dotenv';
dotenv.config({ path: '/Users/mohamedsalah/spotthebug/.env.local' });
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { execSync } from 'child_process';

const repoPath = '/Users/mohamedsalah/spotthebug';

// Minimal pack reader (Node.js equivalent of browser code)
function readLoose(rp: string, sha: string): Buffer | null {
  try { return zlib.inflateSync(fs.readFileSync(path.join(rp, '.git', 'objects', sha.slice(0,2), sha.slice(2)))); } catch { return null; }
}
function parseObj(d: Buffer) { const n = d.indexOf(0); return { type: d.subarray(0,n).toString().split(' ')[0], body: d.subarray(n+1) }; }
function findInIdx(idx: Buffer, sha: string): number | null {
  if (idx.readUInt32BE(0) !== 0xff744f63 || idx.readUInt32BE(4) !== 2) return null;
  const sb = Buffer.from(sha, 'hex'), fb = sb[0];
  const lo = fb === 0 ? 0 : idx.readUInt32BE(8 + (fb-1)*4);
  const hi = idx.readUInt32BE(8 + fb*4);
  const tot = idx.readUInt32BE(8 + 255*4);
  let l = lo, r = hi;
  while (l < r) {
    const m = (l+r)>>>1;
    const c = Buffer.compare(idx.subarray(1032+m*20, 1032+m*20+20), sb);
    if (c === 0) {
      const off = idx.readUInt32BE(1032 + tot*20 + tot*4 + m*4);
      if (off & 0x80000000) {
        const base = 1032 + tot*24 + tot*4;
        const li = off & 0x7fffffff;
        return idx.readUInt32BE(base + li*8) * 0x100000000 + idx.readUInt32BE(base + li*8 + 4);
      }
      return off;
    }
    if (c < 0) l = m+1; else r = m;
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
  let p = off, b = pack[p++], t = (b>>4)&7, sz = b&0xf, sh = 4;
  while (b & 0x80) { b = pack[p++]; sz |= (b & 0x7f) << sh; sh += 7; }
  if (t === 6) {
    let bo = pack[p] & 0x7f;
    while (pack[p] & 0x80) { p++; bo = ((bo+1)<<7) | (pack[p]&0x7f); } p++;
    const dd = zlib.inflateSync(pack.subarray(p));
    const br = readFromPack(pack, off-bo, rp); if (!br) return null;
    const { type: bt, body: bb } = parseObj(br);
    const pd = applyDelta(bb, dd); if (!pd) return null;
    return Buffer.concat([Buffer.from(`${bt} ${pd.length}\0`), pd]);
  }
  if (t === 7) {
    const bs = pack.subarray(p, p+20).toString('hex'); p += 20;
    const dd = zlib.inflateSync(pack.subarray(p));
    const br = readObj(rp, bs); if (!br) return null;
    const { type: bt, body: bb } = parseObj(br);
    const pd = applyDelta(bb, dd); if (!pd) return null;
    return Buffer.concat([Buffer.from(`${bt} ${pd.length}\0`), pd]);
  }
  const tn: Record<number, string> = {1:'commit',2:'tree',3:'blob',4:'tag'};
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

async function main() {
  console.log('═══ TESTING: spotthebug repo ═══\n');

  // 1. HEAD tree
  console.log('1️⃣  Reading HEAD tree...');
  const headTree = readTree(repoPath);
  if (!headTree) { console.error('❌ Failed to read HEAD tree'); process.exit(1); }
  const gitCount = parseInt(execSync('git ls-tree -r HEAD --name-only | wc -l', { cwd: repoPath }).toString().trim());
  console.log(`   HEAD tree: ${headTree.size} files, git: ${gitCount}`);
  console.log(`   Coverage: ${Math.round(headTree.size / gitCount * 100)}%`);
  if (headTree.size !== gitCount) { console.log('   ❌ NOT 100%'); process.exit(1); }
  console.log('   ✅ 100%\n');

  // 2. Find modified tracked files + compute diffs
  console.log('2️⃣  Changed tracked .ts/.tsx files:');
  const { computeChangedLines } = await import('/Users/mohamedsalah/spotthebug/src/lib/codeReview/diff');

  const results: { file: string; total: number; changed: number }[] = [];
  let identical = 0;

  for (const [fp, sha] of headTree) {
    if (!fp.endsWith('.ts') && !fp.endsWith('.tsx')) continue;
    const fullPath = path.join(repoPath, fp);
    if (!fs.existsSync(fullPath)) continue;
    const original = readBlob(repoPath, sha);
    if (!original) continue;
    const current = fs.readFileSync(fullPath, 'utf-8');
    if (current === original) { identical++; continue; }

    const ranges = computeChangedLines(original, current);
    const totalLines = current.split('\n').length;
    const changedCount = ranges.reduce((s: number, r: any) => s + (r.end - r.start + 1), 0);
    results.push({ file: fp, total: totalLines, changed: changedCount });
  }

  console.log(`   Tracked & unchanged: ${identical}`);
  console.log(`   Tracked & modified: ${results.length}\n`);

  for (const r of results) {
    const pct = Math.round(r.changed / r.total * 100);
    console.log(`   📝 ${r.file}: ${r.changed}/${r.total} lines (${pct}%)`);
  }

  // 3. API integration test
  if (results.length > 0) {
    const pick = results[0];
    console.log(`\n3️⃣  API test: ${pick.file}`);
    const original = readBlob(repoPath, headTree.get(pick.file)!)!;
    const current = fs.readFileSync(path.join(repoPath, pick.file), 'utf-8');
    const ranges = computeChangedLines(original, current);

    const res = await fetch('http://localhost:3000/api/review-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: [{ path: pick.file, content: current, originalContent: original, language: 'typescript' }] }),
    });
    const data = await res.json();
    console.log(`   Changed ranges: ${JSON.stringify(ranges)}`);
    console.log(`   Findings: ${data.findings.length}`);
    let allOk = true;
    for (const f of data.findings) {
      const ok = ranges.some((r: any) => f.line >= r.start && f.line <= r.end);
      console.log(`   ${ok ? '✅' : '❌'} Line ${f.line}: ${f.message.substring(0, 70)}`);
      if (!ok) allOk = false;
    }
    console.log(`\n   ${allOk ? '✅ ALL FINDINGS IN SCOPE' : '❌ SOME OUT OF SCOPE'}`);
  }

  console.log('\n═══ DONE ═══');
}
main().catch(e => { console.error(e); process.exit(1); });

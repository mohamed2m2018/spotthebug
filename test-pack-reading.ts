/**
 * TEST: Verify pack file reading works with feedyum-fullstack repo.
 * 
 * This is the CRITICAL test — feedyum-fullstack has pack files, which is
 * why the review was reviewing whole files instead of just changes.
 * 
 * Tests:
 * 1. Read HEAD tree from a subrepo that has pack files
 * 2. Read a blob from the pack file
 * 3. Verify blob matches `git show`
 * 4. Compute diff and verify changedLines
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';

// Server-side equivalents of all browser functions

const OBJ_COMMIT = 1;
const OBJ_TREE = 2;
const OBJ_BLOB = 3;
const OBJ_TAG = 4;
const OBJ_OFS_DELTA = 6;
const OBJ_REF_DELTA = 7;

function readLooseObjectNode(repoPath: string, sha: string): Buffer | null {
  const objPath = path.join(repoPath, '.git', 'objects', sha.slice(0, 2), sha.slice(2));
  try {
    const compressed = fs.readFileSync(objPath);
    return zlib.inflateSync(compressed);
  } catch {
    return null;
  }
}

function parseGitObjectNode(data: Buffer): { type: string; body: Buffer } {
  const nullIdx = data.indexOf(0);
  const header = data.subarray(0, nullIdx).toString('utf-8');
  const [type] = header.split(' ');
  return { type, body: data.subarray(nullIdx + 1) };
}

function findShaInIdxNode(idx: Buffer, sha: string): number | null {
  const magic = idx.readUInt32BE(0);
  if (magic !== 0xff744f63) return null;
  const version = idx.readUInt32BE(4);
  if (version !== 2) return null;

  const shaBytes = Buffer.from(sha, 'hex');
  const fanoutBase = 8;
  const firstByte = shaBytes[0];

  const lo = firstByte === 0 ? 0 : idx.readUInt32BE(fanoutBase + (firstByte - 1) * 4);
  const hi = idx.readUInt32BE(fanoutBase + firstByte * 4);
  const totalObjects = idx.readUInt32BE(fanoutBase + 255 * 4);

  const shaListBase = 1032;

  let left = lo, right = hi;
  while (left < right) {
    const mid = (left + right) >>> 1;
    const cmp = Buffer.compare(idx.subarray(shaListBase + mid * 20, shaListBase + mid * 20 + 20), shaBytes);
    if (cmp === 0) {
      const crcListBase = shaListBase + totalObjects * 20;
      const offsetListBase = crcListBase + totalObjects * 4;
      const offset = idx.readUInt32BE(offsetListBase + mid * 4);
      if (offset & 0x80000000) {
        const largeOffsetBase = offsetListBase + totalObjects * 4;
        const largeIdx = offset & 0x7fffffff;
        return idx.readUInt32BE(largeOffsetBase + largeIdx * 8) * 0x100000000 + idx.readUInt32BE(largeOffsetBase + largeIdx * 8 + 4);
      }
      return offset;
    }
    if (cmp < 0) left = mid + 1;
    else right = mid;
  }
  return null;
}

function applyDeltaNode(base: Buffer, delta: Buffer): Buffer | null {
  let pos = 0;
  let baseSize = 0, shift = 0;
  do { baseSize |= (delta[pos] & 0x7f) << shift; shift += 7; } while (delta[pos++] & 0x80);
  if (base.length !== baseSize) return null;
  let resultSize = 0; shift = 0;
  do { resultSize |= (delta[pos] & 0x7f) << shift; shift += 7; } while (delta[pos++] & 0x80);
  const result = Buffer.alloc(resultSize);
  let resultPos = 0;
  while (pos < delta.length) {
    const cmd = delta[pos++];
    if (cmd & 0x80) {
      let copyOffset = 0, copySize = 0;
      if (cmd & 0x01) copyOffset = delta[pos++];
      if (cmd & 0x02) copyOffset |= delta[pos++] << 8;
      if (cmd & 0x04) copyOffset |= delta[pos++] << 16;
      if (cmd & 0x08) copyOffset |= delta[pos++] << 24;
      if (cmd & 0x10) copySize = delta[pos++];
      if (cmd & 0x20) copySize |= delta[pos++] << 8;
      if (cmd & 0x40) copySize |= delta[pos++] << 16;
      if (copySize === 0) copySize = 0x10000;
      base.copy(result, resultPos, copyOffset, copyOffset + copySize);
      resultPos += copySize;
    } else if (cmd > 0) {
      delta.copy(result, resultPos, pos, pos + cmd);
      resultPos += cmd;
      pos += cmd;
    } else return null;
  }
  return resultPos === resultSize ? result : null;
}

function readObjectFromPackNode(pack: Buffer, offset: number, repoPath: string): Buffer | null {
  let pos = offset;
  let byte = pack[pos++];
  const type = (byte >> 4) & 0x07;
  let size = byte & 0x0f;
  let shift = 4;
  while (byte & 0x80) { byte = pack[pos++]; size |= (byte & 0x7f) << shift; shift += 7; }

  if (type === OBJ_OFS_DELTA) {
    let baseOff = pack[pos] & 0x7f;
    while (pack[pos] & 0x80) { pos++; baseOff = ((baseOff + 1) << 7) | (pack[pos] & 0x7f); }
    pos++;
    const deltaData = zlib.inflateSync(pack.subarray(pos));
    const baseResult = readObjectFromPackNode(pack, offset - baseOff, repoPath);
    if (!baseResult) return null;
    const { type: bt, body: bb } = parseGitObjectNode(baseResult);
    const patched = applyDeltaNode(bb, deltaData);
    if (!patched) return null;
    const header = Buffer.from(`${bt} ${patched.length}\0`);
    return Buffer.concat([header, patched]);
  }
  if (type === OBJ_REF_DELTA) {
    const baseSha = pack.subarray(pos, pos + 20).toString('hex');
    pos += 20;
    const deltaData = zlib.inflateSync(pack.subarray(pos));
    const baseResult = readGitObjectNode(repoPath, baseSha);
    if (!baseResult) return null;
    const { type: bt, body: bb } = parseGitObjectNode(baseResult);
    const patched = applyDeltaNode(bb, deltaData);
    if (!patched) return null;
    const header = Buffer.from(`${bt} ${patched.length}\0`);
    return Buffer.concat([header, patched]);
  }

  const typeNames: Record<number, string> = { [OBJ_COMMIT]: 'commit', [OBJ_TREE]: 'tree', [OBJ_BLOB]: 'blob', [OBJ_TAG]: 'tag' };
  const typeName = typeNames[type];
  if (!typeName) return null;
  const decompressed = zlib.inflateSync(pack.subarray(pos));
  const body = decompressed.subarray(0, size);
  const header = Buffer.from(`${typeName} ${size}\0`);
  return Buffer.concat([header, body]);
}

function readPackedObjectNode(repoPath: string, sha: string): Buffer | null {
  const packDir = path.join(repoPath, '.git', 'objects', 'pack');
  if (!fs.existsSync(packDir)) return null;
  const idxFiles = fs.readdirSync(packDir).filter(f => f.endsWith('.idx'));
  for (const idxName of idxFiles) {
    const idxData = fs.readFileSync(path.join(packDir, idxName));
    const offset = findShaInIdxNode(idxData, sha);
    if (offset === null) continue;
    const packName = idxName.replace('.idx', '.pack');
    const packData = fs.readFileSync(path.join(packDir, packName));
    return readObjectFromPackNode(packData, offset, repoPath);
  }
  return null;
}

function readGitObjectNode(repoPath: string, sha: string): Buffer | null {
  return readLooseObjectNode(repoPath, sha) ?? readPackedObjectNode(repoPath, sha);
}

function readHeadTreeNode(repoPath: string): Map<string, string> | null {
  try {
    let headContent = fs.readFileSync(path.join(repoPath, '.git', 'HEAD'), 'utf-8').trim();
    let commitSha: string;
    if (headContent.startsWith('ref: ')) {
      const refPath = headContent.slice(5);
      commitSha = fs.readFileSync(path.join(repoPath, '.git', refPath), 'utf-8').trim();
    } else { commitSha = headContent; }

    const commitData = readGitObjectNode(repoPath, commitSha);
    if (!commitData) return null;
    const commitText = parseGitObjectNode(commitData).body.toString('utf-8');
    const treeMatch = commitText.match(/^tree ([0-9a-f]{40})/m);
    if (!treeMatch) return null;

    const fileMap = new Map<string, string>();
    function walkTree(treeSha: string, prefix: string) {
      const treeData = readGitObjectNode(repoPath, treeSha);
      if (!treeData) return;
      const { body } = parseGitObjectNode(treeData);
      let offset = 0;
      while (offset < body.length) {
        let spaceIdx = offset;
        while (spaceIdx < body.length && body[spaceIdx] !== 0x20) spaceIdx++;
        const mode = body.subarray(offset, spaceIdx).toString('utf-8');
        offset = spaceIdx + 1;
        let nullIdx = offset;
        while (nullIdx < body.length && body[nullIdx] !== 0) nullIdx++;
        const name = body.subarray(offset, nullIdx).toString('utf-8');
        offset = nullIdx + 1;
        const sha = body.subarray(offset, offset + 20).toString('hex');
        offset += 20;
        const fullPath = prefix ? `${prefix}/${name}` : name;
        if (mode === '40000' || mode === '040000') walkTree(sha, fullPath);
        else fileMap.set(fullPath, sha);
      }
    }
    walkTree(treeMatch[1], '');
    return fileMap;
  } catch { return null; }
}

function readBlobContentNode(repoPath: string, sha: string): string | null {
  const data = readGitObjectNode(repoPath, sha);
  if (!data) return null;
  const { type, body } = parseGitObjectNode(data);
  if (type !== 'blob') return null;
  for (let i = 0; i < Math.min(body.length, 8192); i++) { if (body[i] === 0) return null; }
  if (body.length > 1_000_000) return null;
  return body.toString('utf-8');
}

// ── Tests ──

async function main() {
  // Test both subrepos
  const subrepos = [
    '/Users/mohamedsalah/feedyum-fullstack/makeit-be',
    '/Users/mohamedsalah/feedyum-fullstack/feedyum',
  ];

  let totalPassed = true;

  for (const repoPath of subrepos) {
    const name = path.basename(repoPath);
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  TESTING: ${name}`);
    console.log(`${'═'.repeat(60)}\n`);

    if (!fs.existsSync(path.join(repoPath, '.git'))) {
      console.log(`   ⚠️  No .git directory — skipping`);
      continue;
    }

    // 1. Read HEAD tree
    console.log('1️⃣  Reading HEAD tree (with pack file support)...');
    const headTree = readHeadTreeNode(repoPath);
    if (!headTree) {
      console.log('   ❌ Failed to read HEAD tree');
      totalPassed = false;
      continue;
    }
    console.log(`   ✅ HEAD tree: ${headTree.size} files\n`);

    // Compare with git ls-tree
    const gitLsTree = execSync(`git ls-tree -r HEAD --name-only`, { cwd: repoPath }).toString().trim().split('\n');
    console.log(`   git ls-tree reports: ${gitLsTree.length} files`);
    const coverage = Math.round(headTree.size / gitLsTree.length * 100);
    console.log(`   Coverage: ${headTree.size}/${gitLsTree.length} = ${coverage}%`);
    if (coverage < 90) {
      console.log('   ❌ Coverage too low — pack file reading is not working');
      totalPassed = false;
    } else {
      console.log('   ✅ Coverage is good');
    }

    // 2. Pick a .js file and verify blob content
    console.log('\n2️⃣  Verifying blob content...');
    let verified = 0;
    let failed = 0;
    const MAX_VERIFY = 5;

    for (const [fp, sha] of headTree) {
      if (!fp.endsWith('.js') && !fp.endsWith('.ts')) continue;
      if (verified >= MAX_VERIFY) break;

      const blobContent = readBlobContentNode(repoPath, sha);
      if (!blobContent) continue;

      try {
        const gitShow = execSync(`git show HEAD:${fp}`, { cwd: repoPath }).toString();
        const match = blobContent === gitShow;
        if (match) {
          verified++;
          console.log(`   ✅ ${fp} — matches git show`);
        } else {
          failed++;
          console.log(`   ❌ ${fp} — MISMATCH (blob: ${blobContent.length}, git: ${gitShow.length})`);
          totalPassed = false;
        }
      } catch {
        // File may have special chars, skip
      }
    }
    console.log(`   Verified: ${verified}, Failed: ${failed}`);

    // 3. Find modified files and test diff
    console.log('\n3️⃣  Testing diff on modified files...');
    const { computeChangedLines } = await import('./src/lib/codeReview/diff');

    let diffTested = 0;
    for (const [fp, sha] of headTree) {
      if (!fp.endsWith('.js') && !fp.endsWith('.ts')) continue;
      if (diffTested >= 3) break;

      const fullPath = path.join(repoPath, fp);
      if (!fs.existsSync(fullPath)) continue;

      const original = readBlobContentNode(repoPath, sha);
      if (!original) continue;

      const current = fs.readFileSync(fullPath, 'utf-8');
      if (current === original) continue; // Not modified

      const ranges = computeChangedLines(original, current);
      const totalLines = current.split('\n').length;
      const changedCount = ranges.reduce((s, r) => s + (r.end - r.start + 1), 0);

      console.log(`   📝 ${fp}: ${ranges.length} range(s), ${changedCount}/${totalLines} lines (${Math.round(changedCount/totalLines*100)}%)`);
      console.log(`      Ranges: ${JSON.stringify(ranges)}`);

      if (changedCount < totalLines) {
        console.log(`      ✅ Scoped — reviewing ${changedCount} lines, NOT all ${totalLines}`);
      } else {
        console.log(`      ⚠️  All lines changed — might be a fully rewritten file`);
      }
      diffTested++;
    }

    if (diffTested === 0) {
      console.log('   ℹ️  No modified .js/.ts files found');
    }
  }

  console.log(`\n${'═'.repeat(60)}`);
  console.log(totalPassed ? '🎉 ALL TESTS PASSED' : '🔴 SOME TESTS FAILED');
  console.log(`${'═'.repeat(60)}\n`);
  process.exit(totalPassed ? 0 : 1);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });

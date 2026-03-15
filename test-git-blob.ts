/**
 * END-TO-END TEST: Verify git blob reading works with a real .git repo.
 * 
 * This test:
 * 1. Reads the HEAD tree from the spotthebug repo's .git
 * 2. Picks a known file and reads its committed blob content
 * 3. Compares with `git show HEAD:<file>` to verify correctness
 * 4. Tests the diff computation with real original+modified content
 * 5. Sends to the review API with originalContent to verify scoped review
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';

// ── Git object reading (server-side equivalent of browser code) ──

function readLooseObjectNode(repoPath: string, sha: string): Buffer | null {
  const objPath = path.join(repoPath, '.git', 'objects', sha.slice(0, 2), sha.slice(2));
  try {
    const compressed = fs.readFileSync(objPath);
    return zlib.inflateSync(compressed);
  } catch {
    return null; // Packed
  }
}

function parseGitObjectNode(data: Buffer): { type: string; body: Buffer } {
  const nullIdx = data.indexOf(0);
  const header = data.subarray(0, nullIdx).toString('utf-8');
  const [type] = header.split(' ');
  return { type, body: data.subarray(nullIdx + 1) };
}

function readHeadTreeNode(repoPath: string): Map<string, string> | null {
  try {
    // Read HEAD
    let headContent = fs.readFileSync(path.join(repoPath, '.git', 'HEAD'), 'utf-8').trim();
    let commitSha: string;
    if (headContent.startsWith('ref: ')) {
      const refPath = headContent.slice(5);
      commitSha = fs.readFileSync(path.join(repoPath, '.git', refPath), 'utf-8').trim();
    } else {
      commitSha = headContent;
    }

    const commitData = readLooseObjectNode(repoPath, commitSha);
    if (!commitData) return null;

    const commitObj = parseGitObjectNode(commitData);
    const commitText = commitObj.body.toString('utf-8');
    const treeMatch = commitText.match(/^tree ([0-9a-f]{40})/m);
    if (!treeMatch) return null;

    const fileMap = new Map<string, string>();

    function walkTree(treeSha: string, prefix: string) {
      const treeData = readLooseObjectNode(repoPath, treeSha);
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

        const shaBytes = body.subarray(offset, offset + 20);
        const sha = Array.from(shaBytes).map(b => b.toString(16).padStart(2, '0')).join('');
        offset += 20;

        const fullPath = prefix ? `${prefix}/${name}` : name;
        if (mode === '40000' || mode === '040000') {
          walkTree(sha, fullPath);
        } else {
          fileMap.set(fullPath, sha);
        }
      }
    }

    walkTree(treeMatch[1], '');
    return fileMap;
  } catch {
    return null;
  }
}

function readBlobContentNode(repoPath: string, sha: string): string | null {
  const data = readLooseObjectNode(repoPath, sha);
  if (!data) return null;
  const { type, body } = parseGitObjectNode(data);
  if (type !== 'blob') return null;
  // Skip binary
  for (let i = 0; i < Math.min(body.length, 8192); i++) {
    if (body[i] === 0) return null;
  }
  return body.toString('utf-8');
}

// ── Tests ──

async function main() {
  const repoPath = '/Users/mohamedsalah/spotthebug';
  
  console.log('═══ TEST: Git Blob Reading (Server-Side Equivalent) ═══\n');

  // 1. Read HEAD tree
  console.log('1️⃣  Reading HEAD tree...');
  const headTree = readHeadTreeNode(repoPath);
  if (!headTree) {
    console.error('❌ Failed to read HEAD tree — objects might be packed');
    console.log('   Running `git gc` or having mostly packed objects prevents loose object reading.');
    console.log('   This is expected for repos with many commits.');
    process.exit(1);
  }
  console.log(`   ✅ HEAD tree: ${headTree.size} files\n`);

  // 2. Pick a known .ts file from HEAD tree
  let TEST_FILE = '';
  for (const [fp] of headTree) {
    if (fp.endsWith('.ts') || fp.endsWith('.tsx')) {
      TEST_FILE = fp;
      break;
    }
  }
  if (!TEST_FILE) {
    // Fall back to any text file
    for (const [fp] of headTree) {
      if (!fp.endsWith('.svg') && !fp.endsWith('.db')) {
        TEST_FILE = fp;
        break;
      }
    }
  }
  if (!TEST_FILE) {
    console.error('❌ No suitable files found in HEAD tree');
    process.exit(1);
  }
  
  const blobSha = headTree.get(TEST_FILE)!;
  
  console.log(`2️⃣  Reading blob for ${TEST_FILE} (SHA: ${blobSha.substring(0, 8)}...)...`);
  const blobContent = readBlobContentNode(repoPath, blobSha);
  if (!blobContent) {
    console.log('   ⚠️  Blob is in a pack file (can\'t read loose)');
    console.log('   This happens when `git gc` has been run.');
    console.log('   Checking if we can fall back...');
    
    // Verify with git show
    const gitShowContent = execSync(`git show HEAD:${TEST_FILE}`, { cwd: repoPath }).toString();
    console.log(`   Git show returns ${gitShowContent.length} chars — file exists in HEAD`);
    console.log('   ❌ Can\'t read packed objects — need to handle this case');
    process.exit(1);
  }
  
  console.log(`   ✅ Blob content: ${blobContent.length} chars\n`);

  // 3. Verify against git show
  console.log('3️⃣  Verifying against `git show`...');
  const gitShowContent = execSync(`git show HEAD:${TEST_FILE}`, { cwd: repoPath }).toString();
  const match = blobContent === gitShowContent;
  console.log(`   Blob content matches git show: ${match ? '✅' : '❌'}`);
  if (!match) {
    console.log(`   Blob length: ${blobContent.length}, git show length: ${gitShowContent.length}`);
    // Find first difference
    for (let i = 0; i < Math.min(blobContent.length, gitShowContent.length); i++) {
      if (blobContent[i] !== gitShowContent[i]) {
        console.log(`   First diff at char ${i}: blob='${blobContent[i]}' git='${gitShowContent[i]}'`);
        break;
      }
    }
  }

  // 4. Count how many files have readable blobs vs packed
  console.log('\n4️⃣  Checking blob readability across all HEAD files...');
  let readable = 0;
  let packed = 0;
  let binary = 0;
  let total = 0;
  for (const [fp, sha] of headTree) {
    total++;
    if (total > 200) break; // Don't check everything
    const content = readBlobContentNode(repoPath, sha);
    if (content !== null) {
      readable++;
    } else {
      // Check if it's packed or binary
      const rawData = readLooseObjectNode(repoPath, sha);
      if (!rawData) {
        packed++;
      } else {
        binary++;
      }
    }
  }
  console.log(`   Checked: ${total} files`);
  console.log(`   ✅ Readable (loose text): ${readable}`);
  console.log(`   📦 Packed (can't read): ${packed}`);
  console.log(`   🔒 Binary (skipped): ${binary}`);
  console.log(`   Coverage: ${Math.round(readable / total * 100)}%`);

  // 5. Test diff with real file
  console.log('\n5️⃣  Testing diff with real modified file...');
  const currentContent = fs.readFileSync(path.join(repoPath, TEST_FILE), 'utf-8');
  
  if (currentContent !== blobContent) {
    console.log(`   File HAS been modified since last commit`);
    
    // Import diff utility
    const { computeChangedLines } = await import('./src/lib/codeReview/diff');
    const ranges = computeChangedLines(blobContent, currentContent);
    console.log(`   Changed ranges: ${JSON.stringify(ranges)}`);
    console.log(`   Total lines: ${currentContent.split('\n').length}`);
    
    const changedLineCount = ranges.reduce((sum, r) => sum + (r.end - r.start + 1), 0);
    console.log(`   Changed lines: ${changedLineCount} (${Math.round(changedLineCount / currentContent.split('\n').length * 100)}% of file)`);
  } else {
    console.log(`   File is identical to HEAD — no diff needed`);
    console.log(`   ✅ This confirms blob reading matches working tree`);
  }

  // 6. Integration test with review API
  console.log('\n6️⃣  Integration test: sending real file with originalContent to review API...');
  
  // Find a file that has been modified
  let testFileName = '';
  let testOriginal = '';
  let testCurrent = '';
  
  for (const [fp, sha] of headTree) {
    if (!fp.endsWith('.ts') && !fp.endsWith('.tsx')) continue;
    const orig = readBlobContentNode(repoPath, sha);
    if (!orig) continue;
    
    const currentPath = path.join(repoPath, fp);
    if (!fs.existsSync(currentPath)) continue;
    
    const curr = fs.readFileSync(currentPath, 'utf-8');
    if (curr !== orig && curr.length > 100) {
      testFileName = fp;
      testOriginal = orig;
      testCurrent = curr;
      break;
    }
  }

  if (!testFileName) {
    console.log('   No modified .ts/.tsx files found — skipping API test');
  } else {
    console.log(`   Found modified file: ${testFileName}`);
    
    const { computeChangedLines } = await import('./src/lib/codeReview/diff');
    const ranges = computeChangedLines(testOriginal, testCurrent);
    console.log(`   Changed ranges: ${ranges.length} range(s)`);

    const res = await fetch('http://localhost:3000/api/review-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        files: [{
          path: testFileName,
          content: testCurrent,
          originalContent: testOriginal,
          language: testFileName.split('.').pop() || 'text',
        }],
      }),
    });

    if (!res.ok) {
      console.error(`   ❌ API failed: ${res.status}`);
    } else {
      const data = await res.json();
      console.log(`   ✅ Review returned ${data.findings.length} findings`);

      let allInScope = true;
      for (const finding of data.findings) {
        const inRange = ranges.some((r: any) => finding.line >= r.start && finding.line <= r.end);
        console.log(`   ${inRange ? '✅' : '❌'} Line ${finding.line}: ${finding.message.substring(0, 60)}`);
        if (!inRange) allInScope = false;
      }
      console.log(`\n   All findings in scope: ${allInScope ? '✅ YES' : '❌ NO'}`);
    }
  }

  console.log('\n═══ TEST COMPLETE ═══');
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});

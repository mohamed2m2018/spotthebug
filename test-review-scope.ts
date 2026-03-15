/**
 * TEST: Verify that the review API only reviews changed lines.
 * 
 * This test:
 * 1. Sends a file with known original + modified content to /api/review-code
 * 2. The diff utility computes the actual changed line ranges
 * 3. Verifies that ALL findings reference lines within the changed ranges
 * 4. Verifies that NO findings reference unchanged lines
 * 
 * The test file has intentional bugs ONLY in the changed lines,
 * plus clean code in the unchanged lines — if the AI reviews
 * unchanged code, it will report findings there (proving it's wrong).
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

// Import diff utility directly for unit testing
import { computeChangedLines, isNewFile } from './src/lib/codeReview/diff';

// ── Test Data ──

const ORIGINAL_FILE = `// auth.service.ts — Authentication Service
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import { compare } from 'bcrypt';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
  ) {}

  async validateUser(email: string, password: string): Promise<any> {
    const user = await this.usersService.findByEmail(email);
    if (user && await compare(password, user.passwordHash)) {
      const { passwordHash, ...result } = user;
      return result;
    }
    return null;
  }

  async login(user: any) {
    const payload = { email: user.email, sub: user.id };
    return {
      access_token: this.jwtService.sign(payload),
      user,
    };
  }

  async register(email: string, password: string, name: string) {
    const existingUser = await this.usersService.findByEmail(email);
    if (existingUser) {
      throw new Error('User already exists');
    }
    const newUser = await this.usersService.create({ email, password, name });
    return this.login(newUser);
  }
}`;

// Modified version: changed lines 14-21 (validateUser) and 33-40 (register)
// Lines 1-13 and 22-32 are UNCHANGED — findings there = BUG in our scoping
const MODIFIED_FILE = `// auth.service.ts — Authentication Service
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import { compare } from 'bcrypt';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
  ) {}

  async validateUser(email: string, password: string): Promise<any> {
    const user = await this.usersService.findByEmail(email);
    if (user) {
      // BUG: removed password check — anyone can log in!
      const { passwordHash, ...result } = user;
      return result;
    }
    return null;
  }

  async login(user: any) {
    const payload = { email: user.email, sub: user.id };
    return {
      access_token: this.jwtService.sign(payload),
      user,
    };
  }

  async register(email: string, password: string, name: string) {
    // BUG: removed duplicate check — allows duplicate registrations!
    const newUser = await this.usersService.create({ email, password, name });
    const token = this.jwtService.sign({ email });
    // BUG: hardcoded secret in response
    return { access_token: token, secret: 'my-secret-key-123', user: newUser };
  }
}`;

// ═══ UNIT TESTS: diff utility ═══

function testDiffUtility() {
  console.log('═══ UNIT TEST: diff.ts computeChangedLines ═══\n');

  // Test 1: Basic diff
  const ranges = computeChangedLines(ORIGINAL_FILE, MODIFIED_FILE);
  console.log('Changed line ranges:', JSON.stringify(ranges));

  const originalLines = ORIGINAL_FILE.split('\n');
  const modifiedLines = MODIFIED_FILE.split('\n');
  console.log(`Original: ${originalLines.length} lines`);
  console.log(`Modified: ${modifiedLines.length} lines`);

  // Verify specific expectations
  let allGood = true;

  // Lines 14-21 should be changed (validateUser was modified)
  const hasValidateUserChange = ranges.some(r => r.start <= 17 && r.end >= 16);
  console.log(`\n✓ validateUser area changed: ${hasValidateUserChange ? '✅' : '❌'}`);
  if (!hasValidateUserChange) allGood = false;

  // Lines 33-40 should be changed (register was modified)
  const hasRegisterChange = ranges.some(r => r.start <= 37 && r.end >= 34);
  console.log(`✓ register area changed: ${hasRegisterChange ? '✅' : '❌'}`);
  if (!hasRegisterChange) allGood = false;

  // Lines 1-10 (deep imports) should NOT be in any range
  // (even with ±3 context margin, changes start at line 16 so lines 1-10 stay out)
  const deepImportsInRange = ranges.some(r => r.start <= 10 && r.end >= 1);
  console.log(`✓ deep imports (1-10) NOT in range: ${!deepImportsInRange ? '✅' : '❌'}`);
  if (deepImportsInRange) allGood = false;

  // Lines 25-28 (login core body) should NOT be in any range
  // Changes are at 16-17 and 33+, so with ±3 margin, login core (25-28) stays out
  const loginCoreInRange = ranges.some(r => r.start <= 28 && r.end >= 25);
  console.log(`✓ login() core (25-28) NOT in range: ${!loginCoreInRange ? '✅' : '❌'}`);
  if (loginCoreInRange) allGood = false;

  // Test 2: isNewFile
  console.log(`\n✓ isNewFile(null): ${isNewFile(null) ? '✅' : '❌'}`);
  console.log(`✓ isNewFile(''): ${isNewFile('') ? '✅' : '❌'}`);
  console.log(`✓ isNewFile('some code'): ${!isNewFile('some code') ? '✅' : '❌'}`);

  // Test 3: Identical files → no changes
  const noChanges = computeChangedLines(ORIGINAL_FILE, ORIGINAL_FILE);
  console.log(`✓ identical files → 0 ranges: ${noChanges.length === 0 ? '✅' : '❌ (got ' + noChanges.length + ')'}`);

  // Test 4: Completely new file → all lines changed
  const allChanged = computeChangedLines('', MODIFIED_FILE);
  const coversAll = allChanged.length > 0;
  console.log(`✓ new file → has changes: ${coversAll ? '✅' : '❌'}`);

  console.log(`\n${allGood ? '🎉 All diff unit tests PASSED' : '🔴 Some diff unit tests FAILED'}\n`);
  return allGood;
}

// ═══ INTEGRATION TEST: review API ═══

async function testReviewAPI() {
  console.log('═══ INTEGRATION TEST: /api/review-code with originalContent ═══\n');

  const baseUrl = 'http://localhost:3000';

  // Test 1: Send with originalContent → should only review changed lines
  console.log('1️⃣  Sending review request with originalContent...');
  const res = await fetch(`${baseUrl}/api/review-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      files: [{
        path: 'src/auth/auth.service.ts',
        content: MODIFIED_FILE,
        originalContent: ORIGINAL_FILE,
        language: 'typescript',
      }],
      goal: 'Fixing authentication flow',
    }),
  });

  if (!res.ok) {
    console.error('❌ API call failed:', res.status, await res.text());
    return false;
  }

  const data = await res.json();
  console.log(`   ✅ Got response: ${data.findings.length} findings\n`);

  // Compute the actual changed ranges for validation
  const changedRanges = computeChangedLines(ORIGINAL_FILE, MODIFIED_FILE);
  console.log('   Changed line ranges:', JSON.stringify(changedRanges));

  // Check that ALL findings are within changed line ranges
  let allWithinScope = true;
  console.log('\n2️⃣  Checking findings are within changed ranges:');
  for (const finding of data.findings) {
    const inRange = changedRanges.some(r => finding.line >= r.start && finding.line <= r.end);
    const status = inRange ? '✅ IN SCOPE' : '❌ OUT OF SCOPE';
    console.log(`   ${status} — [${finding.severity}] Line ${finding.line}: ${finding.message.substring(0, 80)}`);
    if (!inRange) allWithinScope = false;
  }

  // Check specific expectations
  console.log('\n3️⃣  Content verification:');

  // Should find the removed password check bug
  const hasPasswordBug = data.findings.some((f: any) =>
    f.message.toLowerCase().includes('password') ||
    f.message.toLowerCase().includes('authentication') ||
    f.message.toLowerCase().includes('validate') ||
    f.message.toLowerCase().includes('compare')
  );
  console.log(`   ${hasPasswordBug ? '✅' : '❌'} Found password check removal bug`);

  // Should find the hardcoded secret
  const hasSecretBug = data.findings.some((f: any) =>
    f.message.toLowerCase().includes('secret') ||
    f.message.toLowerCase().includes('hardcoded') ||
    f.message.toLowerCase().includes('key')
  );
  console.log(`   ${hasSecretBug ? '✅' : '❌'} Found hardcoded secret bug`);

  // Should NOT find issues in the deep unchanged login() core (lines 25-28)
  const hasLoginIssue = data.findings.some((f: any) =>
    f.line >= 25 && f.line <= 28
  );
  console.log(`   ${!hasLoginIssue ? '✅' : '❌'} No findings in unchanged login() core (25-28)`);

  // Should NOT find issues in deep imports (lines 1-10)
  const hasImportIssue = data.findings.some((f: any) => f.line <= 10);
  console.log(`   ${!hasImportIssue ? '✅' : '❌'} No findings in unchanged imports (1-10)`);

  console.log(`\n   Summary: "${data.summary}"`);
  console.log(`   Risk score: ${data.riskScore}/5`);

  const passed = allWithinScope && !hasLoginIssue && !hasImportIssue;
  console.log(`\n${passed ? '🎉 INTEGRATION TEST PASSED — review is scoped correctly!' : '🔴 INTEGRATION TEST FAILED — review is NOT properly scoped'}`);

  // Test 2: Send WITHOUT originalContent → should review all lines (backward compat)
  console.log('\n\n═══ BACKWARD COMPAT TEST: no originalContent ═══\n');
  const res2 = await fetch(`${baseUrl}/api/review-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      files: [{
        path: 'src/auth/auth.service.ts',
        content: MODIFIED_FILE,
        // No originalContent — should review everything
        language: 'typescript',
      }],
    }),
  });

  const data2 = await res2.json();
  console.log(`   ✅ Got response: ${data2.findings.length} findings (full file review)`);
  console.log(`   This is expected — without originalContent, all lines are reviewed.`);

  return passed;
}

// ═══ Main ═══

async function main() {
  const diffPassed = testDiffUtility();
  if (!diffPassed) {
    console.error('\n🛑 Diff utility tests failed — skipping API test');
    process.exit(1);
  }

  const apiPassed = await testReviewAPI();
  process.exit(apiPassed ? 0 : 1);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

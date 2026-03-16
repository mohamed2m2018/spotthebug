#!/usr/bin/env node

/**
 * Test script for /api/execute-code endpoint
 * Run: node scripts/test-execute-code.mjs
 * 
 * Requires the dev server running on localhost:3000
 */

const BASE = "http://localhost:3000/api/execute-code";

async function test(name, body, validate) {
  process.stdout.write(`  ${name}... `);
  try {
    const res = await fetch(BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    const result = validate(data);
    if (result === true) {
      console.log("✅ PASS");
    } else {
      console.log(`❌ FAIL — ${result}`);
      console.log("    Response:", JSON.stringify(data, null, 2));
    }
  } catch (err) {
    console.log(`❌ ERROR — ${err.message}`);
  }
}

async function main() {
  console.log("\n🧪 Testing /api/execute-code\n");

  // ── Run mode tests ──
  console.log("── Run Mode ──");

  await test("JS: simple console.log", {
    code: 'console.log("hello world");',
    language: "javascript",
    mode: "run",
  }, (d) => d.stdout?.includes("hello world") || `Expected "hello world" in stdout, got: "${d.stdout}"`);

  await test("JS: arithmetic", {
    code: 'console.log(2 + 3);',
    language: "javascript",
    mode: "run",
  }, (d) => d.stdout?.includes("5") || `Expected "5" in stdout, got: "${d.stdout}"`);

  await test("Python: print", {
    code: 'print("hello from python")',
    language: "python",
    mode: "run",
  }, (d) => d.stdout?.includes("hello from python") || `Expected "hello from python", got: "${d.stdout}"`);

  await test("JS: runtime error", {
    code: 'undefinedVar.foo();',
    language: "javascript",
    mode: "run",
  }, (d) => d.error !== null || `Expected error, got none`);

  // ── Test mode tests ──
  console.log("\n── Test Mode (with functionName) ──");

  await test("JS: twoSum — all pass", {
    code: `function twoSum(nums, target) {
  const map = {};
  for (let i = 0; i < nums.length; i++) {
    const complement = target - nums[i];
    if (complement in map) return [map[complement], i];
    map[nums[i]] = i;
  }
  return [];
}`,
    language: "javascript",
    mode: "test",
    functionName: "twoSum",
    testCases: [
      { input: "[2,7,11,15], 9", expectedOutput: "[0,1]" },
      { input: "[3,2,4], 6", expectedOutput: "[1,2]" },
      { input: "[3,3], 6", expectedOutput: "[0,1]" },
    ],
  }, (d) => {
    if (!d.allPassed) return `Expected allPassed=true, got ${d.allPassed}. stdout: ${d.stdout}`;
    if (d.testResults?.length !== 3) return `Expected 3 test results, got ${d.testResults?.length}`;
    return true;
  });

  await test("JS: reverseString — some fail", {
    code: `function reverseString(s) {
  return s; // intentionally wrong
}`,
    language: "javascript",
    mode: "test",
    functionName: "reverseString",
    testCases: [
      { input: '"hello"', expectedOutput: '"olleh"' },
      { input: '""', expectedOutput: '""' },
    ],
  }, (d) => {
    if (d.allPassed) return `Expected some failures, but allPassed=true`;
    const failed = d.testResults?.filter((r) => !r.passed);
    if (failed?.length < 1) return `Expected at least 1 failure`;
    return true;
  });

  await test("Python: add function — all pass", {
    code: `def add(a, b):
    return a + b`,
    language: "python",
    mode: "test",
    functionName: "add",
    testCases: [
      { input: "1, 2", expectedOutput: "3" },
      { input: "0, 0", expectedOutput: "0" },
      { input: "-1, 1", expectedOutput: "0" },
    ],
  }, (d) => {
    if (!d.allPassed) return `Expected allPassed=true, got ${d.allPassed}. stdout: ${d.stdout}`;
    return true;
  });

  // ── Test mode without functionName (regex fallback) ──
  console.log("\n── Test Mode (regex fallback) ──");

  await test("JS: auto-detect function name", {
    code: `function multiply(a, b) { return a * b; }`,
    language: "javascript",
    mode: "test",
    testCases: [
      { input: "3, 4", expectedOutput: "12" },
      { input: "0, 5", expectedOutput: "0" },
    ],
  }, (d) => {
    if (!d.allPassed) return `Expected allPassed=true, got ${d.allPassed}. stdout: ${d.stdout}`;
    return true;
  });

  await test("JS: auto-detect arrow function", {
    code: `const square = (n) => n * n;`,
    language: "javascript",
    mode: "test",
    testCases: [
      { input: "3", expectedOutput: "9" },
      { input: "5", expectedOutput: "25" },
    ],
  }, (d) => {
    if (!d.allPassed) return `Expected allPassed=true, got ${d.allPassed}. stdout: ${d.stdout}`;
    return true;
  });

  console.log("\n✅ All tests complete\n");
}

main().catch(console.error);

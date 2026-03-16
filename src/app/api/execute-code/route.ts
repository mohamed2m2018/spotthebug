import { Sandbox } from "@e2b/code-interpreter";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/execute-code
 * 
 * Executes user code in an isolated E2B sandbox.
 * Supports two modes:
 *   - "run":  Execute code, return stdout/stderr
 *   - "test": Execute code with test cases appended, return pass/fail results
 * 
 * Body: { code: string, language: string, mode: "run" | "test", testCases?: [...] }
 */

// Map our language names to E2B-compatible language identifiers
function getE2BLanguage(language: string): string {
  const normalized = language.toLowerCase().trim();
  const map: Record<string, string> = {
    javascript: "js",
    typescript: "ts",
    python: "python",
    python3: "python",
    java: "java",
    "c++": "cpp",
    cpp: "cpp",
    c: "c",
    go: "go",
    rust: "rust",
    ruby: "ruby",
    php: "php",
  };
  return map[normalized] || normalized;
}

// Detect the main function name from user code (fallback when functionName not provided)
function detectFunctionName(code: string, language: string): string {
  const lang = getE2BLanguage(language);

  if (lang === "js" || lang === "ts") {
    const fnMatch = code.match(/(?:function\s+(\w+)\s*\(|(?:const|let|var)\s+(\w+)\s*=\s*(?:function|\(|async))/);
    if (fnMatch) return fnMatch[1] || fnMatch[2];
  }

  if (lang === "python") {
    const defMatch = code.match(/def\s+(\w+)\s*\(/);
    if (defMatch) return defMatch[1];
  }

  return "solve";
}

// Build a test runner that wraps user code + test cases
function buildTestRunner(
  code: string,
  testCases: { input: string; expectedOutput: string }[],
  language: string,
  functionName?: string,
): string {
  const lang = getE2BLanguage(language);
  const fnName = functionName || detectFunctionName(code, language);

  if (lang === "js" || lang === "ts") {
    const testCode = testCases
      .map(
        (tc, i) => `
try {
  const __result_${i} = JSON.stringify(${fnName}(${tc.input}));
  const __expected_${i} = JSON.stringify(${tc.expectedOutput});
  if (__result_${i} === __expected_${i}) {
    console.log("✅ Test ${i + 1}: PASS");
  } else {
    console.log("❌ Test ${i + 1}: FAIL — got " + __result_${i} + ", expected " + __expected_${i});
  }
} catch (e) {
  console.log("❌ Test ${i + 1}: ERROR — " + e.message);
}`,
      )
      .join("\n");
    return `${code}\n\n// ── Test Runner ──\n${testCode}`;
  }

  if (lang === "python") {
    const testCode = testCases
      .map(
        (tc, i) => `
try:
    __result_${i} = ${fnName}(${tc.input})
    __expected_${i} = ${tc.expectedOutput}
    if __result_${i} == __expected_${i}:
        print(f"✅ Test ${i + 1}: PASS")
    else:
        print(f"❌ Test ${i + 1}: FAIL — got {__result_${i}}, expected {__expected_${i}}")
except Exception as e:
    print(f"❌ Test ${i + 1}: ERROR — {e}")`,
      )
      .join("\n");
    return `${code}\n\n# ── Test Runner ──\n${testCode}`;
  }

  // Fallback: just run code
  return code;
}

export async function POST(req: NextRequest) {
  try {
    const { code, language, mode, testCases, functionName } = await req.json();

    if (!code || !language) {
      return NextResponse.json(
        { error: "Missing code or language" },
        { status: 400 },
      );
    }

    const apiKey = process.env.E2B_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "E2B API key not configured" },
        { status: 500 },
      );
    }

    // Create sandbox with 30s timeout
    const sandbox = await Sandbox.create({ apiKey, timeoutMs: 30_000 });

    try {
      let codeToRun = code;

      if (mode === "test" && testCases?.length) {
        codeToRun = buildTestRunner(code, testCases, language, functionName);
      }

      const execution = await sandbox.runCode(codeToRun, {
        language: getE2BLanguage(language),
      });

      // Collect stdout and stderr
      const stdout = execution.logs.stdout?.join("\n") ?? "";
      const stderr = execution.logs.stderr?.join("\n") ?? "";
      const error = execution.error;

      // Parse test results from stdout if in test mode
      let testResults: { test: number; passed: boolean; message: string }[] = [];
      if (mode === "test") {
        const lines = stdout.split("\n");
        testResults = lines
          .filter((l) => l.startsWith("✅") || l.startsWith("❌"))
          .map((line, i) => ({
            test: i + 1,
            passed: line.startsWith("✅"),
            message: line,
          }));
      }

      return NextResponse.json({
        stdout,
        stderr,
        error: error ? { name: error.name, message: error.value, traceback: error.traceback } : null,
        testResults: mode === "test" ? testResults : undefined,
        allPassed: mode === "test" ? testResults.every((r) => r.passed) && testResults.length > 0 : undefined,
      });
    } finally {
      // Always kill sandbox to avoid billing
      await sandbox.kill();
    }
  } catch (err: any) {
    console.error("[execute-code] Error:", err);
    return NextResponse.json(
      { error: err.message || "Execution failed" },
      { status: 500 },
    );
  }
}

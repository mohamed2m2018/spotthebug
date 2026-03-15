/**
 * Mock script that replicates the exact code path in usePairVoice.ts
 * to debug whether review findings reach the systemInstruction.
 */

// Import the actual functions from the codebase
import { buildGroundedInstruction, PAIR_VOICE_SYSTEM_PROMPT, PAIR_GREETING_PROMPT } from "./src/config/prompts";
import type { ReviewFinding } from "./src/config/prompts";

// ── Simulate exactly what PairSession.tsx sends ──
const mockReviewFindings: ReviewFinding[] = [
  { file: "src/containers/TabBar/Settings.js", line: 42, severity: "ERROR", message: "Unhandled async error in env switch", rule: "no-floating-promises" },
  { file: "src/containers/TabBar/Settings.js", line: 55, severity: "WARNING", message: "Console.log left in production code", rule: "no-console" },
  { file: "src/services/api.ts", line: 12, severity: "ERROR", message: "Hardcoded API URL", rule: "no-hardcoded-urls" },
  { file: "src/hooks/useAuth.ts", line: 88, severity: "WARNING", message: "Missing error boundary", rule: "error-handling" },
  { file: "src/utils/storage.ts", line: 30, severity: "INFO", message: "Consider using AsyncStorage batch operations", rule: "performance" },
];

const mockSelectedFiles = [
  "src/containers/TabBar/Settings.js",
  "src/services/api.ts",
  "src/hooks/useAuth.ts",
  "src/utils/storage.ts",
  "src/screens/Home.tsx",
  "src/screens/Profile.tsx",
  "src/navigation/index.tsx",
  "src/constants/config.ts",
  "src/theme/colors.ts",
];

const mockContext = {
  tree: "feedyum-fullstack/...",
  projectName: "feedyum-fullstack",
  frameworks: [],
  reviewFindings: mockReviewFindings,
  selectedFiles: mockSelectedFiles,
  goal: "Review environment switching logic",
};

console.log("=== STEP 1: Check condition ===");
console.log(`context?.reviewFindings: ${!!mockContext?.reviewFindings} (length: ${mockContext?.reviewFindings?.length})`);
console.log(`context?.selectedFiles: ${!!mockContext?.selectedFiles} (length: ${mockContext?.selectedFiles?.length})`);
console.log(`Condition result: ${!!(mockContext?.reviewFindings && mockContext?.selectedFiles)}`);

console.log("\n=== STEP 2: Check PAIR_VOICE_SYSTEM_PROMPT length ===");
console.log(`PAIR_VOICE_SYSTEM_PROMPT length: ${PAIR_VOICE_SYSTEM_PROMPT.length} chars`);

console.log("\n=== STEP 3: Build systemInstruction ===");
const systemInstruction = (mockContext?.reviewFindings && mockContext?.selectedFiles)
  ? buildGroundedInstruction(mockContext.reviewFindings, mockContext.selectedFiles, mockContext?.goal)
  : PAIR_VOICE_SYSTEM_PROMPT;

console.log(`\nFull systemInstruction length: ${systemInstruction.length} chars`);
console.log(`Contains 'CONTEXT YOU ALREADY KNOW': ${systemInstruction.includes('CONTEXT YOU ALREADY KNOW')}`);
console.log(`Contains review findings: ${systemInstruction.includes('Unhandled async error')}`);
console.log(`Contains selected files: ${systemInstruction.includes('Settings.js')}`);
console.log(`Contains goal: ${systemInstruction.includes('environment switching')}`);

console.log("\n=== STEP 4: What the trace logs (sliced to 2000 chars) ===");
const tracedInstruction = systemInstruction.slice(0, 2000);
console.log(`Traced length: ${tracedInstruction.length} chars`);
console.log(`Trace contains 'CONTEXT YOU ALREADY KNOW': ${tracedInstruction.includes('CONTEXT YOU ALREADY KNOW')}`);
console.log(`Trace contains review findings: ${tracedInstruction.includes('Unhandled async error')}`);

if (!tracedInstruction.includes('CONTEXT YOU ALREADY KNOW')) {
  console.log("\n🔴 BUG FOUND: .slice(0, 2000) cuts off the review findings!");
  console.log(`   PAIR_VOICE_SYSTEM_PROMPT alone is ${PAIR_VOICE_SYSTEM_PROMPT.length} chars`);
  console.log(`   Review context starts at char ~${systemInstruction.indexOf('CONTEXT YOU ALREADY KNOW')}`);
  console.log(`   But trace only logs first 2000 chars — findings are invisible in trace!`);
}

console.log("\n=== STEP 5: Full systemInstruction (last 500 chars) ===");
console.log(systemInstruction.slice(-500));

console.log("\n=== STEP 6: What AI actually receives via ai.live.connect ===");
const configForAI = {
  systemInstruction: {
    parts: [{ text: systemInstruction }]
  }
};
console.log(`AI config systemInstruction length: ${configForAI.systemInstruction.parts[0].text.length} chars`);
console.log(`AI WILL see review findings: ${configForAI.systemInstruction.parts[0].text.includes('CONTEXT YOU ALREADY KNOW')}`);

console.log("\n=== DONE ===");

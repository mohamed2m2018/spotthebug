const fs = require('fs');
const file = '/Users/mohamedsalah/spotthebug/src/config/prompts.ts';
let content = fs.readFileSync(file, 'utf8');

// Extract PAIR_VOICE_SYSTEM_PROMPT
const promptMatch = content.match(/\/\/ ═══════════════════════════════════════════════════════\n\/\/ 4\. PAIR MODE — Full Voice System Prompt \(for token route\)\n\/\/ ═══════════════════════════════════════════════════════\n\nexport const PAIR_VOICE_SYSTEM_PROMPT = `[\s\S]*?`;\n/);

if (promptMatch) {
  content = content.replace(promptMatch[0], '');
  // Insert it before PAIR_BASE_INSTRUCTION
  content = content.replace(
    /const PAIR_BASE_INSTRUCTION/,
    `${promptMatch[0]}\nconst PAIR_BASE_INSTRUCTION`
  );
  // Replace references in REVIEW_MODES
  content = content.replace(/\$\{PAIR_BASE_INSTRUCTION\}/g, '${PAIR_VOICE_SYSTEM_PROMPT}\\n\\n${PAIR_BASE_INSTRUCTION}');
  fs.writeFileSync(file, content);
  console.log("Patched successfully");
} else {
  console.log("Could not find PAIR_VOICE_SYSTEM_PROMPT block");
}

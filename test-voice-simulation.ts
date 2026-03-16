/**
 * TEST: Simulate the exact pair voice session flow.
 *
 * Constructs the same systemInstruction + greeting that usePairVoice.ts sends,
 * sends to Gemini API (non-streaming), and logs what the AI would say.
 * This lets us debug the AI behavior WITHOUT running a live session.
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { GoogleGenAI } from '@google/genai';

// ── Import the same prompts the voice session uses ──
import { buildGroundedInstruction, PAIR_GREETING_PROMPT } from './src/config/prompts';

// ── Simulate the review findings the user saw ──
const reviewFindings = [
  {
    file: 'makeit-be/middleware/dbSwitch.js',
    line: 16,
    severity: 'WARNING' as const,
    message: 'The dbSwitch middleware introduces dynamic database connection switching in development environments.',
    rule: 'architecture',
  },
  {
    file: 'feedyum/.expo/devices.json',
    line: 3,
    severity: 'INFO' as const,
    message: 'The .expo/devices.json file should be in .gitignore to prevent committing local environment specifics.',
    rule: 'best-practice',
  },
  {
    file: 'feedyum/src/api/request.js',
    line: 42,
    severity: 'INFO' as const,
    message: 'Client-side sends X-Environment header to dictate database environment.',
    rule: 'architecture',
  },
  {
    file: 'feedyum/src/common/constants.js',
    line: 3,
    severity: 'WARNING' as const,
    message: 'API_LOCAL constant is hardcoded to a specific local IP address.',
    rule: 'best-practice',
  },
];

const selectedFiles = [
  'makeit-be/config/keys.js',
  'makeit-be/middleware/dbSwitch.js',
  'makeit-be/server.js',
  'feedyum/.expo/devices.json',
  'feedyum/src/api/request.js',
  'feedyum/src/common/constants.js',
  'feedyum/src/containers/TabBar/ordering/ChefMenu.js',
  'feedyum/src/containers/TabBar/profile/Setting.js',
  'feedyum/src/utils/useStorage.js',
];

const goal = 'Adding environment switching between staging and production';

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY missing');

  const ai = new GoogleGenAI({ apiKey });

  // 1. Build the system instruction (exactly like usePairVoice.ts line 337-338)
  const systemInstruction = buildGroundedInstruction(reviewFindings, selectedFiles, goal);

  console.log('═══ SYSTEM INSTRUCTION (what the AI gets) ═══');
  console.log(systemInstruction);
  console.log(`\n${'═'.repeat(60)}\n`);

  // 2. The greeting prompt (exactly like usePairVoice.ts line 311)
  console.log('═══ GREETING PROMPT (first user message) ═══');
  console.log(PAIR_GREETING_PROMPT);
  console.log(`\n${'═'.repeat(60)}\n`);

  // 3. Send to Gemini (non-streaming; simulates what the voice AI would say)
  console.log('═══ AI RESPONSE (what Gemini would say) ═══\n');

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [
      { role: 'user', parts: [{ text: PAIR_GREETING_PROMPT }] },
    ],
    config: {
      systemInstruction: systemInstruction,
    },
  });

  const aiText = response.text || '(empty response)';
  console.log(aiText);

  // 4. Analyze the response
  console.log(`\n${'═'.repeat(60)}`);
  console.log('═══ ANALYSIS ═══\n');

  // Check: does it mention specific findings?
  const mentionsFindings = reviewFindings.filter(f =>
    aiText.toLowerCase().includes(f.file.split('/').pop()!.replace('.js', '').toLowerCase())
  );
  console.log(`Findings mentioned: ${mentionsFindings.length}/${reviewFindings.length}`);
  for (const f of mentionsFindings) {
    console.log(`  ✅ ${f.file}:${f.line}`);
  }

  // Check: does it try to describe the whole screen?
  const wholeFileIndicators = [
    'I can see', 'I see', 'on your screen', 'looking at',
    'the file contains', 'this file is', 'entire file',
  ];
  const hasWholeFile = wholeFileIndicators.filter(w => aiText.toLowerCase().includes(w));
  if (hasWholeFile.length > 0) {
    console.log(`\n⚠️  Whole-file language detected: ${hasWholeFile.join(', ')}`);
  }

  // Check: does it give an overview first?
  const overviewIndicators = [
    'overview', 'summary', 'at a high level', 'changes are',
    'let me walk you', 'here\'s what changed',
  ];
  const hasOverview = overviewIndicators.filter(w => aiText.toLowerCase().includes(w));
  console.log(`\nOverview language: ${hasOverview.length > 0 ? '✅ ' + hasOverview.join(', ') : '❌ No overview detected'}`);

  // Check: does it follow the phase structure?
  console.log(`\nResponse length: ${aiText.length} chars`);
  console.log(`Sentence count: ~${aiText.split(/[.!?]/).filter(s => s.trim()).length}`);

  console.log(`\n${'═'.repeat(60)}`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });

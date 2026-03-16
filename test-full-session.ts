/**
 * 10-MIN SESSION: Junior developer perspective.
 * 
 * Simulates a junior dev who:
 * - Doesn't fully understand the code (AI agent wrote it)
 * - Asks naive questions
 * - Sometimes gives wrong answers to the AI's guided questions
 * - Needs concepts explained
 * 
 * At the end: honest assessment of learning value.
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { GoogleGenAI } from '@google/genai';
import { buildGroundedInstruction, PAIR_GREETING_PROMPT } from './src/config/prompts';

const reviewFindings = [
  { file: 'makeit-be/middleware/dbSwitch.js', line: 16, severity: 'WARNING' as const, message: 'The dbSwitch middleware introduces dynamic database connection switching. Frequent disconnections and reconnections can introduce transient connection issues.', rule: 'architecture' },
  { file: 'feedyum/.expo/devices.json', line: 3, severity: 'INFO' as const, message: 'The .expo/devices.json file should be in .gitignore.', rule: 'best-practice' },
  { file: 'feedyum/src/api/request.js', line: 42, severity: 'INFO' as const, message: 'Client-side sends X-Environment header to dictate database environment.', rule: 'architecture' },
  { file: 'feedyum/src/common/constants.js', line: 3, severity: 'WARNING' as const, message: 'API_LOCAL constant is hardcoded to a specific local IP address.', rule: 'best-practice' },
];

const selectedFiles = [
  'makeit-be/config/keys.js', 'makeit-be/middleware/dbSwitch.js', 'makeit-be/server.js',
  'feedyum/.expo/devices.json', 'feedyum/src/api/request.js', 'feedyum/src/common/constants.js',
  'feedyum/src/containers/TabBar/ordering/ChefMenu.js', 'feedyum/src/containers/TabBar/profile/Setting.js',
  'feedyum/src/utils/useStorage.js',
];

const goal = 'Adding environment switching between staging and production';

// Junior developer responses — realistic, sometimes confused
const userTurns = [
  // Turn 1: Greeting
  PAIR_GREETING_PROMPT,
  
  // Turn 2: Junior responds to overview
  "Yeah I used an AI agent to build the environment switching. I don't fully understand how the backend middleware works though. Can we start there?",
  
  // Turn 3: Junior tries to answer the AI's question about reconnections (gets it wrong)
  "Hmm, I think reconnecting each time is fine? Like MongoDB handles it automatically right?",
  
  // Turn 4: Junior asks follow-up
  "Oh I didn't think about that. So what would be a better approach? Should I keep the connection open somehow?",
  
  // Turn 5: Junior wants to move on
  "That makes sense. Ok what about the keys.js file? I think I just simplified the mongo URI there",
  
  // Turn 6: Junior asks about frontend
  "Cool. Now the frontend stuff — I added a header in request.js to tell the backend which environment to use. Is that ok?",
  
  // Turn 7: Junior gives wrong reasoning
  "I thought it's safe because we only use it in development mode. Production wouldn't have the header right?",
  
  // Turn 8: Junior asks about constants
  "What about the constants file? I know the IP is hardcoded but it's just for local development",
  
  // Turn 9: Junior asks about UI changes
  "Ok makes sense. What about the Setting.js and ChefMenu changes? Those are the UI parts",
  
  // Turn 10: Junior wants to understand the useStorage hook
  "Wait, what does the useStorage hook do exactly? I see it's imported but I'm not sure what it handles",
  
  // Turn 11: Junior ready to wrap up
  "I think that covers everything. How did I do overall?",
];

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY missing');

  const ai = new GoogleGenAI({ apiKey });
  const systemInstruction = buildGroundedInstruction(reviewFindings, selectedFiles, goal);

  const history: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = [];

  console.log('═══ 10-MIN SESSION: Junior Developer POV ═══\n');

  for (let i = 0; i < userTurns.length; i++) {
    const userMsg = userTurns[i];
    console.log(`${'─'.repeat(60)}`);
    console.log(`👤 JUNIOR (Turn ${i + 1}/${userTurns.length}):`);
    console.log(`   ${userMsg}`);
    console.log(`${'─'.repeat(60)}\n`);

    history.push({ role: 'user', parts: [{ text: userMsg }] });

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: history,
      config: { systemInstruction },
    });

    const aiText = response.text || '(empty)';
    history.push({ role: 'model', parts: [{ text: aiText }] });
    console.log(`🤖 AI REVIEWER:\n${aiText}\n`);
  }

  // ── Junior Developer Learning Assessment ──
  console.log(`\n${'═'.repeat(60)}`);
  console.log('═══ LEARNING ASSESSMENT (Junior Developer POV) ═══\n');

  const fullAiText = history.filter(h => h.role === 'model').map(h => h.parts[0].text).join('\n');
  const totalWords = fullAiText.split(/\s+/).length;

  // Did the AI explain concepts or just point out issues?
  const conceptualTeaching = [
    'connection pool', 'mutex', 'race condition', 'environment variable',
    'header', 'middleware', 'interceptor', 'gitignore', '.env',
    'security', 'production', 'staging', 'pattern', 'best practice',
    'because', 'the reason', 'this means', 'think of it like',
  ];
  const conceptsMentioned = conceptualTeaching.filter(c => fullAiText.toLowerCase().includes(c));

  // Did the AI correct wrong answers politely?
  const correctionPhrases = [
    'actually', 'not quite', 'good thought', 'however', 'the thing is',
    'that\'s partially right', 'yes, but', 'while that\'s true',
  ];
  const corrections = correctionPhrases.filter(c => fullAiText.toLowerCase().includes(c));

  // Did the AI ask follow-up questions?
  const questionMarks = (fullAiText.match(/\?/g) || []).length;

  // Findings coverage
  const findingsCovered = reviewFindings.filter(f => {
    const name = f.file.split('/').pop()!.replace('.js', '').replace('.json', '').toLowerCase();
    return fullAiText.toLowerCase().includes(name);
  });

  console.log(`📊 Session Stats:`);
  console.log(`   Total AI words: ${totalWords}`);
  console.log(`   Speaking time: ~${Math.round(totalWords / 150)} minutes`);
  console.log(`   AI turns: ${history.filter(h => h.role === 'model').length}`);
  console.log(`   Avg words/turn: ${Math.round(totalWords / history.filter(h => h.role === 'model').length)}`);
  console.log(`   Questions asked: ${questionMarks}`);

  console.log(`\n📋 Findings Coverage: ${findingsCovered.length}/${reviewFindings.length}`);
  for (const f of reviewFindings) {
    const name = f.file.split('/').pop()!.replace('.js', '').replace('.json', '').toLowerCase();
    const covered = fullAiText.toLowerCase().includes(name);
    console.log(`   ${covered ? '✅' : '❌'} ${f.file} — ${f.message.substring(0, 50)}`);
  }

  console.log(`\n🧠 Concepts Taught: ${conceptsMentioned.length}`);
  for (const c of conceptsMentioned) {
    console.log(`   ✅ ${c}`);
  }

  console.log(`\n🔄 Wrong Answer Corrections: ${corrections.length}`);
  for (const c of corrections) {
    console.log(`   ✅ "${c}"`);
  }

  // Overall assessment
  console.log(`\n${'═'.repeat(60)}`);
  console.log('═══ HONEST ASSESSMENT ═══\n');

  const score = {
    overview: fullAiText.toLowerCase().includes('environment') ? 1 : 0,
    findingsCoverage: findingsCovered.length >= 3 ? 1 : 0,
    conceptTeaching: conceptsMentioned.length >= 5 ? 1 : 0,
    corrections: corrections.length >= 1 ? 1 : 0,
    questions: questionMarks >= 5 ? 1 : 0,
    wrapUp: fullAiText.toLowerCase().includes('score') || fullAiText.toLowerCase().includes('action') ? 1 : 0,
    changesNotWholeFile: !fullAiText.toLowerCase().includes('entire file') && !fullAiText.toLowerCase().includes('the file contains') ? 1 : 0,
  };

  const total = Object.values(score).reduce((a, b) => a + b, 0);
  const maxScore = Object.keys(score).length;

  console.log(`Criteria breakdown:`);
  for (const [key, val] of Object.entries(score)) {
    console.log(`  ${val ? '✅' : '❌'} ${key}`);
  }
  console.log(`\n  Overall: ${total}/${maxScore} (${Math.round(total/maxScore*100)}%)`);

  if (total >= 6) {
    console.log(`\n  🎉 VERDICT: A junior developer WOULD benefit from this session.`);
    console.log(`  The AI explained concepts, corrected misunderstandings, covered the findings,`);
    console.log(`  and focused on the changes rather than the whole file.`);
  } else if (total >= 4) {
    console.log(`\n  ⚠️  VERDICT: Partially beneficial but needs work.`);
  } else {
    console.log(`\n  ❌ VERDICT: Session quality is poor — junior dev wouldn't learn much.`);
  }

  console.log(`\n${'═'.repeat(60)}`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });

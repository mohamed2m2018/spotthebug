# 🐛 SpotTheBug

AI voice coding coach that talks to you and sees your screen. Hunt bugs, pair program, or solve challenges — powered by Gemini Live API.

## Prerequisites

- **Node.js** 20+
- **npm** 9+
- A **Gemini API Key** from [Google AI Studio](https://aistudio.google.com/apikey)
- (Optional) An **E2B API Key** from [e2b.dev](https://e2b.dev) — required for Problem Solve mode's sandboxed code execution

## Setup

### 1. Install dependencies

```bash
npm install --legacy-peer-deps
```

### 2. Configure environment variables

Create a `.env.local` file in the project root:

```bash
# Required
GEMINI_API_KEY=your_gemini_api_key_here

# Auth (generate a random secret for production)
NEXTAUTH_SECRET=any-random-string
NEXTAUTH_URL=http://localhost:3000

# Database (local SQLite — no external DB needed)
DATABASE_URL=file:./prisma/dev.db

# Optional — needed for Problem Solve mode (sandboxed code execution)
E2B_API_KEY=your_e2b_api_key_here
```

### 3. Set up the database

```bash
npx prisma generate
npx prisma db push
```

### 4. Run the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Reproducible Testing

### Testing Each Mode

#### 🔍 Bug Hunt Mode
1. Sign in from the login page
2. Select **"Bug Hunt"** from the dashboard
3. Click **"Start Session"** — the AI generates a grounded bug using Gemini + Google Search
4. Grant microphone access when prompted
5. The AI introduces the buggy code via voice — read the code and think out loud
6. Edit the code in the editor to fix the bug
7. The AI evaluates your fix using a grounded 2-phase pipeline and gives voice feedback
8. After the session, Google ADK evaluates the transcript and provides a performance summary

#### 🤝 Pair Programming Mode
1. Select **"Pair with AI"** from the dashboard
2. Choose your local project folder (File System Access API) — the AI reads your actual files
3. Select which changed files to review
4. Share your screen when prompted — the AI sees your editor live via multimodal vision (1fps)
5. Grant microphone access
6. The AI begins a file-by-file code review, referencing specific line numbers, all via real-time voice

#### 🧩 Problem Solve Mode
1. Select **"Problem Solve"** from the dashboard
2. The AI generates a coding challenge grounded via Google Search
3. Write your solution from scratch in the Monaco editor
4. Click **"Run Tests"** to execute your code in a sandboxed E2B environment (requires `E2B_API_KEY`)
5. The AI coaches you through voice — discussing your approach, reviewing your logic, giving hints

### Browser Requirements

- **Chrome/Edge** (recommended) — required for File System Access API (Pair mode) and Screen Capture API
- Microphone access — required for all voice modes
- Screen sharing permission — required for Pair mode

### Key API Endpoints

| Endpoint | Purpose |
|---|---|
| `POST /api/generate-bug` | 3-phase grounded bug generation (SSE stream) |
| `POST /api/evaluate-fix` | 2-phase grounded fix evaluation |
| `POST /api/generate-problem` | Grounded coding challenge generation |
| `POST /api/execute-code` | Sandboxed code execution via E2B |
| `POST /api/voice/token` | Ephemeral Gemini Live API token generation |
| `POST /api/review-code` | Pre-session code analysis for Pair mode |
| `POST /api/summarize-session` | Post-session ADK evaluation |

## Tech Stack

- **Gemini 2.5 Flash** (Native Audio) — real-time voice via Gemini Live API
- **Gemini Multimodal Vision** — live screen capture at 1fps
- **Google ADK** — post-session transcript evaluation
- **Google Search Grounding** — ensures bugs/challenges are based on real patterns
- **Google Cloud Run** — containerized deployment
- **Next.js 16** / React 19 / TypeScript
- **Prisma** + SQLite
- **Monaco Editor** — in-browser code editing
- **E2B** — sandboxed code execution
- **OpenTelemetry** + Langfuse — observability

## Project Structure

```
src/
├── app/
│   ├── api/
│   │   ├── generate-bug/     # 3-phase grounded bug generation
│   │   ├── evaluate-fix/     # 2-phase grounded fix evaluation
│   │   ├── generate-problem/ # Grounded challenge generation
│   │   ├── execute-code/     # E2B sandboxed execution
│   │   ├── voice/token/      # Ephemeral Gemini Live API tokens
│   │   ├── review-code/      # Pre-session code analysis
│   │   └── summarize-session/# ADK post-session evaluation
│   ├── dashboard/            # Mode selection
│   └── session/              # Active session page
├── components/
│   ├── HuntSession.tsx       # Bug Hunt mode UI
│   ├── PairSession.tsx       # Pair Programming mode UI
│   └── SolveSession.tsx      # Problem Solve mode UI
├── hooks/
│   ├── useHuntVoice.ts       # Hunt voice engine (Gemini Live API)
│   ├── usePairVoice.ts       # Pair voice engine (+ vision + function calling)
│   └── useProblemSolvingVoice.ts # Solve voice engine
└── config/
    └── prompts.ts            # Single source of truth for all AI prompts
```

## License

MIT

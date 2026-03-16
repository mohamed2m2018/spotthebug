/**
 * Client-side utility to record completed sessions to the database.
 * Calls POST /api/user-stats to persist session data via Prisma.
 */

interface RecordSessionParams {
  mode: 'hunt' | 'pair' | 'solve';
  duration: number; // seconds
  bugsFound?: number;
  bugDetails?: Array<{
    bugId: string;
    category: string;
    framework: string;
    identified: boolean;
    hintsUsed?: number;
    timeTaken?: number;
  }>;
}

export async function recordSession(params: RecordSessionParams): Promise<void> {
  try {
    await fetch('/api/user-stats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
  } catch (err) {
    // Non-blocking — don't crash the app if stats recording fails
    console.error('[Stats] Failed to record session:', err);
  }
}

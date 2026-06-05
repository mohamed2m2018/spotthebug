import { NextRequest, NextResponse } from "next/server";
import Database from "better-sqlite3";
import { SQL_SEED } from "@/config/sqlSandbox";

/**
 * POST /api/execute-sql
 *
 * Runs the learner's SQL against an in-memory SQLite database seeded with the
 * fixed practice schema. The DB is kept ALIVE per session (keyed by sessionId)
 * so DDL/DML persist across Run clicks — e.g. a CREATE TABLE in one query is
 * still there for the next. Without this each request got a fresh DB, so created
 * tables silently vanished.
 *
 * Pass { reset: true } to drop the session DB and reseed from scratch.
 */

export const runtime = "nodejs";

const MAX_ROWS = 200;
const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // evict idle session DBs after 2h
const MAX_SESSIONS = 50; // safety cap on concurrently held DBs

type Entry = { db: Database.Database; lastUsed: number };
// Module-scoped — survives across requests in the same server process.
const sessions = new Map<string, Entry>();

function sweep() {
  const now = Date.now();
  for (const [id, e] of sessions) {
    if (now - e.lastUsed > SESSION_TTL_MS) {
      try { e.db.close(); } catch { /* noop */ }
      sessions.delete(id);
    }
  }
  // If still over cap, evict least-recently-used.
  while (sessions.size > MAX_SESSIONS) {
    let oldestId: string | null = null;
    let oldest = Infinity;
    for (const [id, e] of sessions) {
      if (e.lastUsed < oldest) { oldest = e.lastUsed; oldestId = id; }
    }
    if (oldestId === null) break;
    try { sessions.get(oldestId)!.db.close(); } catch { /* noop */ }
    sessions.delete(oldestId);
  }
}

function getDb(sessionId: string, reset: boolean): Database.Database {
  if (reset) {
    const existing = sessions.get(sessionId);
    if (existing) { try { existing.db.close(); } catch { /* noop */ } sessions.delete(sessionId); }
  }
  let entry = sessions.get(sessionId);
  if (!entry) {
    const db = new Database(":memory:");
    db.exec(SQL_SEED); // seed practice schema once per session
    entry = { db, lastUsed: Date.now() };
    sessions.set(sessionId, entry);
    sweep();
  }
  entry.lastUsed = Date.now();
  return entry.db;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const sql: string = (body.sql || "").trim();
  const sessionId: string = (body.sessionId || "default").toString();
  const reset: boolean = !!body.reset;

  if (reset && !sql) {
    getDb(sessionId, true);
    return NextResponse.json({ message: "OK — practice database reset." });
  }
  if (!sql) return NextResponse.json({ error: "No query provided." }, { status: 400 });

  let db: Database.Database;
  try {
    db = getDb(sessionId, reset);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 200 });
  }

  try {
    // A statement that returns rows (SELECT / CTE / PRAGMA) vs one that doesn't.
    try {
      const stmt = db.prepare(sql);
      if (stmt.reader) {
        const rows = stmt.all() as Record<string, unknown>[];
        const columns = rows.length ? Object.keys(rows[0]) : stmt.columns().map((c) => c.name);
        return NextResponse.json({
          columns,
          rows: rows.slice(0, MAX_ROWS),
          truncated: rows.length > MAX_ROWS,
          rowCount: rows.length,
        });
      }
      const info = stmt.run();
      return NextResponse.json({ message: `OK — ${info.changes} row(s) affected.` });
    } catch {
      // Multiple statements or DDL/DML batch — run as a script.
      db.exec(sql);
      return NextResponse.json({ message: "OK — statements executed." });
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 200 });
  }
  // NOTE: do NOT close db here — it persists for the session.
}

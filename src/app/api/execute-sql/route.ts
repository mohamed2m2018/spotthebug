import { NextRequest, NextResponse } from "next/server";
import Database from "better-sqlite3";
import { SQL_SEED } from "@/config/sqlSandbox";

/**
 * POST /api/execute-sql
 *
 * Runs the learner's SQL against a throwaway in-memory SQLite database seeded
 * with the fixed practice schema. The DB is created and closed per request, so
 * queries are fully sandboxed (no shared/persistent state).
 */

export const runtime = "nodejs";

const MAX_ROWS = 200;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const sql: string = (body.sql || "").trim();
  if (!sql) return NextResponse.json({ error: "No query provided." }, { status: 400 });

  const db = new Database(":memory:");
  try {
    db.exec(SQL_SEED);

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
  } finally {
    db.close();
  }
}

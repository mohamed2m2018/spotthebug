/**
 * jsTracer — runs the learner's JavaScript and records a STEP-BY-STEP execution
 * trace (line + variables in scope at each step) so the UI can visualize memory,
 * loops, and the whole algorithm.
 *
 * How: Babel instruments the code, inserting `__step(line, () => ({ ...vars }))`
 * after each statement. Babel's scope analysis gives the in-scope variable names.
 * A step cap turns infinite loops into a clean stop instead of a frozen tab.
 *
 * Browser-only (uses @babel/standalone, loaded lazily by the caller).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Babel = any;

export interface TraceStep {
  line: number;
  vars: Record<string, unknown>;
}
export interface TraceResult {
  steps: TraceStep[];
  logs: string[];
  error?: string;
  truncated: boolean;
}

const MAX_STEPS = 4000;
const MAX_DEPTH = 3;
const MAX_ARRAY = 60;

/** Convert a runtime value into a small JSON-safe snapshot (cycle/depth capped). */
function snapshot(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value !== "object") {
    if (typeof value === "function") return "ƒ()";
    if (typeof value === "undefined") return undefined;
    if (typeof value === "bigint") return `${value}n`;
    return value;
  }
  if (seen.has(value as object)) return "↺ (circular)";
  seen.add(value as object);
  if (depth >= MAX_DEPTH) return Array.isArray(value) ? "[…]" : "{…}";
  if (Array.isArray(value)) {
    const out = value.slice(0, MAX_ARRAY).map((v) => snapshot(v, depth + 1, seen));
    if (value.length > MAX_ARRAY) out.push(`… +${value.length - MAX_ARRAY}`);
    return out;
  }
  if (value instanceof Map) {
    const o: Record<string, unknown> = { "«Map»": value.size };
    let i = 0;
    for (const [k, v] of value) { if (i++ >= MAX_ARRAY) break; o[String(k)] = snapshot(v, depth + 1, seen); }
    return o;
  }
  if (value instanceof Set) return { "«Set»": snapshot([...value], depth + 1, seen) };
  const o: Record<string, unknown> = {};
  let i = 0;
  for (const k of Object.keys(value as Record<string, unknown>)) {
    if (i++ >= MAX_ARRAY) break;
    o[k] = snapshot((value as Record<string, unknown>)[k], depth + 1, seen);
  }
  return o;
}

class StepLimit extends Error {}

/** Build the Babel instrumentation plugin. */
function makePlugin(Babel: Babel) {
  const t = Babel.packages.types;
  return {
    visitor: {
      Statement(path: any) {
        const node = path.node;
        // Don't instrument bare blocks or our own injected calls.
        if (t.isBlockStatement(node)) return;
        if (
          t.isExpressionStatement(node) &&
          t.isCallExpression(node.expression) &&
          t.isIdentifier(node.expression.callee, { name: "__step" })
        ) { path.skip(); return; }
        const line = node.loc?.start?.line;
        if (!line) return;
        // Only instrument statements that live inside a block/program (insertable).
        if (!path.inList && !t.isBlockStatement(path.parent) && !t.isProgram(path.parent)) return;

        // In-scope variable names. Skip let/const referenced before their declaration
        // line (TDZ) — keep params, vars, hoisted, and earlier-declared bindings.
        const bindings = path.scope.getAllBindings() as Record<string, any>;
        const names = Object.keys(bindings).filter((n) => {
          if (!/^[A-Za-z_$][\w$]*$/.test(n)) return false;
          const b = bindings[n];
          if (b.kind === "param" || b.kind === "var" || b.kind === "hoisted" || b.kind === "module") return true;
          const declLine = b.path?.node?.loc?.start?.line ?? Infinity;
          return declLine <= line;
        });
        const props = names.map((n) => t.objectProperty(t.identifier(n), t.identifier(n), false, true));
        const thunk = t.arrowFunctionExpression([], t.objectExpression(props));
        const call = t.expressionStatement(
          t.callExpression(t.identifier("__step"), [t.numericLiteral(line), thunk]),
        );
        try {
          // After return/throw/break/continue the step is unreachable — put it BEFORE.
          if (t.isReturnStatement(node) || t.isThrowStatement(node) || t.isBreakStatement(node) || t.isContinueStatement(node)) {
            path.insertBefore(call);
          } else {
            path.insertAfter(call);
          }
        } catch { /* not insertable here */ }
      },
    },
  };
}

/** Instrument + run `code`, returning the execution trace. */
export function traceJs(Babel: Babel, code: string): TraceResult {
  const steps: TraceStep[] = [];
  const logs: string[] = [];
  let truncated = false;

  let instrumented: string;
  try {
    const result = Babel.transform(code, {
      plugins: [makePlugin(Babel)],
      retainLines: false,
      sourceType: "script",
      compact: false,
    });
    instrumented = result.code as string;
  } catch (e) {
    return { steps, logs, truncated, error: `Couldn't parse the code: ${(e as Error).message}` };
  }

  const __step = (line: number, thunk: () => Record<string, unknown>) => {
    if (steps.length >= MAX_STEPS) { truncated = true; throw new StepLimit(); }
    let vars: Record<string, unknown> = {};
    try {
      const raw = thunk();
      for (const k of Object.keys(raw)) vars[k] = snapshot(raw[k]);
    } catch { /* value not available yet */ }
    steps.push({ line, vars });
  };
  const fakeConsole = {
    log: (...a: unknown[]) => logs.push(a.map((x) => fmt(x)).join(" ")),
    error: (...a: unknown[]) => logs.push(a.map((x) => fmt(x)).join(" ")),
    warn: (...a: unknown[]) => logs.push(a.map((x) => fmt(x)).join(" ")),
  };

  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function("__step", "console", `"use strict";\n${instrumented}`);
    fn(__step, fakeConsole);
  } catch (e) {
    if (!(e instanceof StepLimit)) {
      return { steps, logs, truncated, error: (e as Error).message };
    }
  }
  return { steps, logs, truncated };
}

function fmt(x: unknown): string {
  if (typeof x === "object" && x !== null) {
    try { return JSON.stringify(snapshot(x)); } catch { return String(x); }
  }
  return String(x);
}

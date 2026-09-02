import { enqueue } from "./queue.js";
import { getConfig, isInitialized } from "./core.js";
import { currentSessionId } from "./session.js";
import type { EventRecord } from "./types.js";

const DEDUP_WINDOW_MS = 5_000;

// Keyed by "message::source" → timestamp of last emission.
const recentErrors = new Map<string, number>();

let installed = false;
let origConsoleError: ((...args: unknown[]) => void) | null = null;

function base(): Omit<EventRecord, "type" | "name"> {
  const cfg = getConfig();
  return {
    ts: Date.now(),
    app: cfg.app,
    user_id: cfg.user.id,
    session_id: currentSessionId(),
    url: typeof location !== "undefined" ? location.href : undefined,
  };
}

function shouldDedup(key: string, now = Date.now()): boolean {
  const last = recentErrors.get(key);
  if (last !== undefined && now - last < DEDUP_WINDOW_MS) return true;
  recentErrors.set(key, now);
  return false;
}

function emitError(
  message: string,
  source?: string,
  line?: number,
  col?: number,
  stack?: string,
): void {
  if (!isInitialized()) return;
  const key = `${message}::${source ?? ""}`;
  if (shouldDedup(key)) return;

  const props: Record<string, unknown> = {};
  if (source !== undefined) props.source = source;
  if (line !== undefined) props.line = line;
  if (col !== undefined) props.col = col;
  if (stack !== undefined) props.stack = stack;

  enqueue({ ...base(), type: "error", name: message, props });
}

/**
 * Whether a console.error call is a styled devtools group rather than a real
 * error.
 *
 * `%c` is a devtools *styling* directive — it exists only to colour console
 * output, and the arguments that follow it are CSS, not information. Logging
 * libraries use it for pretty grouped output and reach for console.error for
 * the whole group, successful operations included. tRPC's development logger
 * does exactly this, which made every successful query show up as an error and
 * put the app's error count an order of magnitude out.
 *
 * The test is narrow on purpose: a genuine error message does not begin with
 * `%c`, and nothing that does not begin with `%c` is suppressed.
 */
function isStyledGroupLog(args: unknown[]): boolean {
  return typeof args[0] === "string" && args[0].startsWith("%c");
}

export function startErrorTracking(): void {
  if (installed) return;
  if (typeof window === "undefined") return;
  installed = true;

  window.addEventListener("error", (e: ErrorEvent) => {
    emitError(
      e.message || "unknown error",
      e.filename || undefined,
      e.lineno || undefined,
      e.colno || undefined,
      e.error instanceof Error ? e.error.stack : undefined,
    );
  });

  window.addEventListener("unhandledrejection", (e: PromiseRejectionEvent) => {
    const reason = e.reason;
    const message =
      reason instanceof Error ? reason.message : String(reason ?? "unhandled rejection");
    const stack = reason instanceof Error ? reason.stack : undefined;
    emitError(message, "unhandledrejection", undefined, undefined, stack);
  });

  // Patch console.error so explicit error logging is also captured.
  origConsoleError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    origConsoleError!(...args);
    if (!isInitialized()) return;
    if (isStyledGroupLog(args)) return;
    const message = args.map((a) => (a instanceof Error ? a.message : String(a))).join(" ");
    const errArg = args.find((a): a is Error => a instanceof Error);
    emitError(message, "console.error", undefined, undefined, errArg?.stack);
  };
}

/** Reset all error tracking state — for testing only. */
export function _resetErrors(): void {
  if (origConsoleError) {
    console.error = origConsoleError;
    origConsoleError = null;
  }
  installed = false;
  recentErrors.clear();
}

/** Expose dedup map size — for testing only. */
export function _dedupSize(): number {
  return recentErrors.size;
}

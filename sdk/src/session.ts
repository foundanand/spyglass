const SESSION_KEY = "sg_session_id";
const LAST_ACTIVITY_KEY = "sg_last_activity";
const IDLE_MS = 30 * 60 * 1000;

// Fallback when sessionStorage is unavailable: private mode, an iframe with
// storage blocked, Safari lockdown, or a browser configured to refuse site data.
//
// Every event goes through currentSessionId() — capture, pageview, error,
// network, flow — so an unguarded read here does not degrade one feature, it
// throws on the whole SDK. sdk/src/flow.ts and sdk/src/replay.ts both already
// keep an in-memory fallback for exactly this; session state was the one place
// that assumed storage always works.
//
// The session then lives for the page rather than surviving navigation, which
// is a real loss but a far smaller one than the SDK not running at all.
let memorySessionID: string | null = null;
let memoryLastActivity = 0;

function readStorage(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return key === SESSION_KEY ? memorySessionID : String(memoryLastActivity);
  }
}

function writeStorage(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    if (key === SESSION_KEY) memorySessionID = value;
    else memoryLastActivity = Number(value) || 0;
  }
}

function randomId(): string {
  // crypto.randomUUID is available in all modern browsers + Node 19+.
  // Fallback for environments that don't have it (e.g. old jsdom).
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/**
 * Returns the current session ID, minting a new one if absent or if the last
 * activity was more than 30 minutes ago.
 *
 * @param now - injectable clock for testing (defaults to Date.now())
 */
export function currentSessionId(now = Date.now()): string {
  const existing = readStorage(SESSION_KEY);
  const lastActivity = Number(readStorage(LAST_ACTIVITY_KEY) ?? "0");

  if (existing && now - lastActivity < IDLE_MS) {
    writeStorage(LAST_ACTIVITY_KEY, String(now));
    return existing;
  }

  const id = randomId();
  writeStorage(SESSION_KEY, id);
  writeStorage(LAST_ACTIVITY_KEY, String(now));
  return id;
}

/** Clear session state — for testing only. */
export function _resetSession(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(LAST_ACTIVITY_KEY);
  } catch {
    // storage unavailable; the memory fallback below is the whole state
  }
  memorySessionID = null;
  memoryLastActivity = 0;
}

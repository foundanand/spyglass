const SESSION_KEY = "sg_session_id";
const LAST_ACTIVITY_KEY = "sg_last_activity";
const IDLE_MS = 30 * 60 * 1000;

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
  const existing = sessionStorage.getItem(SESSION_KEY);
  const lastActivity = Number(sessionStorage.getItem(LAST_ACTIVITY_KEY) ?? "0");

  if (existing && now - lastActivity < IDLE_MS) {
    sessionStorage.setItem(LAST_ACTIVITY_KEY, String(now));
    return existing;
  }

  const id = randomId();
  sessionStorage.setItem(SESSION_KEY, id);
  sessionStorage.setItem(LAST_ACTIVITY_KEY, String(now));
  return id;
}

/** Clear session state — for testing only. */
export function _resetSession(): void {
  sessionStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(LAST_ACTIVITY_KEY);
}

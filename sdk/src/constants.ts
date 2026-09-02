// Shared defaults. Lives in its own module so core.ts (which applies defaults)
// and the feature modules (which read them) never import each other.

/**
 * A flow left open longer than this is treated as forgotten rather than slow —
 * the user wandered off, locked the laptop, went to lunch. Ending one reports
 * nothing instead of poisoning the percentiles with a four-hour "task
 * creation". Matches the 30-minute session idle window in session.ts.
 */
export const DEFAULT_FLOW_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * An "abandonment" shorter than this is not a person giving up — it is a
 * component remounting. React StrictMode runs every effect mount → cleanup →
 * mount in development, so a flow started on mount and cancelled on cleanup
 * emits a 0ms abandonment on every single page visit, and the abandon rate for
 * that flow reads as ~50% forever.
 *
 * The gap is wide and unambiguous: a remount cancels within the same tick
 * (0–5ms), while the fastest human decision to bail out — opening a dialog and
 * hitting Escape — is a couple of hundred milliseconds. 100ms sits between the
 * two, so no real abandonment is lost.
 *
 * Completions are never filtered: an action that genuinely completes in 40ms is
 * a real (and interesting) measurement.
 */
export const DEFAULT_MIN_ABANDON_MS = 100;

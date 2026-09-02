// Session context: where the session happened.
//
// spyglass records what happened and how long it took, and until now recorded
// nothing about the environment it happened in. That is the single biggest
// multiplier on data already being collected — every existing metric becomes
// several:
//
//   "task creation takes 52s"        → on mobile it takes 2m10s
//   "9 errors this week"             → all of them Safari
//   "the invoice form is abandoned"  → 45% under 1400px, where the grid wraps
//
// Without it, user and day are the only two axes that exist to slice by.
//
// Collected once per session and attached to the session row, not to every
// event: this is per-session context, and repeating it on 254 network events
// would inflate the store for nothing.
//
// Privacy: this is the first thing spyglass records that the user did not do
// deliberately, so it stays deliberately boring. No canvas, no font
// enumeration, no WebGL, no plugin list — nothing that builds a fingerprint.
// No IP address; the collector does not log or store one. Coarse, useful fields
// only, and `context: false` turns the whole thing off.

export interface SessionContext {
  viewport_w?: number;
  viewport_h?: number;
  /** Coarse width band — the axis you actually group by. See VIEWPORT_BANDS. */
  viewport_bucket?: string;
  screen_w?: number;
  screen_h?: number;
  dpr?: number;
  /** Raw UA string. Parsed in the dashboard, never here — a UA parser is
   *  several KB against a 5KB budget, and the raw value stays honest. */
  ua?: string;
  language?: string;
  tz?: string;
  referrer?: string;
  connection?: string;
}

// Bands chosen where layouts actually break, not on device marketing names.
const VIEWPORT_BANDS: [number, string][] = [
  [640, "mobile"],
  [1024, "tablet"],
  [1440, "laptop"],
];

function viewportBucket(w: number): string {
  for (const [max, label] of VIEWPORT_BANDS) {
    if (w < max) return label;
  }
  return "desktop";
}

/**
 * Collect session context. Every field is optional and individually guarded:
 * this runs in jsdom, in SSR shims and in old browsers, and must never throw.
 */
export function collectContext(): SessionContext {
  const ctx: SessionContext = {};
  try {
    if (typeof window !== "undefined") {
      if (typeof window.innerWidth === "number" && window.innerWidth > 0) {
        ctx.viewport_w = window.innerWidth;
        ctx.viewport_bucket = viewportBucket(window.innerWidth);
      }
      if (typeof window.innerHeight === "number") ctx.viewport_h = window.innerHeight;
      if (typeof window.devicePixelRatio === "number") ctx.dpr = window.devicePixelRatio;
      if (typeof screen !== "undefined") {
        if (typeof screen.width === "number") ctx.screen_w = screen.width;
        if (typeof screen.height === "number") ctx.screen_h = screen.height;
      }
    }
    if (typeof navigator !== "undefined") {
      if (navigator.userAgent) ctx.ua = navigator.userAgent;
      if (navigator.language) ctx.language = navigator.language;
      // Not in Safari; explains a slow flow when it is there.
      const conn = (navigator as { connection?: { effectiveType?: string } }).connection;
      if (conn?.effectiveType) ctx.connection = conn.effectiveType;
    }
    if (typeof document !== "undefined" && document.referrer) {
      ctx.referrer = document.referrer;
    }
    if (typeof Intl !== "undefined") {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (tz) ctx.tz = tz;
    }
  } catch {
    // A partial context is worth more than none.
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// User traits
// ---------------------------------------------------------------------------

/** Hard caps, so a trait bag cannot quietly become a payload. */
const MAX_TRAITS = 24;
const MAX_TRAIT_KEY = 40;
const MAX_TRAIT_VALUE = 120;

/**
 * Narrow arbitrary input to the scalar cohort attributes traits are for.
 *
 * Objects, arrays and functions are dropped rather than serialised: traits are
 * the easiest place for somebody to park a whole user record, and the point is
 * to group by them, which only makes sense for scalars. Strings are truncated;
 * anything past the count cap is ignored.
 */
export function sanitizeTraits(
  input: Record<string, unknown> | undefined,
): Record<string, string | number | boolean | null> | undefined {
  if (!input) return undefined;
  const out: Record<string, string | number | boolean | null> = {};
  let n = 0;
  for (const key of Object.keys(input)) {
    if (n >= MAX_TRAITS) break;
    if (!key || key.length > MAX_TRAIT_KEY) continue;
    const v = input[key];
    if (v === null) {
      out[key] = null;
    } else if (typeof v === "string") {
      out[key] = v.length > MAX_TRAIT_VALUE ? v.slice(0, MAX_TRAIT_VALUE) : v;
    } else if (typeof v === "number") {
      if (!Number.isFinite(v)) continue;
      out[key] = v;
    } else if (typeof v === "boolean") {
      out[key] = v;
    } else {
      continue; // objects, arrays, functions, symbols, undefined
    }
    n++;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

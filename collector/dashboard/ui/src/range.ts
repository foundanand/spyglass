// The time window every view is read through.
//
// Before this existed, every dashboard query was all-time. That is fine on day
// three and useless on day ninety: "typical time to create a task" averages in
// the week the feature shipped broken, forever, and there is no way to ask
// whether Tuesday's change helped — which is the entire reason to measure a
// duration.
//
// One range, owned by App.tsx and applied to every panel, rather than a picker
// per view: the point is comparing panels against the *same* window.

export type RangeKey = "24h" | "7d" | "30d" | "90d" | "all";

export interface TimeRange {
  key: RangeKey;
  /** Unix ms, or undefined for unbounded (the "all" preset). */
  from?: number;
  label: string;
}

/** Presets, in the order they appear in the control. */
export const RANGES: { key: RangeKey; label: string; days: number | null }[] = [
  { key: "24h", label: "24h", days: 1 },
  { key: "7d", label: "7d", days: 7 },
  { key: "30d", label: "30d", days: 30 },
  { key: "90d", label: "90d", days: 90 },
  { key: "all", label: "All", days: null },
];

// 30 days, not all-time. A default that silently degrades as the database grows
// is the bug this module exists to fix.
export const DEFAULT_RANGE: RangeKey = "30d";

const DAY_MS = 86_400_000;

export function isRangeKey(v: string | null | undefined): v is RangeKey {
  return !!v && RANGES.some((r) => r.key === v);
}

export function resolveRange(key: RangeKey, now = Date.now()): TimeRange {
  const preset = RANGES.find((r) => r.key === key) ?? RANGES[2];
  return {
    key: preset.key,
    from: preset.days === null ? undefined : now - preset.days * DAY_MS,
    label: preset.label,
  };
}

/**
 * Append the window to a query string.
 *
 * `to` is deliberately left unbounded: every preset is "the last N days up to
 * now", and pinning an upper bound at render time would quietly exclude events
 * arriving while the page is open.
 */
export function applyRange(params: URLSearchParams, range: TimeRange): URLSearchParams {
  if (range.from !== undefined) params.set("from", String(Math.floor(range.from)));
  return params;
}

/**
 * The viewer's offset in minutes east of UTC, for day-bucketed aggregates.
 *
 * getTimezoneOffset() is minutes *behind* UTC (IST returns -330), so the sign is
 * flipped to match the convention the collector expects.
 */
export function tzOffsetMinutes(): number {
  return -new Date().getTimezoneOffset();
}

// @spyglass/sdk — public entry. Phase 0 ships only the shape; init/capture and
// the rest land across Phase 1+ (see tasks/). Keep this core tiny (§5: ≤5KB gz);
// rrweb and autocapture must be lazy-imported, never referenced from here.

/** Library version, stamped at publish time. */
export const VERSION = "0.0.0";

/**
 * The singleton entry point. Methods are added by their Phase 1+ tasks
 * (p1-sdk-init, p1-sdk-capture, p4-sdk-report-*). Placeholder for now so the
 * package has a stable export surface.
 */
export const spyglass = {
  version: VERSION,
} as const;

export type Spyglass = typeof spyglass;

// The one place that decides what "spyglass is running" means.
//
// `spyglass.init()` and the Next.js `<SpyglassProvider>` are two doors into the
// same room, and they used to furnish it differently: the provider called
// init() + registerBeacon() and nothing else, so an app that followed the
// documented app-router setup got pageviews but no error tracking, no network
// timing, no replay and no bug-report widget — none of which is obvious from
// the outside, because events *do* arrive. Both doors now call this.

import { init as initConfig } from "./core.js";
import { registerBeacon } from "./beacon.js";
import { startErrorTracking } from "./errors.js";
import { startNetworkTracking } from "./network.js";
import type { SpyglassConfig } from "./types.js";

/**
 * Initialize the SDK and start every enabled capture channel.
 *
 * Safe to call more than once: each channel guards its own installation, so a
 * remount re-reads the config without double-patching fetch or stacking a
 * second rrweb recorder.
 */
export function startAll(config: SpyglassConfig): void {
  initConfig(config);
  registerBeacon();
  startErrorTracking();
  startNetworkTracking();
  if (config.replay !== false) {
    void import("./replay.js").then((m) => m.startReplay());
  }
  if (config.reportWidget !== false) {
    void import("./widget.js").then((m) => m.initWidget());
  }
}

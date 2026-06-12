// @spyglass/sdk — public entry. Keep this core tiny (§5: ≤5KB gz).
// rrweb and autocapture are lazy-imported by their own modules, never from here.

export const VERSION = "0.0.0";

import { init as _init, updateUser } from "./core.js";
import { registerBeacon } from "./beacon.js";
import { capture, pageview, report as _report } from "./capture.js";
import { flush } from "./queue.js";
import { startErrorTracking } from "./errors.js";
import { startNetworkTracking } from "./network.js";
import type { SpyglassConfig, UserConfig } from "./types.js";

export const spyglass = {
  version: VERSION,

  init(config: SpyglassConfig): void {
    _init(config);
    registerBeacon();
    startErrorTracking();
    startNetworkTracking();
    if (config.replay !== false) {
      void import("./replay.js").then((m) => m.startReplay());
    }
    if (config.reportWidget !== false) {
      void import("./widget.js").then((m) => m.initWidget());
    }
  },

  capture(name: string, props?: Record<string, unknown>): void {
    capture(name, props);
  },

  pageview(url?: string): void {
    pageview(url);
  },

  setUser(user: UserConfig): void {
    updateUser(user);
  },

  /** Submit a programmatic bug report. */
  report(comment: string, extra?: Record<string, unknown>): void {
    _report(comment, extra);
  },

  /** Force-flush the event queue (e.g. before programmatic navigation). */
  flush(): void {
    flush();
  },
};

export type { SpyglassConfig, UserConfig } from "./types.js";

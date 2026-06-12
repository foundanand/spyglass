// @spyglass/sdk — public entry. Keep this core tiny (§5: ≤5KB gz).
// rrweb and autocapture are lazy-imported by their own modules, never from here.

export const VERSION = "0.0.0";

import { init as _init, updateUser } from "./core.js";
import { registerBeacon } from "./beacon.js";
import { capture, pageview } from "./capture.js";
import { flush } from "./queue.js";
import type { SpyglassConfig, UserConfig } from "./types.js";

export const spyglass = {
  version: VERSION,

  init(config: SpyglassConfig): void {
    _init(config);
    registerBeacon();
    if (config.replay !== false) {
      void import("./replay.js").then((m) => m.startReplay());
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

  /** Force-flush the event queue (e.g. before programmatic navigation). */
  flush(): void {
    flush();
  },
};

export type { SpyglassConfig, UserConfig } from "./types.js";

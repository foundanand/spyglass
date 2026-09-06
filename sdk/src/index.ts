// @foundanand/spyglass-sdk — public entry. Keep this core tiny (§5: ≤5KB gz).
// rrweb is lazy-imported by its own module, never from here.

// Injected at build time from package.json — see build.ts (esbuild `define`)
// and vitest.config.ts, which define it identically so tests see a real value.
//
// It used to be typed in by hand, and had already drifted: the package published
// as 0.0.1 while the SDK reported 0.0.0 to the collector. That matters more here
// than in most libraries, because reporting accurately on the app it is embedded
// in is the entire job of this package.
declare const __SPYGLASS_VERSION__: string;
export const VERSION: string = __SPYGLASS_VERSION__;

import { updateUser } from "./core.js";
import { capture, pageview, report as _report } from "./capture.js";
import { flush } from "./queue.js";
import { startAll } from "./start.js";
import {
  activeFlows,
  cancelFlow,
  endFlow,
  failFlow,
  flow,
  isFlowActive,
  startFlow,
} from "./flow.js";
import type { FlowHandle } from "./flow.js";
import type { SpyglassConfig, UserConfig } from "./types.js";

export const spyglass = {
  version: VERSION,

  init(config: SpyglassConfig): void {
    startAll(config);
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

  // ── Flow timing ───────────────────────────────────────────────────────────
  // How long an action takes, not just how often it happens. See flow.ts.

  /** Start timing a named flow (e.g. when the create-task form opens). */
  startFlow(name: string, props?: Record<string, unknown>): void {
    startFlow(name, props);
  },

  /** Finish a flow successfully; returns the elapsed ms (null if never started). */
  endFlow(name: string, props?: Record<string, unknown>): number | null {
    return endFlow(name, props);
  },

  /** Record that the user gave up on a flow. */
  cancelFlow(name: string, reason?: string, props?: Record<string, unknown>): number | null {
    return cancelFlow(name, reason, props);
  },

  /** Record that a flow ended in a failure the user did not cause. */
  failFlow(name: string, reason?: string, props?: Record<string, unknown>): number | null {
    return failFlow(name, reason, props);
  },

  /** Start a flow and get a handle that closes it — for same-scope start/end. */
  flow(name: string, props?: Record<string, unknown>): FlowHandle {
    return flow(name, props);
  },

  /** Whether a flow is currently open. */
  isFlowActive(name: string): boolean {
    return isFlowActive(name);
  },

  /** Names of every open flow. */
  activeFlows(): string[] {
    return activeFlows();
  },
};

export { startAll } from "./start.js";
export type { FlowHandle } from "./flow.js";
export type { FlowOutcome, SpyglassConfig, UserConfig } from "./types.js";

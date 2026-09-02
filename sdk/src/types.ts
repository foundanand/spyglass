export interface UserConfig {
  id: string;
  name?: string;
  email?: string;
}

export interface NetworkConfig {
  bodies?: string[]; // URL prefixes allowed for body capture (Phase 3+)
}

export interface SpyglassConfig {
  /** Collector base URL, e.g. "https://telemetry.internal.acme.dev" */
  endpoint: string;
  /** App slug, matches a key in the collector config */
  app: string;
  /** App key for ingest authentication */
  key: string;
  /** Identified user — all sessions are authenticated (§2 non-goals) */
  user: UserConfig;
  /** Enable rrweb session replay. Default: true */
  replay?: boolean;
  /** Enable autocapture of clicks + form changes. Default: false */
  autocapture?: boolean;
  /** Enable network request recording. Default: true */
  network?: boolean | NetworkConfig;
  /** Input masking level. Default: "password" */
  maskInputs?: "all" | "password" | "none";
  /** Show floating bug-report button. Default: true */
  reportWidget?: boolean;
  /**
   * How long a flow may stay open before it is treated as forgotten rather
   * than slow (see flow.ts). Default: 30 minutes.
   */
  flowTimeoutMs?: number;
  /**
   * Ignore abandonments and failures shorter than this, which are component
   * remounts rather than decisions (see constants.ts). Default: 100ms.
   * Set to 0 to record every one.
   */
  minAbandonMs?: number;
}

/** How a timed flow ended. */
export type FlowOutcome = "completed" | "abandoned" | "failed";

/** Internal resolved config — all fields have defaults applied. */
export interface ResolvedConfig extends Required<Omit<SpyglassConfig, "network">> {
  network: boolean | NetworkConfig;
}

/** The shape of every event sent to the collector. */
export interface EventRecord {
  ts: number;
  app: string;
  user_id: string;
  session_id: string;
  type: "event" | "pageview" | "error" | "network" | "bug_report" | "flow";
  name: string;
  url?: string;
  props?: Record<string, unknown>;
}

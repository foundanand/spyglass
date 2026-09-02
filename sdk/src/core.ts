import { DEFAULT_FLOW_TIMEOUT_MS, DEFAULT_MIN_ABANDON_MS } from "./constants.js";
import type { ResolvedConfig, SpyglassConfig, UserConfig } from "./types.js";

let _config: ResolvedConfig | null = null;

/** Initialize the SDK. Throws if required fields are missing. */
export function init(config: SpyglassConfig): void {
  if (!config.endpoint) throw new Error("spyglass: endpoint is required");
  if (!config.app) throw new Error("spyglass: app is required");
  if (!config.key) throw new Error("spyglass: key is required");
  if (!config.user?.id) throw new Error("spyglass: user.id is required");

  _config = {
    replay: true,
    context: true,
    network: true,
    maskInputs: "password",
    reportWidget: true,
    flowTimeoutMs: DEFAULT_FLOW_TIMEOUT_MS,
    minAbandonMs: DEFAULT_MIN_ABANDON_MS,
    ...config,
  };
}

/** Returns the resolved config. Throws if init() has not been called. */
export function getConfig(): ResolvedConfig {
  if (!_config) throw new Error("spyglass: call init() first");
  return _config;
}

/** Returns true if the SDK has been initialized. */
export function isInitialized(): boolean {
  return _config !== null;
}

/** Update the identified user after init. */
export function updateUser(user: UserConfig): void {
  if (!_config) throw new Error("spyglass: call init() first");
  _config.user = { ..._config.user, ...user };
}

/** Reset state — for testing only. */
export function _reset(): void {
  _config = null;
}

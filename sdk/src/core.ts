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
    autocapture: false,
    network: true,
    maskInputs: "password",
    reportWidget: true,
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

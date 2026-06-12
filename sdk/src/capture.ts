import { getConfig, updateUser } from "./core.js";
import { enqueue } from "./queue.js";
import { currentSessionId } from "./session.js";
import type { EventRecord, UserConfig } from "./types.js";

function base(): Omit<EventRecord, "type" | "name"> {
  const cfg = getConfig();
  return {
    ts: Date.now(),
    app: cfg.app,
    user_id: cfg.user.id,
    session_id: currentSessionId(),
    url: typeof location !== "undefined" ? location.href : undefined,
  };
}

/** Track a named custom event. */
export function capture(name: string, props?: Record<string, unknown>): void {
  enqueue({ ...base(), type: "event", name, props });
}

/** Track a page view. Defaults to the current pathname. */
export function pageview(url?: string): void {
  const resolvedUrl = url ?? (typeof location !== "undefined" ? location.pathname : "");
  enqueue({ ...base(), type: "pageview", name: resolvedUrl, url: resolvedUrl });
}

/** Submit a programmatic bug report. */
export function report(comment: string, extra?: Record<string, unknown>): void {
  enqueue({ ...base(), type: "bug_report", name: comment, props: extra });
}

/** Update the identified user; all subsequent events use the new identity. */
export function setUser(user: UserConfig): void {
  updateUser(user);
}

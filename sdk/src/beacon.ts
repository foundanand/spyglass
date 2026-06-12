import { flush } from "./queue.js";

let registered = false;

/** Register visibilitychange / pagehide listeners to flush on tab close. Safe to call multiple times. */
export function registerBeacon(): void {
  if (registered || typeof window === "undefined") return;
  registered = true;

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      flush(true);
    }
  });

  window.addEventListener("pagehide", () => {
    flush(true);
  });
}

/** Reset beacon state — for testing only. */
export function _resetBeacon(): void {
  registered = false;
}

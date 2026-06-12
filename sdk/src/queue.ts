import { getConfig, isInitialized } from "./core.js";
import { postJSON } from "./transport.js";
import type { EventRecord } from "./types.js";

const FLUSH_INTERVAL_MS = 5_000;
const MAX_QUEUE_SIZE = 20;

let queue: EventRecord[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;

/** Enqueue an event. Flushes immediately when the queue reaches MAX_QUEUE_SIZE. */
export function enqueue(event: EventRecord): void {
  if (!isInitialized()) return; // drop if not initialised
  queue.push(event);
  if (queue.length >= MAX_QUEUE_SIZE) {
    flush();
  } else if (!timer) {
    timer = setTimeout(flush, FLUSH_INTERVAL_MS);
  }
}

/**
 * Flush the pending queue.
 *
 * @param useSendBeacon - use navigator.sendBeacon instead of fetch (tab-close path)
 */
export function flush(useSendBeacon = false): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (!queue.length || !isInitialized()) return;

  const batch = queue.splice(0, queue.length);
  const { endpoint, app, key } = getConfig();
  const url = `${endpoint}/v1/events`;
  const body = JSON.stringify({ app, key, events: batch });

  if (useSendBeacon && typeof navigator !== "undefined" && navigator.sendBeacon) {
    const sent = navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
    if (!sent) {
      // sendBeacon failed (quota exceeded); re-queue at front.
      queue.unshift(...batch);
    }
    return;
  }

  if (!flushing) {
    flushing = true;
    postJSON(url, body)
      .then((ok) => {
        if (!ok) queue.unshift(...batch);
      })
      .finally(() => {
        flushing = false;
      });
  }
}

/** Reset queue state — for testing only. */
export function _resetQueue(): void {
  queue = [];
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  flushing = false;
}

/** Expose queue length — for testing only. */
export function _queueLength(): number {
  return queue.length;
}

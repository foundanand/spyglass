import { collectContext, sanitizeTraits } from "./context.js";
import { getConfig, isInitialized } from "./core.js";
import { postJSON } from "./transport.js";
import type { EventRecord } from "./types.js";

const FLUSH_INTERVAL_MS = 5_000;
const MAX_QUEUE_SIZE = 20;

let queue: EventRecord[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;

// Session context rides on the first batch of each session, not on every event.
// Module state, so it is re-sent once per page load — which is what we want:
// a session that starts maximised and ends in a split pane has two answers for
// viewport, and the collector keeps the most recent.
//
// Keyed by session *and* traits, so setUser() changing a role re-sends rather
// than leaving the session labelled with the old cohort.
let metaSentFor: string | null = null;

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

  // A POST is already in flight. Leave the events queued and come back for
  // them: the batch used to be spliced out before this check, so a flush during
  // an in-flight request dropped those events on the floor — silently, and most
  // often on exactly the slow connections where a second flush is likeliest.
  //
  // sendBeacon is exempt: it is the tab-close path, it does not set `flushing`,
  // and there is no later flush to come back for.
  if (flushing && !useSendBeacon) {
    if (!timer) timer = setTimeout(flush, FLUSH_INTERVAL_MS);
    return;
  }

  const batch = queue.splice(0, queue.length);
  const cfg = getConfig();
  const { endpoint, app, key } = cfg;
  const url = `${endpoint}/v1/events`;

  const payload: Record<string, unknown> = { app, key, events: batch };
  const sessionID = batch[0]?.session_id;
  let sentMeta = false;

  // Traits ride in the same `meta` blob as device context rather than in a
  // parallel system: one wire field, one storage column, one grouping syntax.
  // Recording them per session also makes them honest over time — a task filed
  // while someone was an Employee stays attributed that way.
  //
  // `context: false` suppresses the environment fields but not traits: the
  // switch is about what the SDK observes on its own, and traits are declared
  // by the host app.
  const traits = sanitizeTraits(cfg.user.traits);
  const traitKey = traits ? JSON.stringify(traits) : "";
  const stamp = sessionID ? sessionID + "\u0000" + traitKey : "";

  if (stamp && metaSentFor !== stamp) {
    const meta: Record<string, unknown> = cfg.context ? { ...collectContext() } : {};
    if (traits) meta.traits = traits;
    if (Object.keys(meta).length > 0) {
      payload.meta = meta;
      sentMeta = true;
    }
    metaSentFor = stamp;
  }
  const body = JSON.stringify(payload);

  if (useSendBeacon && typeof navigator !== "undefined" && navigator.sendBeacon) {
    const sent = navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
    if (!sent) {
      // sendBeacon failed (quota exceeded); re-queue at front.
      queue.unshift(...batch);
      if (sentMeta) metaSentFor = null;
    }
    return;
  }

  {
    flushing = true;
    postJSON(url, body)
      .then((ok) => {
        if (!ok) {
          queue.unshift(...batch);
          // The context went out with a batch that bounced; let it ride again.
          if (sentMeta) metaSentFor = null;
        }
      })
      .finally(() => {
        flushing = false;
      });
  }
}

/** Reset queue state — for testing only. */
export function _resetQueue(): void {
  queue = [];
  metaSentFor = null;
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

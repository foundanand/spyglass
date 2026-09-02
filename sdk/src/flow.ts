// Flow timing — how long a multi-step user action actually takes.
//
// Counts answer "how many people created a task"; they cannot answer "how long
// does creating one take". A flow is the span between a user *starting* an
// action and *finishing* (or giving up on) it: opening the create-task form and
// the task landing in the database, say.
//
// The duration is computed on the client and shipped as a single `flow` event
// carrying `duration_ms` and an `outcome`. The alternative — emitting a start
// and an end event and pairing them in SQL — costs twice the events, and pairs
// wrongly whenever one half is dropped, the user opens two tabs, or the flow
// spans a session boundary. One event per flow keeps the collector's job to
// plain aggregation over a number that is already correct.
//
// Open flows live in sessionStorage, so a flow survives navigation within the
// tab (a wizard spanning three pages is still one flow) and dies with the tab.

import { DEFAULT_FLOW_TIMEOUT_MS, DEFAULT_MIN_ABANDON_MS } from "./constants.js";
import { getConfig, isInitialized } from "./core.js";
import { enqueue } from "./queue.js";
import { currentSessionId } from "./session.js";
import type { EventRecord, FlowOutcome } from "./types.js";

const STORAGE_KEY = "sg_flows";

interface OpenFlow {
  startedAt: number;
  props?: Record<string, unknown>;
}

type FlowMap = Record<string, OpenFlow>;

// Fallback when sessionStorage is unavailable (SSR, privacy mode, iframe with
// storage blocked). Flows then live for the page, which is still useful.
let memory: FlowMap = {};

function read(): FlowMap {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as FlowMap;
  } catch {
    return memory;
  }
}

function write(flows: FlowMap): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(flows));
  } catch {
    memory = flows;
  }
}

function timeoutMs(): number {
  if (!isInitialized()) return DEFAULT_FLOW_TIMEOUT_MS;
  return getConfig().flowTimeoutMs;
}

function minAbandonMs(): number {
  if (!isInitialized()) return DEFAULT_MIN_ABANDON_MS;
  return getConfig().minAbandonMs;
}

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

/**
 * Mark the start of a timed flow.
 *
 * Starting a flow that is already open restarts its clock: a user who reopens
 * the form is starting over, and the abandoned first attempt should not be
 * charged to the second.
 *
 * @param name - stable flow identifier, e.g. "task.create"
 * @param props - context recorded now and merged into the completion event
 */
export function startFlow(name: string, props?: Record<string, unknown>): void {
  if (!name) return;
  const flows = read();
  flows[name] = { startedAt: Date.now(), props };
  write(flows);
}

/** Whether a flow is currently open (and not yet timed out). */
export function isFlowActive(name: string, now = Date.now()): boolean {
  const open = read()[name];
  return open !== undefined && now - open.startedAt <= timeoutMs();
}

/** Names of every open, un-timed-out flow. */
export function activeFlows(now = Date.now()): string[] {
  const flows = read();
  const limit = timeoutMs();
  return Object.keys(flows).filter((n) => now - flows[n]!.startedAt <= limit);
}

/**
 * Close a flow and emit its duration.
 *
 * @returns the elapsed milliseconds, or null if the flow was never started or
 *   had already timed out (nothing is emitted in that case).
 */
function endWith(
  name: string,
  outcome: FlowOutcome,
  props?: Record<string, unknown>,
): number | null {
  if (!name) return null;
  const flows = read();
  const open = flows[name];
  if (!open) return null;

  delete flows[name];
  write(flows);

  const duration = Date.now() - open.startedAt;
  if (duration > timeoutMs()) return null; // forgotten, not slow — see above
  // A remount, not a decision. See DEFAULT_MIN_ABANDON_MS.
  if (outcome !== "completed" && duration < minAbandonMs()) return null;
  if (!isInitialized()) return null;

  enqueue({
    ...base(),
    type: "flow",
    name,
    props: { ...open.props, ...props, duration_ms: duration, outcome },
  });
  return duration;
}

/** Complete a flow successfully and record how long it took. */
export function endFlow(name: string, props?: Record<string, unknown>): number | null {
  return endWith(name, "completed", props);
}

/**
 * Record that the user gave up — closed the dialog, navigated away mid-form.
 * Abandonments are what turn a duration into a usable metric: a median of 40s
 * means something different when a third of attempts never finish.
 */
export function cancelFlow(
  name: string,
  reason?: string,
  props?: Record<string, unknown>,
): number | null {
  return endWith(name, "abandoned", reason ? { ...props, reason } : props);
}

/**
 * Record that the flow ended in a failure the user did not cause — a failed
 * save, a validation rejection from the server. Kept distinct from abandonment
 * so "slow because it broke" and "slow because it's confusing" stay separable.
 */
export function failFlow(
  name: string,
  reason?: string,
  props?: Record<string, unknown>,
): number | null {
  return endWith(name, "failed", reason ? { ...props, reason } : props);
}

export interface FlowHandle {
  readonly name: string;
  end(props?: Record<string, unknown>): number | null;
  cancel(reason?: string, props?: Record<string, unknown>): number | null;
  fail(reason?: string, props?: Record<string, unknown>): number | null;
}

/**
 * Start a flow and get a handle to close it — the ergonomic form for when start
 * and end sit in the same scope. Use the string-keyed functions when they do
 * not (a dialog that opens in one component and submits in another).
 */
export function flow(name: string, props?: Record<string, unknown>): FlowHandle {
  startFlow(name, props);
  return {
    name,
    end: (p) => endFlow(name, p),
    cancel: (reason, p) => cancelFlow(name, reason, p),
    fail: (reason, p) => failFlow(name, reason, p),
  };
}

/** Drop every open flow without emitting. For testing only. */
export function _resetFlows(): void {
  memory = {};
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // no sessionStorage — the memory reset above is the whole story
  }
}

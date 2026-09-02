import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _reset, init } from "./core.js";
import { _resetQueue, _queueLength, flush } from "./queue.js";
import { _resetSession } from "./session.js";
import {
  _resetFlows,
  activeFlows,
  cancelFlow,
  endFlow,
  failFlow,
  flow,
  isFlowActive,
  startFlow,
} from "./flow.js";

const mockFetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));

/** The single event the queue would have sent. */
function sentEvent() {
  flush();
  const body = JSON.parse(mockFetch.mock.calls[0]![1]!.body as string);
  return body.events[0];
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", mockFetch);
  _reset();
  _resetQueue();
  _resetSession();
  _resetFlows();
  init({ endpoint: "http://localhost:7474", app: "demo", key: "k", user: { id: "u1" } });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  _reset();
  _resetQueue();
  _resetSession();
  _resetFlows();
  mockFetch.mockClear();
});

describe("endFlow()", () => {
  it("emits one flow event carrying the elapsed time", () => {
    startFlow("task.create");
    vi.advanceTimersByTime(12_000);
    expect(endFlow("task.create")).toBe(12_000);

    const e = sentEvent();
    expect(e.type).toBe("flow");
    expect(e.name).toBe("task.create");
    expect(e.props.duration_ms).toBe(12_000);
    expect(e.props.outcome).toBe("completed");
  });

  it("merges start props with end props", () => {
    startFlow("task.create", { entry: "keyboard" });
    vi.advanceTimersByTime(500);
    endFlow("task.create", { clients: 3 });

    const e = sentEvent();
    expect(e.props).toMatchObject({ entry: "keyboard", clients: 3, duration_ms: 500 });
  });

  it("emits nothing for a flow that was never started", () => {
    expect(endFlow("never.started")).toBeNull();
    expect(_queueLength()).toBe(0);
  });

  it("does not emit twice for one start", () => {
    startFlow("task.create");
    vi.advanceTimersByTime(100);
    expect(endFlow("task.create")).toBe(100);
    expect(endFlow("task.create")).toBeNull();
    expect(_queueLength()).toBe(1);
  });

  it("drops a flow left open past the timeout rather than reporting it", () => {
    startFlow("task.create");
    vi.advanceTimersByTime(31 * 60 * 1000);
    expect(endFlow("task.create")).toBeNull();
    expect(_queueLength()).toBe(0);
  });

  it("honours a configured flowTimeoutMs", () => {
    _reset();
    init({
      endpoint: "http://localhost:7474",
      app: "demo",
      key: "k",
      user: { id: "u1" },
      flowTimeoutMs: 1_000,
    });
    startFlow("quick");
    vi.advanceTimersByTime(1_500);
    expect(endFlow("quick")).toBeNull();
  });
});

describe("startFlow()", () => {
  it("restarts the clock when the same flow is started again", () => {
    startFlow("task.create");
    vi.advanceTimersByTime(10_000);
    startFlow("task.create"); // user closed the form and reopened it
    vi.advanceTimersByTime(2_000);

    expect(endFlow("task.create")).toBe(2_000);
  });

  it("tracks several flows independently", () => {
    startFlow("a");
    vi.advanceTimersByTime(1_000);
    startFlow("b");
    vi.advanceTimersByTime(1_000);

    expect(endFlow("a")).toBe(2_000);
    expect(endFlow("b")).toBe(1_000);
  });
});

describe("cancelFlow() / failFlow()", () => {
  it("records an abandonment with its reason", () => {
    startFlow("task.create");
    vi.advanceTimersByTime(4_000);
    expect(cancelFlow("task.create", "dialog_dismissed")).toBe(4_000);

    const e = sentEvent();
    expect(e.props.outcome).toBe("abandoned");
    expect(e.props.reason).toBe("dialog_dismissed");
    expect(e.props.duration_ms).toBe(4_000);
  });

  it("distinguishes a failure from an abandonment", () => {
    startFlow("task.create");
    vi.advanceTimersByTime(1_000);
    failFlow("task.create", "server_error");

    expect(sentEvent().props.outcome).toBe("failed");
  });

  it("is a no-op for a flow that is not open", () => {
    expect(cancelFlow("task.create")).toBeNull();
    expect(_queueLength()).toBe(0);
  });

  // React StrictMode runs effects mount → cleanup → mount in development, so a
  // flow started on mount and cancelled on cleanup would otherwise emit a 0ms
  // abandonment on every page visit and peg the abandon rate at ~50%.
  it("ignores an instant abandonment, which is a remount not a decision", () => {
    startFlow("task.create");
    vi.advanceTimersByTime(2);
    expect(cancelFlow("task.create", "cleanup")).toBeNull();
    expect(_queueLength()).toBe(0);
  });

  it("still records a fast but real abandonment", () => {
    startFlow("task.create");
    vi.advanceTimersByTime(300); // user hit Escape
    expect(cancelFlow("task.create", "escape")).toBe(300);
    expect(_queueLength()).toBe(1);
  });

  it("never filters a fast completion", () => {
    startFlow("task.create");
    vi.advanceTimersByTime(2);
    expect(endFlow("task.create")).toBe(2);
    expect(sentEvent().props.duration_ms).toBe(2);
  });

  it("honours minAbandonMs: 0", () => {
    _reset();
    init({
      endpoint: "http://localhost:7474",
      app: "demo",
      key: "k",
      user: { id: "u1" },
      minAbandonMs: 0,
    });
    startFlow("task.create");
    expect(cancelFlow("task.create")).toBe(0);
  });
});

describe("flow() handle", () => {
  it("ends through the handle", () => {
    const f = flow("invoice.create", { source: "task" });
    vi.advanceTimersByTime(7_000);
    expect(f.end({ amount: 1200 })).toBe(7_000);

    const e = sentEvent();
    expect(e.name).toBe("invoice.create");
    expect(e.props).toMatchObject({ source: "task", amount: 1200, duration_ms: 7_000 });
  });

  it("cancels through the handle", () => {
    const f = flow("invoice.create");
    vi.advanceTimersByTime(200);
    f.cancel("navigated_away");
    expect(sentEvent().props.outcome).toBe("abandoned");
  });
});

describe("introspection", () => {
  it("reports open flows and forgets closed ones", () => {
    startFlow("a");
    startFlow("b");
    expect(activeFlows().sort()).toEqual(["a", "b"]);
    expect(isFlowActive("a")).toBe(true);

    endFlow("a");
    expect(activeFlows()).toEqual(["b"]);
    expect(isFlowActive("a")).toBe(false);
  });

  it("does not report a timed-out flow as active", () => {
    startFlow("a");
    vi.advanceTimersByTime(31 * 60 * 1000);
    expect(isFlowActive("a")).toBe(false);
    expect(activeFlows()).toEqual([]);
  });
});

describe("persistence", () => {
  it("survives a navigation within the tab", () => {
    startFlow("wizard");
    vi.advanceTimersByTime(3_000);

    // A new page in the same tab: fresh module state, same sessionStorage.
    // (Reading it back through the public API is the observable equivalent.)
    expect(sessionStorage.getItem("sg_flows")).toContain("wizard");
    expect(endFlow("wizard")).toBe(3_000);
  });

  it("works when sessionStorage throws", () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error("storage disabled");
    };
    const originalGet = Storage.prototype.getItem;
    Storage.prototype.getItem = () => {
      throw new Error("storage disabled");
    };

    try {
      startFlow("private.mode");
      vi.advanceTimersByTime(900);
      expect(endFlow("private.mode")).toBe(900);
    } finally {
      Storage.prototype.setItem = original;
      Storage.prototype.getItem = originalGet;
    }
  });
});

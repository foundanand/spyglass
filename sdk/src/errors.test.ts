import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _reset, init } from "./core.js";
import { _resetQueue, _queueLength, flush } from "./queue.js";
import { _resetSession } from "./session.js";
import { startErrorTracking, _resetErrors, _dedupSize } from "./errors.js";

// jsdom doesn't ship PromiseRejectionEvent — polyfill it for these tests.
if (typeof PromiseRejectionEvent === "undefined") {
  (globalThis as Record<string, unknown>).PromiseRejectionEvent = class extends Event {
    reason: unknown;
    promise: Promise<unknown>;
    constructor(
      type: string,
      init?: { promise?: Promise<unknown>; reason?: unknown; cancelable?: boolean },
    ) {
      super(type, { cancelable: init?.cancelable });
      this.reason = init?.reason;
      this.promise = init?.promise ?? Promise.resolve();
    }
  };
}

const mockFetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));

function setup() {
  vi.stubGlobal("fetch", mockFetch);
  _reset();
  _resetQueue();
  _resetSession();
  _resetErrors();
  init({ endpoint: "http://localhost:7474", app: "demo", key: "k", user: { id: "u1" } });
  startErrorTracking();
}

function teardown() {
  _resetErrors();
  _reset();
  _resetQueue();
  _resetSession();
  vi.unstubAllGlobals();
  mockFetch.mockClear();
}

beforeEach(() => {
  vi.useFakeTimers();
  setup();
});

afterEach(() => {
  vi.useRealTimers();
  teardown();
});

function lastBatch(): ReturnType<typeof JSON.parse> {
  flush();
  const call = mockFetch.mock.calls.at(-1);
  return JSON.parse((call![1] as RequestInit).body as string);
}

describe("window error event", () => {
  it("emits an error event with message, source, line, col", () => {
    const err = new Error("boom");
    window.dispatchEvent(
      Object.assign(new ErrorEvent("error", { message: "boom", filename: "app.js", lineno: 42, colno: 7, error: err }))
    );
    expect(_queueLength()).toBe(1);
    const e = lastBatch().events[0];
    expect(e.type).toBe("error");
    expect(e.name).toBe("boom");
    expect(e.props.source).toBe("app.js");
    expect(e.props.line).toBe(42);
    expect(e.props.col).toBe(7);
    expect(typeof e.props.stack).toBe("string");
  });
});

describe("unhandledrejection", () => {
  it("captures rejection reason message", () => {
    const reason = new Error("async fail");
    const evt = new PromiseRejectionEvent("unhandledrejection", {
      promise: Promise.resolve(),
      reason,
    });
    window.dispatchEvent(evt);
    expect(_queueLength()).toBe(1);
    const e = lastBatch().events[0];
    expect(e.type).toBe("error");
    expect(e.name).toBe("async fail");
    expect(typeof e.props.stack).toBe("string");
  });

  it("handles non-Error rejection reason", () => {
    const evt = new PromiseRejectionEvent("unhandledrejection", {
      promise: Promise.resolve(),
      reason: "string rejection",
    });
    window.dispatchEvent(evt);
    const e = lastBatch().events[0];
    expect(e.name).toBe("string rejection");
  });
});

describe("console.error patch", () => {
  it("emits an error event", () => {
    console.error("something went wrong");
    expect(_queueLength()).toBe(1);
    const e = lastBatch().events[0];
    expect(e.type).toBe("error");
    expect(e.name).toBe("something went wrong");
    expect(e.props.source).toBe("console.error");
  });

  it("includes stack when called with an Error argument", () => {
    const err = new Error("db failure");
    console.error("db error:", err);
    const e = lastBatch().events[0];
    expect(typeof e.props.stack).toBe("string");
  });
});

describe("dedup within 5s", () => {
  it("suppresses identical error within 5 seconds", () => {
    window.dispatchEvent(new ErrorEvent("error", { message: "flap", filename: "x.js" }));
    window.dispatchEvent(new ErrorEvent("error", { message: "flap", filename: "x.js" }));
    expect(_queueLength()).toBe(1);
  });

  it("allows the same error again after 5 seconds", () => {
    window.dispatchEvent(new ErrorEvent("error", { message: "flap", filename: "x.js" }));
    // advanceTimersByTime(5001) fires the queue's 5s auto-flush timer too,
    // leaving the queue empty. The second error should still be enqueued.
    vi.advanceTimersByTime(5_001);
    window.dispatchEvent(new ErrorEvent("error", { message: "flap", filename: "x.js" }));
    expect(_queueLength()).toBe(1); // second event is queued (first was auto-flushed)
    expect(mockFetch.mock.calls.length).toBe(1); // auto-flush call for first event
  });

  it("allows different errors simultaneously", () => {
    window.dispatchEvent(new ErrorEvent("error", { message: "e1", filename: "a.js" }));
    window.dispatchEvent(new ErrorEvent("error", { message: "e2", filename: "a.js" }));
    expect(_queueLength()).toBe(2);
  });
});

describe("not initialized", () => {
  it("drops errors when SDK is not initialized", () => {
    _resetErrors();
    _reset(); // un-init
    _resetQueue();
    startErrorTracking();
    window.dispatchEvent(new ErrorEvent("error", { message: "ignored" }));
    expect(_queueLength()).toBe(0);
  });
});

describe("idempotent start", () => {
  it("startErrorTracking is idempotent", () => {
    startErrorTracking(); // called again
    console.error("once");
    expect(_queueLength()).toBe(1); // not doubled
  });
});

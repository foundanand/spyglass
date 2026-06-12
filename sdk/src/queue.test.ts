import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _reset, init } from "./core.js";
import { _resetQueue, _queueLength, enqueue, flush } from "./queue.js";
import { _resetSession } from "./session.js";

const mockFetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", mockFetch);
  _reset();
  _resetQueue();
  _resetSession();
  init({ endpoint: "http://localhost:7474", app: "demo", key: "sg_k", user: { id: "u1" } });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  _reset();
  _resetQueue();
  _resetSession();
  mockFetch.mockClear();
});

describe("enqueue()", () => {
  it("flushes immediately at 20 events", () => {
    for (let i = 0; i < 20; i++) {
      enqueue({ ts: i, app: "demo", user_id: "u1", session_id: "s1", type: "event", name: `e${i}` });
    }
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("flushes after 5s timer", async () => {
    enqueue({ ts: 1, app: "demo", user_id: "u1", session_id: "s1", type: "event", name: "click" });
    expect(mockFetch).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("does not double-flush if already at 20", async () => {
    for (let i = 0; i < 20; i++) {
      enqueue({ ts: i, app: "demo", user_id: "u1", session_id: "s1", type: "event", name: `e${i}` });
    }
    await vi.runAllTimersAsync();
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("sends the correct URL and app key", () => {
    for (let i = 0; i < 20; i++) {
      enqueue({ ts: i, app: "demo", user_id: "u1", session_id: "s1", type: "event", name: `e${i}` });
    }
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:7474/v1/events");
    const body = JSON.parse(opts.body as string);
    expect(body.app).toBe("demo");
    expect(body.key).toBe("sg_k");
    expect(body.events).toHaveLength(20);
  });

  it("drops events silently when SDK is not initialised", () => {
    _reset();
    enqueue({ ts: 1, app: "demo", user_id: "u1", session_id: "s1", type: "event", name: "x" });
    expect(_queueLength()).toBe(0);
  });
});

describe("flush() with sendBeacon", () => {
  it("uses sendBeacon when useSendBeacon=true", () => {
    const sendBeacon = vi.fn(() => true);
    vi.stubGlobal("navigator", { sendBeacon });

    enqueue({ ts: 1, app: "demo", user_id: "u1", session_id: "s1", type: "event", name: "click" });
    flush(true);

    expect(sendBeacon).toHaveBeenCalledOnce();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

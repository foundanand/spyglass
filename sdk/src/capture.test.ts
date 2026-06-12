import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _reset, init } from "./core.js";
import { _resetQueue, _queueLength, flush } from "./queue.js";
import { _resetSession } from "./session.js";
import { capture, pageview, setUser } from "./capture.js";

const mockFetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", mockFetch);
  _reset();
  _resetQueue();
  _resetSession();
  init({ endpoint: "http://localhost:7474", app: "demo", key: "k", user: { id: "u1" } });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  _reset();
  _resetQueue();
  _resetSession();
  mockFetch.mockClear();
});

describe("capture()", () => {
  it("enqueues an event with correct shape", () => {
    capture("invoice_created", { amount: 1200 });
    expect(_queueLength()).toBe(1);
    flush();
    const body = JSON.parse(mockFetch.mock.calls[0]![1]!.body as string);
    const e = body.events[0];
    expect(e.type).toBe("event");
    expect(e.name).toBe("invoice_created");
    expect(e.props).toEqual({ amount: 1200 });
    expect(typeof e.ts).toBe("number");
    expect(e.user_id).toBe("u1");
    expect(e.app).toBe("demo");
  });
});

describe("pageview()", () => {
  it("enqueues a pageview event", () => {
    pageview("/dashboard");
    flush();
    const body = JSON.parse(mockFetch.mock.calls[0]![1]!.body as string);
    const e = body.events[0];
    expect(e.type).toBe("pageview");
    expect(e.name).toBe("/dashboard");
  });

  it("uses location.pathname when no url given", () => {
    pageview();
    flush();
    const body = JSON.parse(mockFetch.mock.calls[0]![1]!.body as string);
    expect(body.events[0].type).toBe("pageview");
  });
});

describe("setUser()", () => {
  it("updates user_id on subsequent events", () => {
    setUser({ id: "u2", name: "Alice" });
    capture("after_set_user");
    flush();
    const body = JSON.parse(mockFetch.mock.calls[0]![1]!.body as string);
    expect(body.events[0].user_id).toBe("u2");
  });
});

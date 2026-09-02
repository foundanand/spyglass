import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { collectContext, sanitizeTraits } from "./context.js";
import { _reset, init, updateUser } from "./core.js";
import { _queueLength, _resetQueue, enqueue, flush } from "./queue.js";
import { _resetSession } from "./session.js";

const mockFetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));

function sentBody(call = 0) {
  return JSON.parse(mockFetch.mock.calls[call]![1]!.body as string);
}

function anEvent(sessionId = "s1") {
  return {
    ts: Date.now(),
    app: "demo",
    user_id: "u1",
    session_id: sessionId,
    type: "event" as const,
    name: "thing",
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockClear();
  _reset();
  _resetQueue();
  _resetSession();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  _reset();
  _resetQueue();
});

describe("collectContext()", () => {
  it("collects viewport, screen and locale fields", () => {
    const ctx = collectContext();
    expect(typeof ctx.viewport_w).toBe("number");
    expect(typeof ctx.viewport_h).toBe("number");
    expect(ctx.language).toBeTruthy();
    expect(ctx.tz).toBeTruthy();
    expect(ctx.ua).toBeTruthy();
  });

  it("buckets the viewport at the widths where layouts break", () => {
    const cases: [number, string][] = [
      [375, "mobile"],
      [639, "mobile"],
      [640, "tablet"],
      [1023, "tablet"],
      [1024, "laptop"],
      [1439, "laptop"],
      [1440, "desktop"],
      [2560, "desktop"],
    ];
    for (const [w, want] of cases) {
      vi.stubGlobal("innerWidth", w);
      expect(collectContext().viewport_bucket, `width ${w}`).toBe(want);
    }
  });

  // No canvas, no fonts, no WebGL, no plugin list. If a future change adds a
  // fingerprinting surface, this fails.
  it("exposes no fingerprinting surface", () => {
    const keys = Object.keys(collectContext());
    const allowed = new Set([
      "viewport_w",
      "viewport_h",
      "viewport_bucket",
      "screen_w",
      "screen_h",
      "dpr",
      "ua",
      "language",
      "tz",
      "referrer",
      "connection",
    ]);
    for (const k of keys) {
      expect(allowed.has(k), `unexpected context field: ${k}`).toBe(true);
    }
  });

  it("never throws when the environment is missing pieces", () => {
    vi.stubGlobal("navigator", undefined);
    vi.stubGlobal("screen", undefined);
    expect(() => collectContext()).not.toThrow();
  });
});

describe("context on the wire", () => {
  // flush() defers while a POST is in flight, so let each one settle before
  // triggering the next.
  async function flushAndWait(n: number) {
    flush();
    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(n));
    await vi.advanceTimersByTimeAsync(0); // drain .then/.finally
  }

  it("rides on the first batch of a session, once", async () => {
    init({ endpoint: "http://x", app: "demo", key: "k", user: { id: "u1" } });

    enqueue(anEvent());
    await flushAndWait(1);
    expect(sentBody(0).meta).toBeTruthy();
    expect(sentBody(0).meta.viewport_bucket).toBeTruthy();

    // Second batch, same session: context is not repeated. Sending it on all
    // 254 network events of a session would inflate the store for nothing.
    enqueue(anEvent());
    await flushAndWait(2);
    expect(sentBody(1).meta).toBeUndefined();
  });

  it("sends context again for a new session", async () => {
    init({ endpoint: "http://x", app: "demo", key: "k", user: { id: "u1" } });

    enqueue(anEvent("s1"));
    await flushAndWait(1);
    expect(sentBody(0).meta).toBeTruthy();

    enqueue(anEvent("s2"));
    await flushAndWait(2);
    expect(sentBody(1).meta).toBeTruthy();
  });

  it("records none of it when context is false", async () => {
    init({ endpoint: "http://x", app: "demo", key: "k", user: { id: "u1" }, context: false });

    enqueue(anEvent());
    await flushAndWait(1);
    expect(sentBody(0).meta).toBeUndefined();
  });

  it("lets the context ride again when its batch bounced", async () => {
    init({ endpoint: "http://x", app: "demo", key: "k", user: { id: "u1" } });
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 503 }));

    enqueue(anEvent());
    await flushAndWait(1);
    expect(sentBody(0).meta).toBeTruthy();
    await vi.waitFor(() => expect(_queueLength()).toBe(1));

    await flushAndWait(2);
    expect(sentBody(1).meta).toBeTruthy();
  });
});

describe("sanitizeTraits()", () => {
  it("keeps scalars", () => {
    expect(sanitizeTraits({ role: "Partner", seats: 3, admin: false, team: null })).toEqual({
      role: "Partner",
      seats: 3,
      admin: false,
      team: null,
    });
  });

  // Traits are the easiest place for somebody to park a whole user record.
  it("drops objects, arrays and functions", () => {
    const got = sanitizeTraits({
      role: "Partner",
      profile: { email: "a@b.c", phone: "123" },
      clients: ["acme", "globex"],
      cb: () => {},
      nothing: undefined,
    });
    expect(got).toEqual({ role: "Partner" });
  });

  it("caps count and value length", () => {
    const many: Record<string, unknown> = {};
    for (let i = 0; i < 50; i++) many[`k${i}`] = `v${i}`;
    expect(Object.keys(sanitizeTraits(many)!).length).toBe(24);

    const long = sanitizeTraits({ note: "x".repeat(500) })!;
    expect((long.note as string).length).toBe(120);
  });

  it("returns undefined for nothing usable", () => {
    expect(sanitizeTraits(undefined)).toBeUndefined();
    expect(sanitizeTraits({})).toBeUndefined();
    expect(sanitizeTraits({ bad: { a: 1 } })).toBeUndefined();
    expect(sanitizeTraits({ nan: NaN })).toBeUndefined();
  });
});

describe("traits on the wire", () => {
  async function flushOnce(n: number) {
    flush();
    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(n));
    await vi.advanceTimersByTimeAsync(0);
  }

  it("travels in meta alongside context", async () => {
    init({
      endpoint: "http://x",
      app: "demo",
      key: "k",
      user: { id: "u1", traits: { role: "Partner" } },
    });
    enqueue(anEvent());
    await flushOnce(1);
    expect(sentBody(0).meta.traits).toEqual({ role: "Partner" });
    expect(sentBody(0).meta.viewport_bucket).toBeTruthy();
  });

  // context:false is about what the SDK observes on its own. Traits are
  // declared by the host app, so they still go.
  it("is sent even when context is false", async () => {
    init({
      endpoint: "http://x",
      app: "demo",
      key: "k",
      context: false,
      user: { id: "u1", traits: { role: "Employee" } },
    });
    enqueue(anEvent());
    await flushOnce(1);
    expect(sentBody(0).meta).toEqual({ traits: { role: "Employee" } });
  });

  it("re-sends when setUser changes a trait", async () => {
    init({
      endpoint: "http://x",
      app: "demo",
      key: "k",
      user: { id: "u1", traits: { role: "Employee" } },
    });
    enqueue(anEvent());
    await flushOnce(1);
    expect(sentBody(0).meta.traits).toEqual({ role: "Employee" });

    // Same session, no trait change: not repeated.
    enqueue(anEvent());
    await flushOnce(2);
    expect(sentBody(1).meta).toBeUndefined();

    updateUser({ id: "u1", traits: { role: "Manager" } });
    enqueue(anEvent());
    await flushOnce(3);
    expect(sentBody(2).meta.traits).toEqual({ role: "Manager" });
  });
});

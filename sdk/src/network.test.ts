import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _reset, init } from "./core.js";
import { _resetQueue, _queueLength, flush } from "./queue.js";
import { _resetSession } from "./session.js";
import { startNetworkTracking, stopNetworkTracking, _resetNetwork, _isInstalled, sanitizedHeaders } from "./network.js";

let capturedFetch: typeof globalThis.fetch;

function setup(networkCfg?: boolean | { bodies?: string[] }) {
  _reset();
  _resetQueue();
  _resetSession();
  _resetNetwork();
  init({
    endpoint: "http://localhost:7474",
    app: "demo",
    key: "k",
    user: { id: "u1" },
    network: networkCfg ?? true, // explicit default so spreading undefined doesn't clobber it
  });
  // Install a real fake fetch that records calls BEFORE network patch.
  capturedFetch = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json", "content-length": "12" },
    }),
  );
  vi.stubGlobal("fetch", capturedFetch);
  startNetworkTracking();
}

function teardown() {
  _resetNetwork();
  _reset();
  _resetQueue();
  _resetSession();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  teardown();
});

function lastBatch() {
  // Re-stub fetch before flushing so queue.flush uses a working fetch.
  const plainFetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", plainFetch);
  flush();
  const call = plainFetch.mock.calls[0];
  return call ? JSON.parse((call[1] as RequestInit).body as string) : null;
}

describe("fetch patching", () => {
  it("captures method, url, status, duration_ms, req_size, res_size", async () => {
    setup();
    await window.fetch("https://api.example.com/data", { method: "GET" });
    expect(_queueLength()).toBe(1);
    const b = lastBatch();
    const e = b.events[0];
    expect(e.type).toBe("network");
    expect(e.name).toBe("https://api.example.com/data");
    expect(e.props.method).toBe("GET");
    expect(e.props.status).toBe(200);
    expect(typeof e.props.duration_ms).toBe("number");
    expect(e.props.res_size).toBe(12);
  });

  it("does NOT intercept own collector requests", async () => {
    setup();
    await window.fetch("http://localhost:7474/v1/events", {
      method: "POST",
      body: JSON.stringify({}),
    });
    // The underlying fetch was called but no event enqueued.
    expect(_queueLength()).toBe(0);
  });

  it("records req_size from request body", async () => {
    setup();
    const body = JSON.stringify({ hello: "world" });
    await window.fetch("https://api.example.com/post", { method: "POST", body });
    const b = lastBatch();
    expect(b.events[0].props.req_size).toBeGreaterThan(0);
  });

  it("records status 0 on network error", async () => {
    setup();
    // Make fetch throw a network error.
    (capturedFetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new TypeError("failed to fetch"));
    await expect(
      window.fetch("https://api.example.com/fail")
    ).rejects.toThrow("failed to fetch");
    const b = lastBatch();
    expect(b.events[0].props.status).toBe(0);
  });

  it("does not capture body by default (network: true)", async () => {
    setup(true);
    await window.fetch("https://api.example.com/data");
    const b = lastBatch();
    expect(b.events[0].props.body_excerpt).toBeUndefined();
  });

  it("captures body when URL matches network.bodies allowlist", async () => {
    setup({ bodies: ["/api/"] });
    (capturedFetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response("sensitive response", { status: 200, headers: { "content-type": "text/plain" } }),
    );
    await window.fetch("http://app.internal/api/orders");
    const b = lastBatch();
    expect(b.events[0].props.body_excerpt).toBe("sensitive response");
  });

  it("does NOT capture body for non-matching URL even with network.bodies set", async () => {
    setup({ bodies: ["/api/"] });
    await window.fetch("https://cdn.example.com/image.png");
    const b = lastBatch();
    expect(b.events[0].props.body_excerpt).toBeUndefined();
  });

  it("truncates body excerpt to 2KB", async () => {
    setup({ bodies: ["/api/"] });
    const bigBody = "x".repeat(3000);
    (capturedFetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(bigBody, { status: 200 }),
    );
    await window.fetch("http://app.internal/api/big");
    const b = lastBatch();
    expect(b.events[0].props.body_excerpt.length).toBeLessThanOrEqual(2050); // 2048 + ellipsis
    expect(b.events[0].props.body_excerpt.endsWith("…")).toBe(true);
  });
});

describe("network: false", () => {
  it("does not patch fetch when network:false", async () => {
    setup(false);
    expect(_isInstalled()).toBe(false);
    // Fetch still works normally.
    const res = await window.fetch("https://api.example.com/data");
    expect(res).toBeTruthy();
    expect(_queueLength()).toBe(0);
  });
});

describe("idempotent", () => {
  it("startNetworkTracking is idempotent", async () => {
    setup();
    startNetworkTracking(); // second call
    await window.fetch("https://api.example.com/data");
    // Should only emit one network event, not two.
    expect(_queueLength()).toBe(1);
  });
});

describe("stopNetworkTracking", () => {
  it("restores original fetch", async () => {
    setup();
    expect(_isInstalled()).toBe(true);
    stopNetworkTracking();
    expect(_isInstalled()).toBe(false);
    await window.fetch("https://api.example.com/data");
    expect(_queueLength()).toBe(0);
  });
});

describe("sanitizedHeaders", () => {
  it("removes Authorization header", () => {
    const h = { Authorization: "Bearer token", "Content-Type": "application/json" };
    const out = sanitizedHeaders(h);
    // Headers() normalizes names to lowercase.
    expect(out["authorization"]).toBeUndefined();
    expect(out["content-type"]).toBe("application/json");
  });

  it("removes Cookie header (case-insensitive)", () => {
    const h = new Headers({ cookie: "session=abc", "X-Custom": "value" });
    const out = sanitizedHeaders(h);
    expect(out["cookie"]).toBeUndefined();
    expect(out["x-custom"]).toBe("value");
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { postJSON } from "./transport.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

function respondWith(status: number) {
  const fn = vi.fn().mockResolvedValue(new Response(null, { status }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("postJSON()", () => {
  it("succeeds on 2xx", async () => {
    respondWith(204);
    expect(await postJSON("http://c/v1/events", "{}")).toBe(true);
  });

  it("asks for a retry on a network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await postJSON("http://c/v1/events", "{}")).toBe(false);
  });

  it("asks for a retry when the collector is down or throttling", async () => {
    respondWith(503);
    expect(await postJSON("http://c/v1/events", "{}")).toBe(false);
    respondWith(429);
    expect(await postJSON("http://c/v1/events", "{}")).toBe(false);
  });

  it("drops a batch the collector will never accept", async () => {
    // A bad app key or an oversized body fails identically on every retry;
    // re-queueing it would block every event behind it forever.
    respondWith(401);
    expect(await postJSON("http://c/v1/events", "{}")).toBe(true);
    respondWith(413);
    expect(await postJSON("http://c/v1/events", "{}")).toBe(true);
  });
});

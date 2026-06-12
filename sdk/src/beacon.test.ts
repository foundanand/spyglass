import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _reset, init } from "./core.js";
import { _resetBeacon, registerBeacon } from "./beacon.js";
import { _resetQueue, enqueue } from "./queue.js";
import { _resetSession } from "./session.js";

const mockSendBeacon = vi.fn(() => true);

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
  vi.stubGlobal("navigator", { sendBeacon: mockSendBeacon });
  _reset();
  _resetQueue();
  _resetSession();
  _resetBeacon();
  init({ endpoint: "http://localhost:7474", app: "demo", key: "k", user: { id: "u1" } });
  registerBeacon();
});

afterEach(() => {
  vi.unstubAllGlobals();
  _reset();
  _resetQueue();
  _resetSession();
  _resetBeacon();
  mockSendBeacon.mockClear();
});

describe("registerBeacon()", () => {
  it("flushes via sendBeacon on visibilitychange → hidden", () => {
    enqueue({ ts: 1, app: "demo", user_id: "u1", session_id: "s1", type: "event", name: "x" });
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(mockSendBeacon).toHaveBeenCalledOnce();
  });

  it("flushes via sendBeacon on pagehide", () => {
    enqueue({ ts: 1, app: "demo", user_id: "u1", session_id: "s1", type: "event", name: "x" });
    window.dispatchEvent(new Event("pagehide"));
    expect(mockSendBeacon).toHaveBeenCalledOnce();
  });

  it("is idempotent — registering twice does not double-flush", () => {
    registerBeacon(); // second call
    enqueue({ ts: 1, app: "demo", user_id: "u1", session_id: "s1", type: "event", name: "x" });
    window.dispatchEvent(new Event("pagehide"));
    expect(mockSendBeacon).toHaveBeenCalledOnce();
  });
});

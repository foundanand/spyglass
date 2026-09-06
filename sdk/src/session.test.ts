import { afterEach, describe, expect, it } from "vitest";
import { _resetSession, currentSessionId } from "./session.js";
import { withStorageDisabled } from "./testStorage.js";

afterEach(() => _resetSession());

describe("currentSessionId()", () => {
  it("returns the same id within the idle window", () => {
    const t0 = 1_000_000;
    const id1 = currentSessionId(t0);
    const id2 = currentSessionId(t0 + 1000); // 1 second later
    expect(id1).toBe(id2);
    expect(typeof id1).toBe("string");
    expect(id1.length).toBeGreaterThan(0);
  });

  it("mints a new id after 30 min idle", () => {
    const t0 = 1_000_000;
    const id1 = currentSessionId(t0);
    const idleMs = 30 * 60 * 1000 + 1;
    const id2 = currentSessionId(t0 + idleMs);
    expect(id2).not.toBe(id1);
  });

  it("persists the id in sessionStorage", () => {
    const id = currentSessionId(Date.now());
    expect(sessionStorage.getItem("sg_session_id")).toBe(id);
  });
});

// Every event goes through currentSessionId() — capture, pageview, error,
// network, flow — so an unguarded storage read here does not degrade one
// feature, it throws on the whole SDK. CI caught this; the local test that was
// supposed to cover it patched Storage.prototype, which this jsdom does not
// route through, so it had been passing without exercising anything.
describe("when storage is unavailable", () => {
  it("still returns a stable session id", () => {
    withStorageDisabled(() => {
      const first = currentSessionId();
      expect(first).toBeTruthy();
      // Stable within the page: a new id per event would fragment every session.
      expect(currentSessionId()).toBe(first);
    });
  });

  it("does not throw for any caller", () => {
    withStorageDisabled(() => {
      expect(() => currentSessionId()).not.toThrow();
      expect(() => _resetSession()).not.toThrow();
    });
  });

  it("still expires after the idle window", () => {
    withStorageDisabled(() => {
      const t0 = 1_000_000;
      const first = currentSessionId(t0);
      expect(currentSessionId(t0 + 60_000)).toBe(first);
      expect(currentSessionId(t0 + 31 * 60 * 1000)).not.toBe(first);
    });
  });
});

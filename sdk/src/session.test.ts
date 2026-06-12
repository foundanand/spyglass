import { afterEach, describe, expect, it } from "vitest";
import { _resetSession, currentSessionId } from "./session.js";

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

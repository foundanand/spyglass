import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetSeq, nextSeq } from "./replay.js";

const SID = "sess-abc";

beforeEach(() => {
  sessionStorage.clear();
  _resetSeq(SID);
});

afterEach(() => {
  vi.resetModules();
  sessionStorage.clear();
});

describe("chunk sequence counter", () => {
  it("starts at 1 and increments", () => {
    expect(nextSeq(SID)).toBe(1);
    expect(nextSeq(SID)).toBe(2);
    expect(nextSeq(SID)).toBe(3);
  });

  it("namespaces by session, so a new session starts clean", () => {
    expect(nextSeq(SID)).toBe(1);
    expect(nextSeq(SID)).toBe(2);
    expect(nextSeq("sess-other")).toBe(1);
    expect(nextSeq(SID)).toBe(3);
  });

  // The bug this file exists for: a module-level counter reset on every full
  // page load while the session id (sessionStorage) survived, so the collector
  // was handed seq=1 twice and overwrote the earlier chunk.
  it("survives a page load: fresh module state, same sessionStorage", async () => {
    expect(nextSeq(SID)).toBe(1);
    expect(nextSeq(SID)).toBe(2);

    // A full page load: the module is evaluated again from scratch.
    vi.resetModules();
    const reloaded = await import("./replay.js");

    expect(reloaded.nextSeq(SID)).toBe(3);
    expect(reloaded.nextSeq(SID)).toBe(4);
  });

  it("does not reuse a seq across a reload even after many chunks", async () => {
    const before: number[] = [];
    for (let i = 0; i < 18; i++) before.push(nextSeq(SID));

    vi.resetModules();
    const reloaded = await import("./replay.js");

    const after: number[] = [];
    for (let i = 0; i < 32; i++) after.push(reloaded.nextSeq(SID));

    const all = [...before, ...after];
    expect(new Set(all).size).toBe(50); // 50 uploads, 50 distinct seqs
    expect(all[all.length - 1]).toBe(50);
  });

  it("falls back to module state when sessionStorage throws", () => {
    const setItem = Storage.prototype.setItem;
    const getItem = Storage.prototype.getItem;
    Storage.prototype.setItem = () => {
      throw new Error("storage disabled");
    };
    Storage.prototype.getItem = () => {
      throw new Error("storage disabled");
    };

    try {
      expect(nextSeq("private-mode")).toBe(1);
      expect(nextSeq("private-mode")).toBe(2);
      expect(nextSeq("private-mode")).toBe(3);
    } finally {
      Storage.prototype.setItem = setItem;
      Storage.prototype.getItem = getItem;
    }
  });
});

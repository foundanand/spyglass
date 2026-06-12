import { afterEach, describe, expect, it } from "vitest";
import { _reset, getConfig, init, isInitialized } from "./core.js";

afterEach(() => _reset());

describe("init()", () => {
  it("stores resolved config with defaults", () => {
    init({ endpoint: "http://localhost:7474", app: "demo", key: "k", user: { id: "u1" } });
    const cfg = getConfig();
    expect(cfg.replay).toBe(true);
    expect(cfg.autocapture).toBe(false);
    expect(cfg.network).toBe(true);
    expect(cfg.maskInputs).toBe("password");
    expect(cfg.reportWidget).toBe(true);
  });

  it("applies explicit config overrides", () => {
    init({ endpoint: "http://x", app: "a", key: "k", user: { id: "u" }, replay: false, autocapture: true });
    expect(getConfig().replay).toBe(false);
    expect(getConfig().autocapture).toBe(true);
  });

  it("throws when endpoint is missing", () => {
    // @ts-expect-error intentional
    expect(() => init({ app: "a", key: "k", user: { id: "u" } })).toThrow("endpoint");
  });

  it("throws when app is missing", () => {
    // @ts-expect-error intentional
    expect(() => init({ endpoint: "http://x", key: "k", user: { id: "u" } })).toThrow("app");
  });

  it("throws when key is missing", () => {
    // @ts-expect-error intentional
    expect(() => init({ endpoint: "http://x", app: "a", user: { id: "u" } })).toThrow("key");
  });

  it("throws when user.id is missing", () => {
    // @ts-expect-error intentional
    expect(() => init({ endpoint: "http://x", app: "a", key: "k", user: {} })).toThrow("user.id");
  });

  it("isInitialized() returns false before init, true after", () => {
    expect(isInitialized()).toBe(false);
    init({ endpoint: "http://x", app: "a", key: "k", user: { id: "u" } });
    expect(isInitialized()).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { spyglass, VERSION } from "./index.js";

describe("@spyglass/sdk exports", () => {
  it("exposes a version", () => {
    expect(VERSION).toBe("0.0.0");
    expect(spyglass.version).toBe(VERSION);
  });

  it("exposes init, capture, pageview, setUser, flush", () => {
    expect(typeof spyglass.init).toBe("function");
    expect(typeof spyglass.capture).toBe("function");
    expect(typeof spyglass.pageview).toBe("function");
    expect(typeof spyglass.setUser).toBe("function");
    expect(typeof spyglass.flush).toBe("function");
  });
});

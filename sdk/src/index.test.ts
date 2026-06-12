import { describe, expect, it } from "vitest";
import { spyglass, VERSION } from "./index.js";

describe("@spyglass/sdk skeleton", () => {
  it("exposes a version", () => {
    expect(VERSION).toBe("0.0.0");
    expect(spyglass.version).toBe(VERSION);
  });
});

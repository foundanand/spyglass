import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { spyglass, VERSION } from "./index.js";

// Relative to cwd, which vitest sets to the package root. `import.meta.url` is
// not a file: URL under the jsdom environment, so new URL(...) throws there.
const pkg = JSON.parse(readFileSync("package.json", "utf8"));

describe("@foundanand/spyglass-sdk exports", () => {
  // Asserting a literal is what let this drift: the package published as 0.0.1
  // while the SDK still reported 0.0.0 to the collector. The invariant worth
  // pinning is that they agree, not what the number happens to be today.
  it("reports the package version", () => {
    expect(VERSION).toBe(pkg.version);
    expect(spyglass.version).toBe(VERSION);
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("exposes init, capture, pageview, setUser, flush", () => {
    expect(typeof spyglass.init).toBe("function");
    expect(typeof spyglass.capture).toBe("function");
    expect(typeof spyglass.pageview).toBe("function");
    expect(typeof spyglass.setUser).toBe("function");
    expect(typeof spyglass.flush).toBe("function");
  });
});

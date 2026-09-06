import { defineConfig } from "vitest/config";

import { readFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync(new URL("package.json", import.meta.url), "utf8"));

export default defineConfig({
  // Mirrors the esbuild `define` in build.ts, so VERSION is a real value under
  // test rather than an undefined global.
  define: { __SPYGLASS_VERSION__: JSON.stringify(version) },
  test: {
    globals: true,
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});

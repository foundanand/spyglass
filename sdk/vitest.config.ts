import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    // jsdom gives later SDK tests access to sessionStorage, navigator,
    // window events, CompressionStream shims, etc.
    environment: "jsdom",
    include: ["src/**/*.test.ts"],
  },
});

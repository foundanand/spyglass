// Bundles @foundanand/spyglass-sdk with esbuild (ESM, code-split so rrweb can be a lazy
// chunk loaded only when replay is enabled) and emits type declarations via tsc.
// Run with `node build.ts` (Node strips the types).
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";

rmSync("dist", { recursive: true, force: true });

// Single source of truth for the version. It used to be typed into index.ts by
// hand and had already drifted: the package published as 0.0.1 while the SDK
// reported 0.0.0 to the collector.
const { version } = JSON.parse(readFileSync("package.json", "utf8"));

await build({
  entryPoints: ["src/index.ts", "src/next.tsx"],
  outdir: "dist",
  bundle: true,
  format: "esm",
  splitting: true, // shared/lazy chunks: keeps the core small (§5 budget)
  minify: true,
  sourcemap: true,
  target: "es2022",
  jsx: "automatic",
  jsxImportSource: "react",
  // rrweb and its plugins are bundled into the lazy replay chunk (only loaded
  // when replay:true). React/Next stay external — they live in the consumer app.
  external: ["react", "react-dom", "next"],
  define: { __SPYGLASS_VERSION__: JSON.stringify(version) },
});

// Type declarations.
execFileSync("npx", ["tsc", "--emitDeclarationOnly", "--outDir", "dist"], {
  stdio: "inherit",
});

console.log("sdk: build ok");

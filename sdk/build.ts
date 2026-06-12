// Bundles @spyglass/sdk with esbuild (ESM, code-split so rrweb/autocapture can
// be lazy chunks loaded only when enabled) and emits type declarations via tsc.
// Run with `node build.ts` (Node strips the types).
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";

rmSync("dist", { recursive: true, force: true });

await build({
  entryPoints: ["src/index.ts", "src/next.ts"],
  outdir: "dist",
  bundle: true,
  format: "esm",
  splitting: true, // shared/lazy chunks: keeps the core small (§5 budget)
  minify: true,
  sourcemap: true,
  target: "es2022",
  // rrweb is the only runtime dep and is lazy-imported; never eager-bundle it,
  // and keep React out of the core bundle (only the /next entry touches it).
  external: ["rrweb", "rrweb-player", "react", "react-dom"],
});

// Type declarations.
execFileSync("npx", ["tsc", "--emitDeclarationOnly", "--outDir", "dist"], {
  stdio: "inherit",
});

console.log("sdk: build ok");

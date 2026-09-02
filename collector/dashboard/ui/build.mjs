import { build, context } from "esbuild";
import { copyFileSync, mkdirSync, rmSync } from "node:fs";

const watch = process.argv.includes("--watch");

const opts = {
  entryPoints: [{ in: "src/main.tsx", out: "app" }],
  outdir: "dist", // outdir so esbuild emits app.css alongside app.js
  bundle: true,
  format: "esm",
  // Code splitting so rrweb (the replay engine, ~253KB raw) becomes its own
  // chunk fetched only when a replay is actually opened, rather than riding in
  // the entry bundle on every page load. Requires format:"esm" + outdir, both
  // already set, and index.html already loads the entry as type="module".
  splitting: true,
  minify: !watch,
  sourcemap: watch,
  target: "es2022",
  jsx: "automatic",
  jsxImportSource: "preact",
  // Preact compat shim so JSX maps to preact/compat, not react.
  alias: {
    react: "preact/compat",
    "react-dom": "preact/compat",
  },
};

// Clear dist first. With splitting:true esbuild emits content-hashed chunk
// names, so a stale chunk from a previous build would otherwise linger — and
// `//go:embed all:ui/dist` would bake it into the binary forever.
rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });
copyFileSync("src/index.html", "dist/index.html");

if (watch) {
  const ctx = await context(opts);
  await ctx.watch();
  console.log("dashboard: watching…");
} else {
  await build(opts);
  console.log("dashboard: build ok");
}

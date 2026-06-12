import { build, context } from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";

const watch = process.argv.includes("--watch");

const opts = {
  entryPoints: ["src/main.tsx"],
  outfile: "dist/app.js",
  bundle: true,
  format: "esm",
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

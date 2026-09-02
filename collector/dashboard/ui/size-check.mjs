// Fails the build if the dashboard's *initial* payload grows past its budget.
//
// The point of the budget is that opening a table must not cost the replay
// engine. rrweb is ~253KB raw and belongs in a lazily-imported chunk (todo-013);
// if a stray static import pulls it back into the load path, this is what
// catches it.
//
// Crucially this measures the entry chunk plus everything it imports
// STATICALLY, transitively — not just app.js's own bytes. With splitting:true
// esbuild hoists shared code into separate chunk files that the entry then
// imports at the top; those are fetched on page load just as surely as if the
// code were inlined, so a budget that ignored them would pass while the browser
// still downloaded the whole replay engine. Dynamic `import()` edges are the
// ones that make a chunk lazy, and only those are excluded here.

import { gzipSync } from "node:zlib";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIST = "dist";
const ENTRY = "app.js";
const JS_BUDGET = 25 * 1024; // entry + static graph: app code + Preact, no replay engine
const CSS_BUDGET = 8 * 1024;

const read = (f) => readFileSync(join(DIST, f), "utf8");
const gz = (f) => gzipSync(readFileSync(join(DIST, f)), { level: 9 }).length;

// Static import specifiers only. A dynamic `import("./x.js")` is a call
// expression and must NOT count — that edge is what makes a chunk lazy.
//
// This runs over minified output, where esbuild emits `import{a as Fe}from"./x.js"`
// with no whitespace anywhere. Any pattern that assumes a space before `from`
// silently matches nothing and reports a 16KB payload while the browser loads
// 98KB, so dynamic calls are neutralised first and the rest matched loosely.
function staticImports(src) {
  const out = new Set();
  const s = src.replace(/\bimport\s*\(/g, "\u0000(");
  for (const m of s.matchAll(/\bfrom\s*["']\.\/([^"']+)["']/g)) out.add(m[1]);
  for (const m of s.matchAll(/\bimport\s*["']\.\/([^"']+)["']/g)) out.add(m[1]);
  return out;
}

function staticGraph(entry) {
  const seen = new Set();
  const queue = [entry];
  while (queue.length) {
    const f = queue.shift();
    if (seen.has(f)) continue;
    seen.add(f);
    let src;
    try {
      src = read(f);
    } catch {
      continue;
    }
    for (const dep of staticImports(src)) if (!seen.has(dep)) queue.push(dep);
  }
  return seen;
}

const eager = staticGraph(ENTRY);
const eagerBytes = [...eager].reduce((n, f) => n + gz(f), 0);
const cssBytes = gz("app.css");

const rows = [...eager].map((f) => ({
  file: f,
  gzipped: `${(gz(f) / 1024).toFixed(1)}KB`,
  load: f === ENTRY ? "entry" : "static import",
}));
for (const f of readdirSync(DIST)) {
  if (f.endsWith(".js") && !eager.has(f)) {
    rows.push({ file: f, gzipped: `${(gz(f) / 1024).toFixed(1)}KB`, load: "lazy" });
  }
}
rows.push({ file: "app.css", gzipped: `${(cssBytes / 1024).toFixed(1)}KB`, load: "entry" });

console.table(rows);
console.log(
  `initial JS payload: ${(eagerBytes / 1024).toFixed(1)}KB gz ` +
    `(budget ${(JS_BUDGET / 1024).toFixed(0)}KB) across ${eager.size} file(s)`,
);

let failed = false;
if (eagerBytes > JS_BUDGET) {
  failed = true;
  console.error(
    `\nsize-check: initial JS payload is ${(eagerBytes / 1024).toFixed(1)}KB gz, over the ` +
      `${(JS_BUDGET / 1024).toFixed(0)}KB budget.\n` +
      "Most likely a module that pulls in rrweb became statically reachable from\n" +
      "the entry. Check that ReplayPlayer.tsx and Incident.tsx still reach the\n" +
      'replay surface via `await import("./replaySurface")` plus a type-only import.',
  );
}
if (cssBytes > CSS_BUDGET) {
  failed = true;
  console.error(`\nsize-check: app.css is ${(cssBytes / 1024).toFixed(1)}KB gz, over budget.`);
}
if (failed) process.exit(1);

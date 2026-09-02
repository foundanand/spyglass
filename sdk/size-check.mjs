// The SDK core has a 5KB gzipped budget (CLAUDE.md section 5). rrweb is a lazy
// chunk and is not counted -- loading it is a choice the consumer makes with
// `replay: true`, and it dwarfs everything else if it is ever pulled eagerly.
//
// Measures the entry plus everything it imports STATICALLY, transitively, for
// the same reason the dashboard's check does: esbuild's code splitting hoists
// shared code into chunks the entry then imports at the top, and those are
// fetched exactly as eagerly as inlined code.

import { gzipSync } from "node:zlib";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIST = "dist";
const ENTRY = "index.js";
const BUDGET = 5 * 1024;

const gz = (f) => gzipSync(readFileSync(join(DIST, f)), { level: 9 }).length;

function staticImports(src) {
  const out = new Set();
  // Neutralise dynamic import() so a lazy chunk is not counted as eager.
  const s = src.replace(/\bimport\s*\(/g, " (");
  for (const m of s.matchAll(/\bfrom\s*["'](\.\/[^"']+)["']/g)) out.add(m[1].slice(2));
  for (const m of s.matchAll(/\bimport\s*["'](\.\/[^"']+)["']/g)) out.add(m[1].slice(2));
  return out;
}

const seen = new Set();
const queue = [ENTRY];
while (queue.length) {
  const f = queue.shift();
  if (seen.has(f)) continue;
  seen.add(f);
  let src;
  try {
    src = readFileSync(join(DIST, f), "utf8");
  } catch {
    continue;
  }
  for (const dep of staticImports(src)) if (!seen.has(dep)) queue.push(dep);
}

const total = [...seen].reduce((n, f) => n + gz(f), 0);

const rows = [...seen].map((f) => ({
  file: f,
  gzipped: `${(gz(f) / 1024).toFixed(2)}KB`,
  load: f === ENTRY ? "entry" : "static import",
}));
for (const f of readdirSync(DIST)) {
  if (f.endsWith(".js") && !seen.has(f)) {
    rows.push({ file: f, gzipped: `${(gz(f) / 1024).toFixed(2)}KB`, load: "lazy" });
  }
}
console.table(rows);
console.log(`core: ${(total / 1024).toFixed(2)}KB gz (budget ${BUDGET / 1024}KB)`);

// The core entry must import nothing external. A linked package whose entry
// pulls in react would load a *second* copy of it through the symlink, and the
// resulting hook errors point nowhere near the cause.
const entrySrc = readFileSync(join(DIST, ENTRY), "utf8");
const external = [...entrySrc.matchAll(/\bfrom\s*["']([^"']+)["']/g)]
  .map((m) => m[1])
  .filter((sp) => !sp.startsWith("./") && !sp.startsWith("../"));
if (external.length > 0) {
  console.error(`\nsize-check: the core entry imports external packages: ${external.join(", ")}`);
  console.error("A linked SDK whose entry imports react loads a second copy of it.");
  process.exit(1);
}
console.log("core entry has no external imports -- safe to link");

if (total > BUDGET) {
  console.error(`\nsize-check: core is ${(total / 1024).toFixed(2)}KB gz, over the 5KB budget.`);
  process.exit(1);
}

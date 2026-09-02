// A static guard against the accessibility defects this UI actually had.
//
// What it is: a source lint for four specific, mechanical regressions —
// icon-only buttons with no accessible name, table headers with no `scope`,
// tables with no caption, unlabelled selects, and a slider role without its
// value attributes.
// Those were the real findings (an audit reported 21 across two views), and
// they are all re-introducible by a copy-paste.
//
// What it is NOT: a substitute for a real audit. It cannot see computed colour
// contrast, focus order, or anything that only exists at runtime. Those were
// verified against the running binary with a browser audit, and should be again
// whenever the palette or the player changes. Wiring a headless browser and axe
// into CI would catch more, at the cost of a ~170MB download on every run and a
// flake surface — not a trade this project should make for a dashboard this
// small. The cheap check that catches the likely regressions runs every time;
// the expensive one runs when a human changes something visual.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "src";
const problems = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(tsx|ts|html)$/.test(p)) check(p, readFileSync(p, "utf8"));
  }
}

function lineOf(src, index) {
  return src.slice(0, index).split("\n").length;
}

function check(file, src) {
  const add = (index, msg) => problems.push(`${file}:${lineOf(src, index)}  ${msg}`);

  // 1. <th> without scope. Without it a screen reader reads a cell with no idea
  //    which column it belongs to — worst on tables of near-identical numbers.
  for (const m of src.matchAll(/<th(?![^>]*\bscope=)[\s>]/g)) {
    add(m.index, '<th> without scope — add scope="col"');
  }

  // 2. <table> with no <caption>. Checked per-table by looking ahead a little.
  for (const m of src.matchAll(/<table[\s>][^]{0,400}/g)) {
    if (!/<caption/.test(m[0])) {
      add(m.index, "<table> without a <caption> naming what it lists");
    }
  }

  // 3. Icon-only buttons: a <button …> whose content is only an <Icon …/> or an
  //    svg, with no aria-label. Announced as "button" and nothing else.
  for (const m of src.matchAll(/<button\b([^>]*)>([^]{0,200}?)<\/button>/g)) {
    const [, attrs, body] = m;
    if (/aria-label|aria-labelledby/.test(attrs)) continue;
    const text = body
      .replace(/<Icon\b[^>]*\/?>/g, "")
      .replace(/<svg\b[^]*?<\/svg>/g, "")
      .replace(/<[^>]+>/g, "")
      .replace(/\{["'`\s]*\}/g, "")
      .trim();
    if (text === "") add(m.index, "icon-only <button> with no aria-label");
  }

  // 4. <select> with no label. The dashboard has no visible <label> elements —
  //    the pickers sit in dense toolbars — so each needs an aria-label or it is
  //    announced as an unnamed combobox.
  for (const m of src.matchAll(/<select\b([^>]*)>/g)) {
    if (!/aria-label|aria-labelledby|\bid=/.test(m[1])) {
      add(m.index, "<select> with no aria-label");
    }
  }

  // 5. The player builds its transport imperatively, so JSX rules miss it.
  if (/setAttribute\(\s*["']role["']\s*,\s*["']slider["']\s*\)/.test(src)) {
    for (const attr of ["aria-valuemin", "aria-valuemax", "aria-valuenow", "aria-valuetext"]) {
      if (!src.includes(attr)) {
        problems.push(`${file}  role="slider" without ${attr}`);
      }
    }
    if (!/setAttribute\(\s*["']tabindex["']/.test(src)) {
      problems.push(`${file}  role="slider" that cannot be focused (no tabindex)`);
    }
  }
}

walk(ROOT);

if (problems.length > 0) {
  console.error(`a11y-check: ${problems.length} issue(s)\n`);
  for (const p of problems) console.error("  " + p);
  console.error(
    "\nThese are the defect classes an audit found in this UI before they were\n" +
      "fixed. See collector/dashboard/ui/a11y-check.mjs for what this does and\n" +
      "does not cover.",
  );
  process.exit(1);
}
console.log("a11y-check: ok");

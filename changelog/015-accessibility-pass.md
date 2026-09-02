# Accessibility Pass

The whole UI contained **one** `:focus-visible` rule, six `aria-*` attributes and
four `role=`s, with no `.sr-only` utility at all — for a product that is mostly
data tables plus a hand-built media player.

A browser audit of two views reported **21 findings**. Every view now reports
zero.

### Fixed

- **The replay transport is operable from the keyboard.** The scrub track was a
  `div` with pointer handlers: no role, no value, no focus, no keys. It is now a
  real `role="slider"` — focusable, with `aria-valuemin/max/now` and an
  `aria-valuetext` carrying a human timestamp ("00:05 of 00:26") rather than a
  millisecond count.

  Arrow keys step ±5s, PageUp/PageDown ±30s, Home/End jump to the ends, and
  Space toggles playback. Verified by dispatching real key events against the
  running player: `0 → 5s → 10s → 5s → clamped at 26s → 0 → 26s`.

  This matters beyond assistive tech — scrubbing a replay to a timestamp is a
  natural keyboard interaction and it was mouse-only for everyone. The player is
  hand-built because `rrweb-player`'s Svelte component does not mount inside
  this bundle, which means every affordance a native media element provides for
  free had to be provided here, and had not been.

- **A paused player reported a position that kept advancing.** `currentOffset()`
  derived the position from wall-clock elapsed time regardless of playback
  state, so seeking relative to "now" while paused jumped to the end of the
  recording. Latent before this change (the existing ±5s hover shortcuts hit it
  too); exposed immediately by keyboard scrubbing.

- **Contrast, measured rather than guessed.** `--muted` carries most secondary
  text and measured **3.48:1** on `--surface`, under the 4.5:1 needed. White on
  `--accent` measured **4.47:1** — just under — so filled controls now use a new
  `--accent-strong`.

  Event badge backgrounds were alpha tints; they are now the same colours
  pre-composited over the surface. Solid means the contrast is the same wherever
  a badge lands, and an audit can actually read it — an alpha fill over an
  unknown parent cannot be measured, and was being reported at 1.36:1.

- **Icon-only controls had no accessible name.** Play/pause was announced as
  "button" and nothing else; the speed and skip-idle toggles likewise. Five
  `<select>` pickers were unnamed comboboxes. Sparklines were announced as
  unlabelled images — they restate numbers in the table beside them, so they are
  now `aria-hidden`.

- **61 table headers gained `scope="col"`, and every table a `<caption>`.**
  Without them a screen reader reads a cell with no idea which column it belongs
  to — worst on the flow tables, which are eight columns of near-identical
  numbers.

- **The replay iframe is out of the tab order** (`tabindex="-1"`,
  `aria-hidden`, and a real `title`). It holds a _recording_, not live UI;
  tabbing into a reconstructed DOM strands the user in a page that no longer
  exists. Its controls are reachable; its contents are not.

### Added

- **`.sr-only`**, and a focus system rather than a single rule — every anchor,
  button, input, select, `[tabindex]` and slider gets a ring that survives on
  the dark surfaces.

- **A polite live region on the live feed.** It polls every three seconds and
  rows appeared silently; it now announces how many arrived, and says when it is
  paused for history browsing.

- **`npm run a11y-check`, wired into CI.** A static guard for exactly the defect
  classes found here: icon-only buttons with no name, headers without `scope`,
  uncaptioned tables, unlabelled selects, and a slider role missing its value
  attributes.

  It is honest about its limits — it cannot see computed contrast or focus
  order, and its header says so. Wiring headless Chromium and axe into CI would
  catch more at the cost of a ~170MB download per run and a flake surface, which
  is not a trade this project should make for a dashboard this small. The cheap
  check runs every time; the browser audit is for when someone changes something
  visual.

  It earned itself immediately: on first run it found four tables and headers I
  had missed, and then five unlabelled selects after being extended.

---

## Summary of Changes

This is an internal tool for small teams, which is exactly the setting where one
person may depend on a keyboard or a screen reader and where there is no
alternative product to switch to. A small audience is an argument for getting it
right, not for skipping it.

The intent was already there — `prefers-reduced-motion` was handled — but the
coverage was not.

Audited across Home, Behaviour, Sessions, Issues, Explore, the flow page, the
incident view and the mounted replay player: **21 findings → 0**.

**Files Modified:**

- `collector/dashboard/ui/src/views/replaySurface.ts` - slider role, keyboard transport, names, live status, iframe isolation, paused-position fix
- `collector/dashboard/ui/src/index.html` - `.sr-only`, focus system, contrast palette, solid badge backgrounds
- `collector/dashboard/ui/src/views/*.tsx` - `scope`, captions, select labels, live region
- `collector/dashboard/ui/src/components/Sparkline.tsx` - decorative, hidden from the tree
- `collector/dashboard/ui/a11y-check.mjs` - new; static regression guard
- `collector/dashboard/ui/package.json`, `.github/workflows/ci.yml` - the check

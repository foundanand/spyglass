# The dashboard is thinly accessible, and the replay player barely at all

> **P2** · dashboard · `todo-015`

## Problem

Counted across every `.tsx` file and `index.html`:

```
:focus-visible   1     rule, in the whole UI
:focus           1
aria-*           6     attributes, total
role=            4
sr-only          0     — the utility does not exist
```

For a UI that is mostly data tables plus a hand-built media player, that is thin.

The replay player is the sharpest edge. `replaySurface.ts` deliberately does not
use `rrweb-player` and implements its own transport — play/pause, a scrub track,
speed, skip-idle. That was the right call technically (the Svelte component's
`onMount` does not fire inside this Preact bundle) but it means every affordance
a native media element provides for free had to be re-provided, and was not:

- The play/pause button has no accessible name — it renders an icon and nothing
  else. Confirmed live: Charlotte reported it as `button ""`.
- The scrub track is a `div`, not a `slider` role, with no keyboard handling and
  no `aria-valuenow`. It cannot be operated without a mouse.
- Nothing announces playback state changes.

The data tables use bare `<table>` with no `scope` on headers and no caption, so
a screen reader reads cells without knowing which column they belong to. On the
flows table — seven numeric columns of near-identical values — that is the
difference between usable and not.

## Why it matters

This is an internal ops tool for small teams, which is precisely the context
where one person on the team may rely on a keyboard or a screen reader, and
where there is no alternative product they can switch to. "Small audience" is an
argument for getting it right, not for skipping it.

The keyboard case is broader than assistive tech: scrubbing a replay to a
timestamp is a natural keyboard interaction (arrow keys, space to pause) and
today it is mouse-only for everyone.

There is already precedent for caring — `@media (prefers-reduced-motion: reduce)`
is handled at `index.html:66`. The intent is there; the coverage is not.

## Approach

Not a rewrite. A pass over four specific things:

**1. The replay transport.** Accessible names on every control. Make the scrub
track a real `role="slider"` with `aria-valuemin/max/now`, `aria-valuetext`
carrying a human timestamp, and arrow-key / Home / End handling. Space to
play-pause when the player has focus. This is the bulk of the work and the bulk
of the value.

**2. Tables.** `scope="col"` on headers, a visually-hidden `<caption>` naming
what the table lists. Numeric columns already use `tabular-nums`; add
`aria-sort` wherever a column is sortable.

**3. Focus.** One `:focus-visible` rule is not a focus system. Every interactive
element — nav links, chips, table rows that act as buttons, the player controls —
needs a visible ring that survives on the dark surface. Check tab order through
each view actually follows reading order.

**4. Live regions.** The feed auto-refreshes; new rows appear silently. An
`aria-live="polite"` announcement of new-row counts, and a visually-hidden status
for loading and error states, which are currently colour-and-text only.

Add an `.sr-only` utility to `index.html` first — several of the above need it
and it does not exist.

Then verify rather than assume: `charlotte_dev_audit({ checks: ["a11y",
"contrast"] })` against the running dashboard gives a baseline and a regression
check, and the tooling is already set up in this workspace.

## Acceptance

- Every interactive element has an accessible name and a visible focus style.
- The replay can be played, paused and scrubbed entirely from the keyboard.
- The scrub track exposes position as a slider with a human-readable value.
- Tables announce their column headers.
- An automated a11y audit passes on every view, and the check runs in CI.

## Files

- `collector/dashboard/ui/src/views/replaySurface.ts` — the transport controls
- `collector/dashboard/ui/src/views/ReplayPlayer.tsx`, `Incident.tsx`
- `collector/dashboard/ui/src/views/LiveFeed.tsx`, `Errors.tsx`, `Flows.tsx`,
  `UserTimeline.tsx` — table semantics
- `collector/dashboard/ui/src/index.html` — `.sr-only`, focus rules
- `.github/workflows/ci.yml` — the audit step

## Open questions

- Is contrast currently passing? The palette is dark with several muted greys
  (`--muted-foreground` on `--surface`), and nothing has measured it. The audit
  answers this before any redesign work is considered.
- Does the replay iframe need `title` and inert handling? Content inside a replay
  is a _recording_, not live UI, and probably should not be reachable by tab at
  all — its controls should be.

## Effort

**M.** The player is most of it. Tables and focus styles are mechanical.

# Replay Fullscreen, Event Filtering, and a Dashboard Robustness Pass

### Added

- **Fullscreen replay** — a button at the end of the transport bar (and the `f`
  key) fullscreens the whole player, controls included. The recording scales to
  fit both axes and may enlarge, centred. A caption shows the event currently
  playing, because the inspector is out of sight in fullscreen.
- **Event filtering in the replay inspector.** The Events tab has a text search
  (name, URL, type and prop values) and multi-select type chips with counts. The
  Network tab has its own search (URL, method, status). The type filter also
  narrows the timeline markers, so "only errors" means the scrub bar too.
  Filters live in the player, so they survive switching tabs.
- **Light theme.** `prefers-color-scheme: light` re-skins the dashboard through
  the existing colour tokens; there is no second stylesheet. Contrast pairs were
  computed rather than eyeballed.
- Skip-to-content link and an `h1` landmark.
- Replay load progress (`loading 5/23`) and keyboard-shortcut hint.

### Changed

- **Replay chunks load six at a time**, in order, instead of one round trip each.
- **Events are paged through the cursor** (the endpoint caps a page at 500)
  instead of silently stopping at 500. If a session still has more after 20
  pages, the Events tab says so and its count reads `N+`.
- Clicking another session while one is loading now switches to it; it used to be
  ignored.
- Nothing informational renders below 12px (`max(<size>, 12px)`); accent-coloured
  text uses a lighter tint that clears 4.5:1; input and button edges use a
  stronger border that clears 3:1.
- `100vh` layouts also declare `100dvh`; touch devices get 44px targets; the
  transport bar wraps on narrow screens.

### Fixed

- **Replay screen was not keyboard-operable.** Session, event, console and
  network rows were `<div onClick>`; timeline markers were mouse-only divs with a
  hover tooltip. They are now focusable, named and activated by Enter/Space.
- **Failures were silent.** A failed sessions request rendered as "No sessions
  yet"; a failed replay load left a blank player. Each now shows an alert with a
  Retry button.
- **The funnel builder could not run.** `FunnelBuilder` read a `range` variable
  that was not in its scope, so Run failed with "range is not defined". It now
  receives the range as a prop.
- Placeholder-only inputs in Live feed, Errors, Behaviour, Flows and the session
  list now have accessible names.
- `rowButton`'s `role` was typed `string`, which failed type-checking on every
  use; it is now the literal `"button"`.

### Breaking Changes

- None.

---

## Summary of Changes

The replay screen gains the two things people asked for first — fullscreen and a
way to find an event — and the dashboard gets a robustness and accessibility pass
found by auditing it against a UI/UX rule set. No collector, API or schema change.
Initial JS payload: 28.6KB gz (budget 32KB). Verified in a real browser in light
and dark; not verified on a touch device or with a screen reader.

**Files Modified:**

- `collector/dashboard/ui/src/views/ReplayPlayer.tsx` - filters, paging, errors, progress, keyboard rows
- `collector/dashboard/ui/src/views/replaySurface.ts` - fullscreen, caption, marker buttons
- `collector/dashboard/ui/src/index.html` - tokens, light theme, type floor, touch rules, new components
- `collector/dashboard/ui/src/App.tsx` - skip link, `h1`
- `collector/dashboard/ui/src/views/Behaviour.tsx` - funnel `range` fix, input label
- `collector/dashboard/ui/src/views/{Errors,Flows,LiveFeed}.tsx` - input labels
- `collector/dashboard/ui/src/components/rowProps.ts` - `role` literal type

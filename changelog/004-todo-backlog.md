# Todo Backlog — What's Outstanding, and Why

### Added

- **`todo/`** — the live backlog. 19 items, one file each, with a `README.md`
  index and a `manifest.json` matching the schema `tasks/` already uses
  (`id`, `priority`, `component`, `depends_on`, `src_files`, `evidence`,
  `exit_check`, `effort`, `status`).

  Every item follows the same shape: **Problem** (with a `file:line` citation or
  a measurement), **Why it matters**, **Approach**, **Acceptance**, **Files**,
  **Open questions**, **Effort**. Priorities run P0 (the data is wrong, lost, or
  the config lies) through P3 (reach and ops).

### Changed

- **`claude.md`** gains a `## Backlog` section pointing at `todo/` and warning
  that `tasks/` is historical — 17 of its rows say `todo` for features that
  shipped.

---

## Summary of Changes

Most of this came out of integrating spyglass into a real app — a CA firm's task
manager, ~40 users — and then trying to answer actual questions with the data.
That surfaced things reading the code did not, because the aggregates all looked
fine:

- **Replay chunks overwrite each other across page loads** (`todo-001`). One real
  session: 50 chunk uploads, 18 files on disk, seqs `[1..18]` contiguous. 32
  chunks destroyed. `seq` is module state in `sdk/src/replay.ts:9`; the session
  id is in `sessionStorage`. A reload restarts at 1 and the collector overwrites
  by path.
- **`autocapture` does nothing** (`todo-002`). Typed, defaulted, documented in
  `docs/sdk.mdx` — and no module reads it.
- **No device or environment context at all** (`todo-003`). No user agent,
  viewport, screen, referrer or language anywhere in the SDK; `sessions.meta` is
  `NULL` for every row ever written.
- **rrweb is 81% of the dashboard payload and loads on every page**
  (`todo-013`). Measured: `app.js` is 320,136 raw / 100,661 gzipped; the same
  source with rrweb external is 60,038 / **19,312**. It is statically imported,
  so reading a table downloads the whole replay engine.
- **One cross-view link in the whole product** (`todo-018`). `onOpenIncident` is
  it. `Insights.tsx` has two `onClick`s — "Refresh" and "Run funnel" — so every
  DAU bar, top-page row, funnel step and flow cell is a dead end.

The UI items separate two problems that are easy to conflate: **weight**
(`todo-013`, one dependency, nearly free to fix) and **flow** (`todo-017`–`019`,
real design work). The second is the answer to "the UX has no clear flow" —
the navigation names storage mechanisms rather than jobs, three of the five
top-level views are one endpoint differently filtered, and the landing page is
an unbounded event stream.

Those three are deliberately grouped: 017 decides the sections and gives the tool
a front door, 018 makes every number lead somewhere, 019 gives those links
somewhere to land. Done separately they half-work.

Nothing here proposes adding a framework, a build step or a dependency. The app
code is 19KB gzipped for every view, component and chart; the Preact + esbuild +
`go:embed` stack is the right one and should not change.

**Files Modified:**

- `todo/README.md` - Index, priority definitions, suggested order, and a note on why the UI stack should not change
- `todo/manifest.json` - Machine-readable index of all 19 items
- `todo/001-replay-chunk-overwrite.md` - P0. Replay data lost across page loads
- `todo/002-autocapture-is-a-no-op.md` - P0. Cut the option or build it
- `todo/003-device-and-environment-context.md` - P1. The biggest multiplier on data already collected
- `todo/004-dashboard-time-range.md` - P1. Every query is all-time; no date picker exists
- `todo/005-saved-views-and-custom-dashboards.md` - P1. Staged in four steps; step 1 is nearly free
- `todo/006-segments-and-user-properties.md` - P2. Slice by role or team, not just user id
- `todo/007-funnel-step-timing.md` - P2. The funnel counts, never times
- `todo/008-event-pagination-and-export.md` - P2. 500-row cap, no cursor, no export
- `todo/009-server-side-ingest.md` - P3. Scope decision first, code second
- `todo/010-alerting-on-errors-and-reports.md` - P3. Would be the first deliberate egress; air-gap guarantee must stay exact
- `todo/011-sdk-distribution.md` - P3. Three separate install problems, all silent
- `todo/012-stale-task-manifest.md` - P3. `tasks/` says 17 shipped features are `todo`
- `todo/013-lazy-load-the-replay-engine.md` - P1. 100.7KB → ~19KB gzipped for one build flag
- `todo/014-live-feed-signal-to-noise.md` - P2. 254 of 286 events in a real session were network rows
- `todo/015-accessibility-pass.md` - P2. 1 focus-visible rule, 6 aria attributes; the replay transport has no accessible names
- `todo/016-first-run-empty-state.md` - P3. An empty collector looks identical to a broken install
- `todo/017-information-architecture.md` - P1. Regroup by job; give the tool a home page
- `todo/018-drill-down-paths.md` - P1. Every aggregate leads to its rows; every row to a replay
- `todo/019-entity-pages.md` - P2. User, flow and screen become destinations
- `claude.md` - Added the `## Backlog` section
- `changelog/004-todo-backlog.md` - This file

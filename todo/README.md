# Todo

What spyglass should do next, and why. One file per item.

`tasks/` is the _original build_ broken into units of work — historical, and its
statuses have drifted from reality. **This folder is the live backlog.** When
something here is done, delete the file (the changelog entry is the record) and
drop its row from `manifest.json`.

## How these were found

Most of this came out of integrating spyglass into a real app (a CA firm's task
manager, ~40 users) and then trying to answer actual questions with the data.
Every P0 here is a bug that only showed up from _looking at what was recorded_,
not from reading the code — the aggregates all looked fine.

Where an item cites evidence, it is a real measurement or a real `file:line`.
Check it before assuming it is still true.

## Priorities

|        | Meaning                                                                 |
| ------ | ----------------------------------------------------------------------- |
| **P0** | The data is wrong, lost, or the config lies. Fix before building on it. |
| **P1** | The tool cannot answer a question people immediately ask of it.         |
| **P2** | Real depth, but the tool is useful without it.                          |
| **P3** | Reach and ops. Worth doing, not worth blocking on.                      |

## Index

| #                                                 | Priority | Item                                                              | Component             |
| ------------------------------------------------- | -------- | ----------------------------------------------------------------- | --------------------- |
| [001](./001-replay-chunk-overwrite.md)            | **P0**   | Replay chunks overwrite each other across page loads              | sdk + collector       |
| [002](./002-autocapture-is-a-no-op.md)            | **P0**   | `autocapture` is documented, typed, defaulted — and unimplemented | sdk                   |
| [003](./003-device-and-environment-context.md)    | **P1**   | No device, viewport, browser or referrer is recorded at all       | sdk + collector       |
| [004](./004-dashboard-time-range.md)              | **P1**   | Every dashboard query is all-time; there is no date picker        | dashboard             |
| [005](./005-saved-views-and-custom-dashboards.md) | **P1**   | No way to save a question, so every session starts from scratch   | collector + dashboard |
| [006](./006-segments-and-user-properties.md)      | **P2**   | Cannot slice by anything about the user beyond their id           | sdk + collector       |
| [007](./007-funnel-step-timing.md)                | **P2**   | The funnel counts who reached a step, never how long it took      | collector             |
| [008](./008-event-pagination-and-export.md)       | **P2**   | Queries cap at 500 rows with no cursor and no export              | collector + dashboard |
| [009](./009-server-side-ingest.md)                | **P3**   | Only the browser can report; nothing server-side or batch         | collector             |
| [010](./010-alerting-on-errors-and-reports.md)    | **P3**   | Nothing tells you something broke; you have to go look            | collector             |
| [011](./011-sdk-distribution.md)                  | **P3**   | Installing the SDK is genuinely awkward, in three separate ways   | sdk                   |
| [012](./012-stale-task-manifest.md)               | **P3**   | `tasks/manifest.json` says 17 shipped features are `todo`         | repo                  |
| [013](./013-lazy-load-the-replay-engine.md)       | **P1**   | rrweb is 81% of the dashboard payload and loads on every page     | dashboard             |
| [014](./014-live-feed-signal-to-noise.md)         | **P2**   | Network rows drown everything else in the live feed               | dashboard             |
| [015](./015-accessibility-pass.md)                | **P2**   | Thinly accessible; the replay player barely at all                | dashboard             |
| [016](./016-first-run-empty-state.md)             | **P3**   | A fresh collector gives no clue what to do next                   | dashboard             |
| [017](./017-information-architecture.md)          | **P1**   | Organised by mechanism, and there is no home page                 | dashboard             |
| [018](./018-drill-down-paths.md)                  | **P1**   | Every number is a dead end — one link in the whole product        | dashboard             |
| [019](./019-entity-pages.md)                      | **P2**   | The nouns — user, flow, screen — are not destinations             | dashboard             |

## Suggested order

001 and 002 first — they are cheap and one of them is losing data.

Then **003 before 005**. Custom dashboards are the stated direction, but a
dashboard builder over data with no device, browser or referrer dimension can
only ever slice by user and time. Capturing context first makes 005 worth
building; the reverse order builds a nice UI over three columns.

004 is small, independently useful, and unblocks everything else being read over
a sensible window.

**017, 018 and 019 are one piece of work in three files.** They are the answer to
"the UX has no flow": 017 decides what the sections are and gives the tool a
front door, 018 makes every number lead somewhere, 019 gives those links
somewhere to land. Done separately they half-work — a home page of dead ends, or
drill-downs into views that were never meant to be landed on. Read all three
before starting any of them. Sequence 017 → 018 → 019, and 004 before all of
them, since none of it reads properly without a time window.

**013 is the best ratio in the backlog** — one build flag and two imports takes
the dashboard from 100.7KB to ~19KB gzipped. Do it whenever; it blocks nothing
and nothing blocks it.

004, 014 and step 1 of 005 all plumb the same thing — panel state in the URL
hash. Doing them together is meaningfully cheaper than in sequence.

## The UI is two separate problems

Worth not conflating them.

**Weight** is one dependency, statically imported —
[013](./013-lazy-load-the-replay-engine.md), and it is nearly free to fix.

**Capability and flow** is the real work: 017, 018, 019. The tool has good
capabilities that are unfindable, and no path from a number to an explanation.
That is a design problem, not a performance one, and it is where the comparison
to bigger tools actually bites.

The deliberate non-goal: spyglass should not chase feature parity. It should
chase the one thing it can do that a sampling tool cannot — every aggregate has
a complete, watchable session behind it. Today the UI exposes that from nowhere.

## A note on the UI stack

The dashboard is a Preact SPA built with esbuild and embedded into the Go binary
via `go:embed`. That is the right stack and should not change — the app code is
**19KB gzipped** for every view, component and chart, which is about as light as
this gets. There is no framework problem here.

The weight is one dependency: rrweb, statically imported, 81% of the payload.
Fix that ([013](./013-lazy-load-the-replay-engine.md)) and the UI is already as
small as the pitch claims. Nothing else in this folder proposes adding a
dependency, a build step, or a framework.

## Writing a new one

Keep the shape: **Problem** (with evidence), **Why it matters**, **Approach**,
**Acceptance**, **Files**, **Open questions**, **Effort**. State the problem
before the solution, and put a real measurement in it wherever one exists — the
number is what stops an item being argued away later.

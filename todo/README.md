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

| #                                                 | Priority | Item                                                            | Component             |
| ------------------------------------------------- | -------- | --------------------------------------------------------------- | --------------------- |
| [005](./005-saved-views-and-custom-dashboards.md) | **P1**   | No way to save a question, so every session starts from scratch | collector + dashboard |
| [011](./011-sdk-distribution.md)                  | **P3**   | Installing the SDK is genuinely awkward, in three separate ways | sdk                   |
| [012](./012-stale-task-manifest.md)               | **P3**   | `tasks/manifest.json` says 17 shipped features are `todo`       | repo                  |
| [016](./016-first-run-empty-state.md)             | **P3**   | A fresh collector gives no clue what to do next                 | dashboard             |

## What shipped

Fifteen items have been delivered and their files deleted; `changelog/006`
through `changelog/015` are the record. Briefly:

- **The two P0s** — replay chunks were overwriting each other across page loads
  (32 of 50 chunks destroyed in a measured session), and `autocapture` was a
  config option that did nothing. Cut rather than built.
- **The dashboard was restructured** around five job-shaped sections with a Home
  page, drill-downs from every aggregate to a replay, and flow/user/screen
  entity pages.
- **rrweb is lazy-loaded** — the initial payload went from 100.7KB to ~23KB
  gzipped, with a CI budget so it cannot silently regress.
- **A time range picker**, applied everywhere, defaulting to 30 days, with
  timezone-correct day buckets.
- **Session context and user traits**, which turned "this takes 52s" into "on
  mobile it takes 2m10s" and "Employees are slower at this than Partners".
- **Funnel step timing**, keyset pagination, CSV export, opt-in webhook
  alerting, and server-side ingest.
- **An accessibility pass** — a browser audit went from 21 findings to zero, the
  replay player is keyboard-operable, and a static guard runs in CI.

Two bugs were found while building, neither of them on the list: the SDK's
`flush()` silently dropped events when one was already in flight, and the
dashboard shipped no cache headers, which content-hashed chunks made unsafe.

## Writing a new one

Keep the shape: **Problem** (with evidence), **Why it matters**, **Approach**,
**Acceptance**, **Files**, **Open questions**, **Effort**. State the problem
before the solution, and put a real measurement in it wherever one exists — the
number is what stops an item being argued away later.

# The dashboard is organised by mechanism, and has no home

> **P1** · dashboard · `todo-017`

## Problem

The top-level navigation is five flat peers named after _how data is stored_,
not after anything a person wants to do:

```
Live feed  |  Timeline  |  Errors  |  Replay  |  Insights
```

Three of those five are the same query with different filters. Live feed is
`/v1/query/events` unfiltered; Errors is the same endpoint with `type=error`;
Timeline is the same events grouped by user and session. They are presented as
peer destinations, so a newcomer has no way to know that.

Two more problems fall out of the same shape:

**There is no home.** `parseHash` (`App.tsx:27`) defaults to `live`, so opening
the dashboard drops you into an unfiltered, unbounded event stream — the rawest
view in the product, and (see [014](./014-live-feed-signal-to-noise.md)) 89%
network noise on real data. Nothing anywhere answers "is my app OK today".

**Insights is a dumping ground.** One scrolling page holds DAU, top events, top
pages, errors-by-day, a funnel builder and the flow-duration table — six
unrelated analyses with no hierarchy, no relationship to each other, and one
shared Refresh button.

## Why it matters

The comparison to PostHog is instructive precisely because spyglass should _not_
try to match it. PostHog's nav works because it is grouped by job — product
analytics, session replay, error tracking — each with its own sub-navigation and
its own landing state. The grouping is the cheap part; the hundred features
inside are not, and are not wanted here.

Right now the tool has genuinely good capabilities that nobody will find. The
incident view is the standout feature and is reachable from two places. Flow
durations sit below the fold on a page called "Insights", under a funnel builder.
Someone evaluating spyglass sees an event table.

An analytics tool is judged in the first thirty seconds, and those thirty seconds
are currently spent looking at network requests.

## Approach

Regroup what exists by **job**. This adds no query capability and throws nothing
away — it is routing, one new page, and splitting Insights apart.

```
Home       Is everything OK? — the only new page
Behaviour  What are people doing? — flows, funnels, screens, actions
Sessions   Who did it? — users → sessions → replay
Issues     What broke? — errors, bug reports → incident
Explore    The raw event stream — the escape hatch, not the front door
```

Mapping from today, so nothing is lost:

| Today     | Becomes                                                       |
| --------- | ------------------------------------------------------------- |
| Live feed | **Explore** (demoted from landing page)                       |
| Timeline  | **Sessions** — user list and session list are the same nouns  |
| Replay    | **Sessions** — the detail view of a session, not a peer of it |
| Errors    | **Issues**                                                    |
| Incident  | **Issues** detail (unchanged, better reachable)               |
| Insights  | split: headline numbers → **Home**, analyses → **Behaviour**  |

### Home is the real work

Everything else is rerouting. Home is a new page, and it has to answer one
question — _does anything need my attention_ — not display every metric that
exists.

Candidate content, roughly in priority order:

- **Active users**, with change vs the previous equivalent period.
- **Flows that got slower.** The p50/p90 machinery already exists and
  `group=day` already works; comparing this window to the previous one is a
  second query, not new capability. This is the most valuable thing spyglass can
  put on a home page and nothing else in the tool surfaces it.
- **New errors** — signatures not seen in the previous window. Genuinely new is
  much more actionable than "9 errors".
- **Recent bug reports**, unresolved first. A human took the trouble to file it.
- **A short live strip** — the last handful of _deliberate_ actions, so the page
  feels alive without being a firehose.

The organising idea: **every tile on Home is a finding, and every finding links
to the thing that explains it** (see [018](./018-drill-down-paths.md)). A Home
made of numbers that do not lead anywhere is a worse version of Insights.

### Deltas are a prerequisite

Every number in the dashboard is currently an absolute over an unbounded window.
"9 errors" is unreadable without "up from 2". Home needs period-over-period
comparison to be worth building, which means [004](./004-dashboard-time-range.md)
has to land first — a comparison needs a window to compare.

### Scope discipline

Explicitly **not** in scope, and worth writing down so it stays out: retention
curves, cohort analysis, path/flow diagrams, dashboards-of-dashboards, feature
flags, experiments, alerting rules UI. Those are the PostHog features that come
with PostHog's weight. The whole premise is a tool for 20–200 users that stays
one binary and one file.

Sub-navigation inside a section should be tabs, not a second sidebar. Five
top-level items is already the ceiling for something this size.

## Acceptance

- Opening the dashboard lands on Home, not on an event stream.
- Home answers "is anything wrong" without scrolling, on a 1280px screen.
- Every number on Home carries a comparison to the previous period.
- Every existing view is still reachable; no capability is removed.
- Insights no longer exists as a page — its contents live where they belong.
- The nav still fits on one line at 720px.

## Files

- `collector/dashboard/ui/src/App.tsx` — nav model, routes, hash parsing, default
- `collector/dashboard/ui/src/views/Home.tsx` — new
- `collector/dashboard/ui/src/views/Behaviour.tsx` — new shell over existing panels
- `collector/dashboard/ui/src/views/Sessions.tsx` — merges UserTimeline + ReplayPlayer
- `collector/dashboard/ui/src/views/Insights.tsx` — dissolved
- `collector/query/…` — a comparison window on the aggregate endpoints
- `docs/dashboard.mdx` — rewritten around the new structure

## Open questions

- **Does Explore survive as a top-level item**, or is it a mode inside Sessions?
  A raw event table is genuinely useful for debugging and genuinely intimidating
  as navigation. Leaning toward keeping it, last in the nav, plainly labelled.
- **Where do flow durations live** — Behaviour, or Home? Probably both: the
  regression on Home, the full table in Behaviour.
- **Is "Behaviour" the right word?** "Product" and "Analytics" are both
  ambiguous in a tool that is entirely analytics. Worth a better name.
- **Comparison semantics.** Previous equal-length period is the obvious default;
  same period last week is often more honest for a workday-shaped app. Pick one,
  state it in the UI.

## Effort

**L** — and it is the item most worth doing carefully rather than quickly.
Routing and regrouping is M; Home is a design problem before it is a coding one.
Worth sketching the page on paper before opening the editor.

# Every number is a dead end

> **P1** · dashboard · `todo-018`

## Problem

There is **one** cross-view navigation path in the entire dashboard. Counted
across every view:

```
Errors.tsx        onClick=3   ← 1 is onOpenIncident, 2 are filters
LiveFeed.tsx      onClick=2   ← 1 is onOpenIncident, 1 is a filter
Insights.tsx      onClick=2   ← "Refresh" and "Run funnel". Nothing else.
Flows.tsx         onClick=1   ← "Refresh"
UserTimeline.tsx  onClick=2   ← both intra-view
ReplayPlayer.tsx  onClick=10  ← all player transport controls
Incident.tsx      onClick=7   ← mostly intra-view; onBack goes to Errors
```

`onOpenIncident` (error row → incident) is the only link between two views in
the product.

So on the Insights page: DAU bars, top-page rows, top-event rows, funnel steps
and every cell of the flow-duration table are inert. You can learn that
`task.create` has a p90 of 96 seconds, and there is no way — anywhere in the UI —
to see _which sessions those were_.

## Why it matters

This is the "no clear flow" problem. Each view is an island that answers its own
question and hands you nothing to do with the answer. The natural next thought
after every aggregate — _show me one_ — is unavailable, so analysis stops at the
number.

It also strands the best thing in the product. The incident view assembles a
replay cued to the moment, a breadcrumb timeline, a network waterfall and the
console, and it is described as the killer feature. It is reachable from two row
types on two pages.

And it wastes the actual differentiator. PostHog samples, and its replay is
partial and opt-in — so an aggregate there often _cannot_ lead to a recording of
the specific session behind it. spyglass records every session continuously with
identified users, which means **every number in this product has a watchable
session behind it**. That is the one place a small tool beats a large one, and
the UI currently does not expose it anywhere.

## Approach

One rule, applied everywhere:

> **Every aggregate leads to the rows behind it. Every row leads to a session.
> Every session leads to a replay.**

That is three hops from any number to watching a human hit the problem. Nothing
below requires a new query capability — the endpoints already take `user`,
`type`, `from`, `to`, `name` and `session`; they are simply never called with
what the user just clicked.

Concrete paths, roughly by value:

| From                  | Click          | To                                                  |
| --------------------- | -------------- | --------------------------------------------------- |
| Flow row              | the p90 cell   | Sessions where that flow ran slowest, slowest first |
| Flow row              | abandon rate   | Sessions where it was abandoned                     |
| Flow breakdown        | a user row     | That user's page, scoped to that flow               |
| Funnel step           | the drop       | Sessions that reached step N and not N+1            |
| DAU chart             | a day          | Sessions from that day                              |
| Top pages             | a row          | That screen's page ([019](./019-entity-pages.md))   |
| Top events            | a row          | Explore, filtered to that event name                |
| Errors by day         | a bar          | Issues, filtered to that day                        |
| Any user id, anywhere | the id         | That user's page                                    |
| Any session row       | anywhere       | The replay, cued                                    |
| Incident              | breadcrumb row | The replay, seeked to that moment                   |

The last one is worth calling out: the incident view already shows a timeline
next to a player, and clicking a breadcrumb should seek. That is a two-line
change and it is the difference between reading an incident and watching it.

### What this needs first

Filter state has to live in the URL, or a drill-down cannot carry its context.
`#/sessions?flow=task.create&slower_than=p90&from=…` is both the mechanism and
the shareable-link feature. This is the same plumbing as
[004](./004-dashboard-time-range.md), [014](./014-live-feed-signal-to-noise.md)
and step 1 of [005](./005-saved-views-and-custom-dashboards.md) — four items,
one piece of state.

One genuinely new query shape is needed for the most valuable path: "sessions
where flow X took longer than N ms". The flows aggregate throws away session ids
today. Returning them — or adding a `session` grouping — is a small store change
and it is what makes the whole rule work rather than mostly work.

### Make it visible

A link nobody notices is a link that does not exist. Anything clickable needs to
look it — cursor, hover state, and a focus ring (which
[015](./015-accessibility-pass.md) is adding anyway). Rows that drill down should
be `<button>` or `<a>`, not `div`s with handlers, so keyboard and screen-reader
users get the same paths.

Add a back affordance that returns with filters intact. `Incident`'s `onBack`
hard-codes `go("/errors")` regardless of where the user came from, which is
already the wrong behaviour for the one path that exists.

## Acceptance

- From any aggregate in the product, at most three clicks reach a replay of a
  session behind it.
- Drill-downs carry their filter context and are shareable as URLs.
- Back returns to where you came from, with filters intact.
- Every clickable row is a real control — keyboard reachable, focus visible.
- Clicking a breadcrumb in the incident view seeks the player.

## Files

- `collector/dashboard/ui/src/App.tsx` — filter state in the hash, routing
- `collector/dashboard/ui/src/views/Flows.tsx` — the p90 and abandon paths
- `collector/dashboard/ui/src/views/Insights.tsx` / `Behaviour.tsx` — chart and list clicks
- `collector/dashboard/ui/src/views/Incident.tsx` — breadcrumb seek, real back
- `collector/dashboard/ui/src/views/ReplayPlayer.tsx` — accept a cue timestamp
- `collector/store/flows.go` — session ids on flow rows, or a session grouping
- `collector/query/flows.go`

## Open questions

- **Does "slowest sessions for this flow" need a new endpoint**, or does
  `group=session` on the existing flows query cover it? The latter is smaller and
  reuses everything; check the row counts are sane before committing to it.
- **How much context can a URL carry** before it stops being pasteable? Probably
  fine; worth watching once several filters compose.
- Should a drill-down open in place, or as a panel over the current view?
  In place is simpler and matches the hash-routing model already in use.

## Effort

**M.** Individually every path is small. The value is in doing all of them, so
the rule holds everywhere rather than in three places — a half-applied rule is
back to islands.

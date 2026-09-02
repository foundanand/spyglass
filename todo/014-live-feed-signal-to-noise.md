# Network rows drown everything else in the live feed

> **P2** · dashboard · `todo-014`

## Problem

The live feed shows all event types by default, ordered by time. In a real
session that means it shows almost nothing but network calls.

Measured, one 25-minute session in a host app:

```
network   254        ← 89% of the feed
pageview   17
error       9
event       4
flow        4
```

Every tRPC batch, every asset fetch, every poll is a row. The 17 things a person
actually _did_ are scattered through 254 rows they did not, and the default
`limit` is 100 — so the first screen of the feed can be entirely network noise
with not one deliberate action visible.

The type filter exists (`SEG_OPTIONS` in `LiveFeed.tsx`) and works. It just
starts on "all", which on real data is the least useful setting.

## Why it matters

The live feed is the landing view — it is what `#/` resolves to and the first
thing anyone sees. Its job is "what is happening right now", and it currently
answers "HTTP is happening".

Network capture is genuinely valuable — it is how the incident view builds a
waterfall, and how you spot a slow endpoint. The problem is not that it is
recorded; it is that recording volume and reading priority are inverted.

This also compounds [008](./008-event-pagination-and-export.md): with no
pagination, noise does not just bury signal, it puts it permanently out of
reach.

## Approach

Change the default, do not remove the capability.

**Default the feed to signal.** Land on everything _except_ `network` — pageview,
event, error, bug_report, flow. Make "network" a chip the user opts into, and
make the filter state visible enough that nobody thinks data is missing. A count
badge on the network chip ("network 254") both advertises it and explains the
absence.

**Group consecutive network rows.** A collapsed "12 requests · 340ms total" row
that expands in place would keep the timeline honest while staying readable —
the timeline view is where the full waterfall belongs anyway.

**Bias the row budget toward signal.** Fetching 100 rows of mixed types wastes
most of the budget on the least interesting type. If the default excludes
network, the same 100 rows cover far more elapsed time.

Whatever is chosen, the filter belongs in the URL hash so a filtered feed is
shareable — same mechanism as [004](./004-dashboard-time-range.md) and
[005](./005-saved-views-and-custom-dashboards.md). Do them together; it is one
piece of state plumbing serving three items.

## Acceptance

- The default feed on a real dataset shows deliberate actions, not a wall of
  requests.
- Network is one click away and its availability is obvious — no user should
  conclude the data is not being captured.
- The filter round-trips through the URL.
- The incident view's network waterfall is untouched.

## Files

- `collector/dashboard/ui/src/views/LiveFeed.tsx` — default filter, chip counts,
  optional grouping
- `collector/dashboard/ui/src/App.tsx` — hash state
- `collector/dashboard/ui/src/index.html` — styles for a collapsed group row

## Open questions

- Should this be a _display_ default or a _query_ default? Querying
  `type!=network` is cheaper but the store has no negative filter today — it
  takes a single `type`. Adding one is small and also serves "errors and bug
  reports only".
- Is grouping worth it, or does excluding by default make it unnecessary? Try
  the default first; it may be the whole fix.

## Effort

**S** for the default and chip counts. **M** if consecutive-row grouping is
built.

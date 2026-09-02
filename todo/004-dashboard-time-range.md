# Every dashboard query is all-time; there is no date picker

> **P1** · dashboard · `todo-004`

## Problem

Nothing in the embedded dashboard lets you choose a time window. Every fetch in
`collector/dashboard/ui/src/`:

```
Insights.tsx:126    fetch("/v1/query/aggregates")            ← no from/to
Insights.tsx:64     fetch(`/v1/query/funnel?steps=…`)        ← no from/to
Flows.tsx:76        fetch(`/v1/query/flows?${params}`)       ← name/group only
LiveFeed.tsx:83     fetch(`/v1/query/events?${params}`)      ← user/type/app only
Errors.tsx:61       fetch(`/v1/query/events?${params}`)      ← same
UserTimeline.tsx:92 fetch("/v1/query/users?limit=100")
ReplayPlayer.tsx:202 fetch("/v1/query/sessions")
```

Every endpoint already accepts `from` and `to` in unix ms. The dashboard has
simply never sent them.

## Why it matters

Every number on the Insights page is a lifetime total. That is fine on day three
and useless on day ninety:

- "Typical time to create a task" averages in the week the feature shipped
  broken, forever.
- The DAU chart grows a longer x-axis every day and never becomes more readable.
- You cannot ask "did the change I shipped on Tuesday help", which is the entire
  reason to measure a duration.

`events_days` defaults to keep-forever, so this gets monotonically worse.

It also caps the flows endpoint's usefulness — `maxFlowSamples` is 200,000, and
an all-time query on a busy app will eventually hit it and start silently
truncating.

## Approach

One range control in the nav, owned by `App.tsx`, applied to every view. Not a
per-view picker — the whole point is comparing panels against the same window.

Presets first: 24h / 7d / 30d / 90d / all. A custom range is a nice-to-have; the
presets cover the real questions.

Put the choice in the URL hash so a range is shareable and survives a reload —
`#/insights?days=7`. The dashboard already routes on the hash
(`App.tsx:parseHash`), so this is an extension of something that exists rather
than new machinery.

Default to **30 days**, not all-time. A default that degrades over time is the
bug being fixed.

Views that are inherently "latest" (live feed, the session list) should keep a
recency default rather than inheriting a 90-day window that makes them slow.

## Acceptance

- Changing the range updates every panel on the page.
- The range round-trips through the URL — reload and refresh keep it.
- Insights defaults to 30 days out of the box.
- A flows query over the default window cannot approach `maxFlowSamples` on a
  20–200 user app.

## Files

- `collector/dashboard/ui/src/App.tsx` — the control, hash param, and context
- `collector/dashboard/ui/src/views/Insights.tsx`
- `collector/dashboard/ui/src/views/Flows.tsx`
- `collector/dashboard/ui/src/views/LiveFeed.tsx`
- `collector/dashboard/ui/src/views/Errors.tsx`
- `collector/dashboard/ui/src/views/UserTimeline.tsx`
- `collector/dashboard/ui/src/index.html` — styles for the control

## Open questions

- Should `/v1/query/users` and `/v1/query/sessions` honour a range? They take no
  `from`/`to` today. "Active users in the last 7 days" is a real question, so
  probably yes — a small store change.
- Timezone. Aggregates bucket by UTC day (`date(ts/1000,'unixepoch')`). A range
  picker makes that visible: an operator in IST will see days split at 05:30.
  Worth deciding now rather than after someone reports it as a bug.

## Effort

**S–M.** Mechanical, touches seven files. The timezone question is the only part
that needs a decision.

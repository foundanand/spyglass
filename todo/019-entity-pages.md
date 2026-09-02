# The nouns are not destinations

> **P2** · dashboard · `todo-019`

## Problem

spyglass has four nouns that matter — a **user**, a **session**, a **flow**, a
**screen** — and only one of them has a page.

- **Session** has one: the replay player, plus the incident view for a slice.
- **User** does not. `UserTimeline` comes closest: a sidebar of users, and
  picking one lists their sessions with breadcrumbs. But a user id appearing
  anywhere else in the product — a flow breakdown row, an error row, a session
  row — is inert text.
- **Flow** does not. `task.create` is a row in a table and a value in a dropdown.
  There is no page that tells its story.
- **Screen** does not. `/dashboard/invoices` appears in "top pages" as a label
  next to a count and nothing else.

## Why it matters

Entity pages are what turn a set of reports into something you can explore. The
pattern people expect from every analytics tool is that clicking a noun takes
you to that noun — and once it holds, navigation stops needing to be taught.

They are also where a question gets _answered_ rather than raised. "Flows take
52s at p50 and 96s at p90" is a finding that immediately generates four more
questions — is it getting worse, who is slow, does it depend on inputs, which
sessions were the slow ones. Those are four separate manual queries today,
spread across two views, and one of them is impossible. On a flow page they are
the page.

This is the natural partner to [018](./018-drill-down-paths.md): drill-down
defines the _edges_ of the graph, entity pages are the _nodes_. Neither works
well without the other — links need somewhere to land.

## Approach

Three pages. Each is a composition of queries that already exist, plus the
session-level drill-down that 018 adds.

### Flow page — `#/flow/task.create`

The highest value, because the flow data is the newest and least exposed.

- Headline: p50 / p90 / abandon rate, with change vs the previous period.
- Trend over time (`group=day`, already supported).
- Distribution of durations — a histogram says far more than a p50 and a p90.
  This is the one genuinely new visual; a bucketed count is a small store
  addition.
- By user (`group=user`) and by prop (`group=prop:<key>`) — both already work,
  currently buried in a dropdown on a shared page.
- **The slowest sessions**, listed, each linking to its replay. The point of
  the whole page.

### User page — `#/user/PARV0004`

- Who they are, when last seen, session count.
- Their sessions, newest first, each linking to a replay.
- Their flow timings against the team median — "slower at invoicing than
  everyone else" is a finding about the software, not the person, and the page
  should be framed that way.
- Their errors and bug reports.

Absorbs what `UserTimeline` does today, as a real page reachable from anywhere a
user id is rendered.

### Screen page — `#/screen/%2Fdashboard%2Finvoices`

- Views over time, and how many distinct people.
- Errors that happened on it — currently unanswerable without reading URLs by
  hand.
- Flows started or completed on it.
- Recent sessions that visited.

Turns "top pages" from a leaderboard into an entry point.

### Do not build

No generic "entity" abstraction, no schema for user-defined nouns, no
auto-generated pages. Three hand-written pages for the three nouns that exist.
The abstraction costs more than the third page.

## Acceptance

- A user id rendered anywhere links to that user's page.
- A flow name rendered anywhere links to that flow's page.
- Each page answers its obvious follow-up questions without leaving it.
- Each page reaches a replay in one click.
- Every page is a real URL that can be pasted to a colleague.

## Files

- `collector/dashboard/ui/src/views/FlowPage.tsx` — new
- `collector/dashboard/ui/src/views/UserPage.tsx` — new, absorbs UserTimeline
- `collector/dashboard/ui/src/views/ScreenPage.tsx` — new
- `collector/dashboard/ui/src/components/UserLink.tsx`, `FlowLink.tsx` — so
  linking is the default rather than a thing each view remembers
- `collector/dashboard/ui/src/App.tsx` — routes
- `collector/store/flows.go` — duration histogram buckets
- `collector/query/events.go` — filter events by URL, for the screen page

## Open questions

- **Does the screen page pull its weight?** It is the weakest of the three;
  "errors on this screen" may be the only part anyone uses. Consider building
  Flow and User first and seeing whether Screen is missed.
- **Histogram bucketing** — fixed buckets are simple and misleading across four
  orders of magnitude; log buckets read better and are harder to label. Log,
  with human labels.
- **URL encoding for screen paths.** A path as a path segment needs encoding and
  is easy to get subtly wrong; a query param may be less elegant and more
  robust.

## Effort

**L across all three. M for the flow page alone** — which is where to start, and
which may be enough for a while.

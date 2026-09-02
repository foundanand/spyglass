# Queries cap at 500 rows with no cursor and no export

> **P2** · collector + dashboard · `todo-008`

## Problem

`Store.QueryEvents` clamps the limit and offers no way past it
(`collector/store/store.go`):

```go
limit := q.Limit
if limit <= 0 || limit > 500 { limit = 100 }
…
ORDER BY ts DESC LIMIT ?
```

No `OFFSET`, no cursor, no next-page token. `QueryUsers` and `ListSessions` are
the same shape.

So the live feed and the error list show the most recent N and stop. There is no
"older" button, and no way to pull a full window out for analysis elsewhere.

There is also no export of any kind — no CSV, no JSON download, nothing. The only
way to get data out is to query the API by hand with `curl` and a password.

## Why it matters

Two distinct problems behind one cause.

**Browsing.** A session with 286 events (a real one, ~25 minutes of use) already
exceeds the 100-row default, and 254 of those events are network rows that crowd
out the interesting ones. Investigating anything more than a few minutes old
means the UI simply cannot reach it.

**Getting data out.** The premise is that this is _your_ data on _your_ machine —
and the practical test of that is whether you can take it somewhere else. Right
now the honest answer is "open the SQLite file", which is true and unsatisfying,
and impossible from the dashboard.

Export also relieves pressure on [005](./005-saved-views-and-custom-dashboards.md):
if someone can pull a window into a spreadsheet, they need the built-in dashboard
to answer fewer of their questions.

## Approach

**Pagination.** Keyset, not offset. Rows are already `ORDER BY ts DESC` and `id`
is monotonic, so a cursor of `(ts, id)` pages cleanly and does not skip or repeat
when new events arrive mid-scroll — which offset does, on a live feed, constantly.
Return an opaque `next` token; the flows endpoint's `after`-style parameter is a
reasonable precedent to match.

**Export.** `?format=csv` on the existing query endpoints, streamed rather than
buffered so a large window does not balloon collector memory (currently ~20MB,
worth protecting). Reuse the exact filters the JSON path takes, so an export is
always "what I am looking at, as a file" and never a second, subtly different
query. A download button in the dashboard toolbar.

Flatten `props` sensibly for CSV — either one JSON column or a column per key
discovered in the result set. The first is honest and boring; prefer it.

## Acceptance

- Live feed and errors can page backwards through history.
- Paging is stable while new events arrive.
- Any query view can be downloaded as CSV with the same filters applied.
- A large export does not materially raise collector memory — test with a
  synthetic large window.

## Files

- `collector/store/store.go` — cursor support on `QueryEvents`, `ListSessions`
- `collector/store/store_test.go`
- `collector/query/events.go`, `sessions.go`, `users.go` — cursor + `format=csv`
- `collector/query/csv.go` — new, streaming writer
- `collector/dashboard/ui/src/views/LiveFeed.tsx`, `Errors.tsx` — "older", download
- `docs/api.mdx`

## Open questions

- Should the network events be filterable _out_ of the live feed by default?
  They were 254 of 286 events in a real session, which is its own usability
  problem and might be a cheaper fix than paging.
- Is a JSON-lines export more useful than CSV for anything with `props`? Possibly
  offer both; the streaming machinery is shared.

## Effort

**M.** Pagination and export are each S–M and share the filter plumbing, so doing
them together is cheaper than sequentially.

# Funnel Step Timing, Keyset Pagination, and CSV Export

### Added

- **The funnel reports how long each step took, not just who reached it**
  (`todo-007`). It could say 30 viewed, 12 added, 5 checked out; it could not say
  the drop happened because step 2 takes a minute and a half.

  The walk already had each event's user and name in time order, so this is the
  timestamp joining the projection and an accumulation:

  ```
  view      count=30
  cart      count=12   p50 10.0s   p90 10.8s   n=12
  checkout  count= 5   p50 95.9s   p90 139.9s  n=4
  to_convert           p50 106.7s  p90 149.5s  n=4
  ```

  `to_convert` is first step → last step for users who completed the funnel.

- **`max_step_ms`** (default 30 minutes, matching the SDK flow timeout and the
  session idle window). An inferred gap between two events has no upper bound —
  someone who starts on Friday and finishes on Monday contributes 72 hours — so
  a cap is needed to keep the timing meaningful.

  It is a **timing filter, never a counting filter**: that Monday user still
  converted, so the count includes them and the timing does not. That is why
  `samples` can be lower than `count`, and why `samples` is reported at all — an
  over-tight cap becomes visible instead of silent. Pass `max_step_ms=0` for
  funnels that legitimately span days.

  No mean is reported at any setting. A mean is precisely the statistic an
  unbounded gap ruins; p50 and p90 are not.

- **Keyset pagination on `/v1/query/events`** (`todo-008`). Rows order by
  `(ts DESC, id DESC)` and a cursor names a position in the data rather than a
  distance from the top, so pages stay stable while new events arrive. `OFFSET`
  on a live feed skips and repeats rows constantly — every event that lands
  mid-scroll shifts every offset by one.

  The response carries `next`; a short page returns an empty one, so the client
  never makes a round trip to discover the end. A malformed cursor is ignored
  rather than rejected — restarting at the top beats a 400 mid-scroll.

- **`format=csv` streaming export**, taking the _same_ filters as the JSON path,
  so an export is always "what I am looking at, as a file" rather than a second,
  subtly different query. `props` is one JSON column: a column per discovered
  key is prettier for uniform data and wrong for everything else, since the
  point of props is that different events carry different shapes.

  Streamed via a new `Store.StreamEvents`, and flushed every 1000 rows.
  Measured: streaming 50,000 events with props grows the heap by **1.27MB**,
  against a 16MB test ceiling. The RAM target is under 50MB, and an unbounded
  export was the obvious way to blow it.

- **"Older" paging and a CSV button in the live feed and error list.** The live
  feed pauses polling while history is open — a refresh would otherwise replace
  the live page and strand the pages below it — and says so, with a "back to
  live" control.

### Fixed

- **The live feed ignored the time range.** Its poll effect did not depend on
  the window, so the 3-second interval kept calling a closure holding the old
  range and changing the range never took effect on that view. Introduced with
  the range picker in the previous change and caught while adding paging.

### Changed

- `Store.Funnel` takes a `FunnelQuery` struct rather than four positional
  arguments, matching `FlowQuery`. The HTTP response is additive — existing
  count semantics and their tests are untouched.
- `Store.QueryEvents` is now a thin collector over `StreamEvents`.

---

## Summary of Changes

Two items that shared their filter plumbing, so they were cheaper together.

The funnel change is the more interesting one: counts localise a problem to a
step, durations explain it, and a funnel needs no instrumentation at all — which
is exactly why it is the right place to find a slow step nobody knew to measure.

Pagination and export answer the same complaint from opposite ends. A real
25-minute session already produces 286 events, so anything older than a few
minutes was simply unreachable in the UI; and the premise that this is your data
on your machine is only worth something if you can take it somewhere else.

**Files Modified:**

- `collector/store/store.go` - step timing, `FunnelQuery`/`FunnelResult`, keyset cursor, `StreamEvents`
- `collector/store/store_test.go` - timing, the cap keeping conversions, paging stability, identical timestamps, streaming
- `collector/query/funnel.go` - `max_step_ms`, `to_convert`
- `collector/query/export.go` - new; opaque cursor codec and streaming CSV writer
- `collector/query/events.go` - `cursor`, `format=csv`, `next`
- `collector/query/export_test.go` - new; CSV validity and quoting, filter parity, paging, memory
- `collector/dashboard/ui/src/views/LiveFeed.tsx` - paging, pause-while-browsing, CSV link, range dependency fix
- `collector/dashboard/ui/src/views/Errors.tsx` - paging and CSV link
- `collector/dashboard/ui/src/views/Insights.tsx` - per-step timing and end-to-end conversion
- `collector/dashboard/ui/src/index.html` - pager, download link, funnel timing styles
- `docs/api.mdx` - funnel timing and the cap, cursor, export, counts, `tz`, `session:` grouping

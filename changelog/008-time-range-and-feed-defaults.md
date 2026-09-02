# A Time Window, and a Live Feed That Shows What People Did

Two changes that share one piece of plumbing: state that belongs in the URL.

### Added

- **A time range picker, applied to every view** (`todo-004`). Presets — 24h, 7d,
  30d, 90d, All — in the nav, owned by `App.tsx` rather than per-view, because
  the point is comparing panels against the _same_ window.

  Every collector endpoint already accepted `from`/`to`; the dashboard had
  simply never sent them, so every number on the Insights page was a lifetime
  total. That is fine on day three and useless on day ninety: "typical time to
  create a task" averaged in the week the feature shipped broken, forever, and
  there was no way to ask whether Tuesday's change helped — which is the entire
  reason to measure a duration.

  **The default is 30 days, not all-time.** A default that silently degrades as
  the database grows is the bug being fixed. It also keeps flow queries clear of
  the 200,000-sample `maxFlowSamples` ceiling, which an all-time query on a busy
  app would eventually hit and start silently truncating.

  The window lives in the hash (`#/insights?range=7d`), so it is shareable and
  survives a reload.

- **`GET /v1/query/counts`** — event counts by type for a window, optionally
  filtered by app and user. It exists so the live feed's type chips can say what
  they are hiding.

- **`from`/`to` on `/v1/query/users` and `/v1/query/sessions`.** Neither took a
  window, so "who was active this week" was unanswerable — only "who has ever
  used this".

- **`exclude=` on `/v1/query/events`**, backed by `EventQuery.ExcludeTypes`.

### Changed

- **Day buckets follow the viewer's calendar, not UTC.** `DAU` and `ErrorsByDay`
  bucketed on `date(ts/1000,'unixepoch')`. A range picker makes that visible: an
  operator in IST reading "errors by day" over UTC buckets sees their days split
  at 05:30, so Tuesday evening's spike lands half in Monday.

  The dashboard now sends its own offset (`tz`, minutes east of UTC) and the
  bucket expression shifts to match. Correct for whoever is looking, with no
  config key anyone would have to remember to set. The offset is clamped to ±14h
  so a malformed parameter cannot reach the SQL.

- **The live feed lands on activity, not network** (`todo-014`). Network events
  are the overwhelming majority of a real session — one measured 25-minute
  session logged **254 network rows against 17 pageviews, 9 errors, 4 captures
  and 4 flows**, 89% of the feed. With a row limit and a time ordering, the
  first screen of the landing view could be entirely HTTP chatter without one
  deliberate action visible.

  The default now excludes network, **in SQL rather than in the browser**, so the
  row budget is spent on rows the reader wants and the same limit covers far
  more elapsed time. Nothing was removed: network is one chip away.

  Every chip carries a count, and the feed states plainly what it is hiding —
  "Showing what people did. 59 network requests in this window are hidden — show
  them." — so nobody can conclude the data was never captured. The filter
  round-trips through the hash (`#/live?type=network`), and the incident view's
  network waterfall is untouched.

- **The dashboard sends cache headers.** Content-hashed chunks are `immutable`;
  `index.html` and the entry bundle are `no-cache`. This became a correctness
  issue with code splitting: a browser holding a stale `app.js` can request a
  chunk hash the new binary no longer contains, breaking the replay view
  outright. Caught while testing the range picker, where a cached bundle served
  the old router and rendered the wrong view for a valid URL.

### Fixed

- Pre-existing `gofmt` drift in `query/incidents.go` and `query/query_test.go`.

---

## Summary of Changes

Both items are the same shape of problem: the dashboard had a capability it
never exposed. Every endpoint took a time window and nothing sent one; the type
filter worked fine and started on the least useful setting.

Putting both in the URL hash is what makes them shareable, and is the plumbing
`todo-005` (saved views) builds on next.

**Files Modified:**

- `collector/dashboard/ui/src/range.ts` - new; presets, hash round-trip, tz offset
- `collector/dashboard/ui/src/App.tsx` - range picker, hash state for range + type
- `collector/dashboard/ui/src/views/{LiveFeed,Errors,Insights,Flows,UserTimeline,ReplayPlayer}.tsx` - window applied
- `collector/dashboard/ui/src/index.html` - range picker, chip count, filter note styles
- `collector/store/store.go` - `dayExpr`, windowed `QueryUsers`/`ListSessions`, `ExcludeTypes`, `CountsByType`
- `collector/query/window.go` - new; shared `from`/`to`/`tz` parsing
- `collector/query/counts.go` - new; `GET /v1/query/counts`
- `collector/query/{aggregates,users,sessions,events}.go` - window + tz + exclude
- `collector/server.go` - counts route
- `collector/dashboard/embed.go` - cache headers
- `collector/dashboard/embed_test.go` - new; hashed-asset detection and cache policy
- `collector/store/store_test.go` - tz bucketing, windowing, exclusion, counts

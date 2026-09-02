# Dashboard Restructure — Sections, Drill-Downs, and Entity Pages

Three backlog items that only work together (`todo-017`, `todo-018`,
`todo-019`): sections decide where things live, drill-downs make every number
lead somewhere, and entity pages give those links somewhere to land. Done
separately they half-work — a home page of dead ends, or drill-downs into views
never meant to be landed on.

### Changed

- **The navigation is grouped by job, not by storage mechanism** (`todo-017`).

  ```
  before:  Live feed | Timeline | Errors | Replay | Insights
  after:   Home | Behaviour | Sessions | Issues | Explore
  ```

  Three of the old five were the same query with different filters, presented as
  peer destinations, so a newcomer had no way to know that. Nothing was removed:
  Explore is the old live feed, kept last and plainly labelled as the escape
  hatch rather than the front door.

- **The dashboard no longer opens on a raw event stream.** It opened on the
  rawest view in the product — and on real data, ~89% network noise. An
  analytics tool is judged in its first thirty seconds and those thirty seconds
  were spent looking at HTTP requests.

- **Insights is dissolved.** Its headline numbers moved to Home; its analyses
  are Behaviour. It was six unrelated analyses on one scrolling page with no
  hierarchy and one shared Refresh button.

- **Back returns where you came from.** `Incident`'s back button hard-coded a
  jump to Errors regardless of the route in.

### Added

- **Home** — the one genuinely new page, and the only one that is not a table.
  Every tile is a finding and every finding links to what explains it:

  - active users / errors / bug reports, each against the previous equal-length
    period;
  - **flows that got slower** — p90 this window vs last, which nothing else in
    the tool surfaced and is the most useful thing a home page can say;
  - **new error types** — signatures absent from the previous window, far more
    actionable than a total;
  - recent bug reports, most-abandoned flows, and a short strip of _deliberate_
    actions.

  When nothing needs attention it says so rather than making you infer it from
  four empty lists.

- **Drill-downs, everywhere** (`todo-018`). The rule: _every aggregate leads to
  its rows, every row leads to a session, every session leads to a replay_ —
  at most three clicks from any number to watching someone hit the problem.

  Before this there was **one** cross-view link in the entire product (an error
  row opening an incident). DAU bars, top pages, top events, funnel steps and
  every cell of the flow table were inert.

  This is also the one thing a small tool can do that a large one cannot:
  PostHog samples, so an aggregate there often _cannot_ reach a recording of the
  session behind it. spyglass records every session of every identified user,
  and the UI exposed that from nowhere.

- **Entity pages** (`todo-019`) — three hand-written pages, no generic
  abstraction:

  - **Flow page** — median/p90/abandon/total with period comparison, a
    **duration histogram** (a p50 and p90 hide a bimodal split), a breakdown by
    person/day/device/role, and the **slowest sessions each one click from its
    recording**.
  - **User page** — sessions, errors, and their flow timings **against the
    overall median**, framed as a question about the software rather than a
    judgement about the person.
  - **Screen page** — views, distinct visitors, and _what broke on this screen_,
    previously unanswerable without reading URLs by hand.

- **`GET /v1/query/flow-detail`** — the slowest individual runs of a flow with
  their session ids, plus a duration histogram. The aggregate threw session ids
  away, which is why "which sessions were the slow ones" was impossible; a
  bounded, ordered, one-row-per-run query answers it without contorting the
  aggregate.

- **`screen=` on `/v1/query/events`.** A screen is a pageview's `name` and a URL
  on everything else, so matching both is what makes "errors on this screen"
  answerable.

- **`UserLink` / `FlowLink` / `ScreenLink` / `SessionLink`**, so linking is the
  default rather than something each view has to remember. They stop click
  propagation, since they often sit inside rows that are themselves controls.

### Accessibility

- **Rows that navigate are now real controls.** They were `<tr onClick>`:
  unreachable by keyboard, invisible to screen readers, no focus ring. Since the
  drill-down paths are now the product's main structure, paths only keyboard
  users cannot walk are paths that do not exist for them. A shared `rowButton`
  helper gives them the button contract — focusable, Enter/Space, announced —
  and focus is visible.

---

## Summary of Changes

The tool had genuinely good capabilities that nobody could find. The incident
view — the standout feature — was reachable from two row types on two pages.
Flow durations sat below the fold on a page called "Insights", under a funnel
builder. Someone evaluating spyglass saw an event table.

None of this adds query capability. It is routing, one new page, splitting
Insights apart, and calling the existing endpoints with what the user just
clicked. The endpoints already took `user`, `type`, `from`, `to`, `name` and
`session`; they were simply never called with any of it.

Deliberately still out of scope, and worth writing down so it stays out:
retention curves, cohort analysis, path diagrams, dashboards-of-dashboards,
feature flags, experiments, alerting-rule UI.

The initial payload is **23.3KB gzipped**, still inside the 25KB budget with
three new pages added.

**Files Modified:**

- `collector/dashboard/ui/src/App.tsx` - job-based nav, entity routes, explicit windows, real back
- `collector/dashboard/ui/src/views/Home.tsx` - new
- `collector/dashboard/ui/src/views/FlowPage.tsx`, `UserPage.tsx`, `ScreenPage.tsx` - new
- `collector/dashboard/ui/src/views/Behaviour.tsx` - replaces Insights; clickable aggregates
- `collector/dashboard/ui/src/components/EntityLink.tsx`, `rowProps.ts` - new
- `collector/dashboard/ui/src/views/{Flows,Errors,LiveFeed,Incident}.tsx` - links and keyboard-reachable rows
- `collector/dashboard/ui/src/index.html` - tiles, cards, deltas, histogram, focus rings
- `collector/store/flows.go` - `FlowSessions`, `FlowHistogram`
- `collector/store/store.go` - `Screen` filter
- `collector/query/flowdetail.go` - new endpoint
- `collector/server.go` - route
- `docs/dashboard.mdx` - rewritten around the new structure

# Saved Views and Boards

Every question you asked spyglass was thrown away when you closed the tab. The
flow table and the funnel builder both take real input — a flow name, a
grouping, a step list — and neither could be named, saved, bookmarked or put
next to another one. The tool answered questions but never accumulated: there
was no "the four numbers we check every Monday", and no way to hand somebody a
view rather than instructions for recreating it.

### Added

- **Saved views** (`todo-005`). A name attached to a parameter set:

  ```bash
  curl -X POST /v1/views -d '{
    "name": "Task creation by role",
    "kind": "flows",
    "params": { "name": "task.file", "group": "trait:role" }
  }'
  ```

  `kind` is a **closed set** — `flows`, `funnel`, `aggregates`, `events` — and
  `params` is exactly what that endpoint already accepts. That is the whole
  design constraint: **this cannot express a question the dashboard could not
  already ask.** The value here is persistence and layout, not expressiveness,
  and a query language is the thing to resist.

- **Boards** — a named, ordered set of saved views rendered on one page, with a
  **save this view** control on the flow table and the funnel builder.

- **`/v1/views` and `/v1/boards`** CRUD, and `migrations/002_views.sql`.

### Security

- **This is the only write path outside ingest**, and it sits behind the
  dashboard password like every other non-ingest route. It is deliberately
  **not reachable with an app key**: that key ships to browsers and is scoped to
  ingest, and letting it write here would widen it into a general read-write
  credential. The backlog raised host-app-writable views as a possibility —
  declined for exactly this reason.

- No new outbound calls; `collector/airgap_test.go` still green. Views are rows
  in the same SQLite file: no sync, no sharing service, nothing that phones home.

### Notes on the decisions

- **Views are global.** The collector has one shared password and no user model.
  For a 20–200 person tool that is correct, and adding a user model so somebody
  could keep a private favourite would be the tail wagging the dog. Stated in
  the docs rather than left implicit.

- **A board inherits the dashboard's time range** rather than storing its own,
  so every panel on it is comparable. A saved view that pinned dates would
  quietly answer a different question from the one beside it.

- **Deleting a view does not break a board that uses it.** The `board_views`
  rows cascade, so the board loses that panel and keeps working. Deleting a
  _board_ leaves its views alone — they are independent objects that may appear
  on several boards. Both are pinned by tests.

- Step 1 of the backlog's plan — making every panel addressable by URL — already
  shipped with the time range and drill-down work, which is why this change is
  only steps 2 and 3.

- Step 4, an embeddable host-app panel API, is deliberately **not** started. The
  pattern that works today is a host app reading the collector server-side and
  rendering with its own design system and permission model; that needs nothing
  new, and embeddable panels are a different and much larger project.

### The migration runner's first real exercise

`migrations/` had exactly one file since the project began, so the runner had
never actually run a second one. Verified before relying on it, and then in
practice: applied to a database holding **471 existing events**, both migrations
recorded, all six tables present, and every row preserved. A test opens the same
database three times — a migration that is not idempotent usually fails on the
second or third run, not the first.

---

## Summary of Changes

This is the stated product direction: a generic tracker that host apps build
their own dashboards on. The query layer was already most of the way there —
`/v1/query/flows` alone is four reports behind one parameter — and what was
missing was anywhere to _keep_ a configuration.

Verified end to end: two views saved, a board built from them, the collector
restarted, the board still intact, then one view deleted and the board still
rendering with the remaining panel.

**Files Modified:**

- `collector/store/migrations/002_views.sql` - new; views, boards, cascading join
- `collector/store/views.go`, `views_test.go` - new; CRUD, ordering, cascade behaviour
- `collector/store/store_test.go` - migration ordering and idempotency
- `collector/query/views.go`, `views_http_test.go` - new; the routes and their edge cases
- `collector/server.go` - routes behind the password gate
- `collector/dashboard/ui/src/views/Boards.tsx` - new; the index, a board, and panel rendering
- `collector/dashboard/ui/src/components/SaveView.tsx` - new
- `collector/dashboard/ui/src/views/{Flows,Behaviour}.tsx` - save controls
- `collector/dashboard/ui/src/App.tsx`, `index.html` - route and styles
- `docs/api.mdx`, `docs/dashboard.mdx`, `claude.md`

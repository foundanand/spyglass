# No way to save a question, so every session starts from scratch

> **P1** · collector + dashboard · `todo-005`

## Problem

Every question you ask spyglass is thrown away when you close the tab. The flows
panel and the funnel builder both take real input — a flow name, a grouping, a
comma-separated step list — and neither can be named, saved, bookmarked or put
next to another one.

So the tool answers questions but does not accumulate. There is no "the four
numbers we check every Monday", and no way for one person to hand another
person a view rather than instructions for recreating it.

## Why it matters

This is the stated product direction: a generic analytics tracker that host apps
build their own dashboards on. The query layer is already most of the way there —
`/v1/query/flows` takes `name` + `group=user|day|prop:<key>`, which is four
reports behind one parameter, and `/v1/query/aggregates` and `/v1/query/funnel`
are similarly parameterised. What is missing is anywhere to _keep_ a
configuration.

Note the ordering dependency: a dashboard builder is only as good as the
dimensions available to it. Today those are user, day, and whatever props the
host app happened to attach. [003](./003-device-and-environment-context.md)
should land first or this ships a builder over three axes.

## Approach

Resist building a query language. The value here is persistence and layout, not
expressiveness — the existing endpoints already answer the questions.

**Step 1 — make every view addressable.** Encode panel state in the URL hash, so
a configured flows table or funnel is a link you can paste into Slack. Zero
storage, most of the practical benefit, and it is a prerequisite for the rest.
Overlaps with [004](./004-dashboard-time-range.md); do them together.

**Step 2 — saved views.** A `views` table: `id, name, kind, params (JSON),
created_at`. `kind` is one of the existing query shapes (`flows`, `funnel`,
`aggregates`, `events`), `params` is exactly what the endpoint already accepts.
CRUD at `/v1/views`, behind the dashboard password like every other read route.
No new query capability — just a name attached to a parameter set.

**Step 3 — boards.** A named, ordered collection of saved views rendered as a
grid. Still no new query capability.

**Step 4 (only if asked for) — a host-app API.** The Parshvm integration reads
the collector server-side and renders its own panels with its own design system
and its own permission model. That pattern works and needs nothing new; a host
app that wants embeddable panels rather than raw JSON is a different and much
larger project. Do not start here.

### Constraints to hold

- **Air-gap.** Views are rows in the same SQLite file. No cloud sync, no sharing
  service, nothing that phones home. `collector/airgap_test.go` must keep passing.
- **The dashboard is embedded in the binary** via `go:embed` and served from it.
  Whatever this becomes stays a Preact SPA with no build-time backend coupling.
- **Migrations.** `collector/store/migrations/` currently has exactly one file.
  This adds the second, so the migration runner gets its first real exercise —
  worth verifying `migrate.go` handles ordering and partial application before
  relying on it.

## Acceptance

- A configured flows or funnel panel is a shareable URL that restores exactly.
- A view can be saved with a name and reopened after a collector restart.
- A board renders several saved views on one page.
- No new outbound network calls; air-gap test green.
- Deleting a view does not break a board that references it.

## Files

- `collector/store/migrations/002_views.sql` — new
- `collector/store/views.go` + test — new
- `collector/query/views.go` (or `collector/views/`) — CRUD handlers
- `collector/server.go` — routes behind the password gate
- `collector/dashboard/ui/src/App.tsx` — hash state, board routing
- `collector/dashboard/ui/src/views/Board.tsx` — new
- `docs/dashboard.mdx`, `docs/api.mdx`

## Open questions

- **Who owns a view?** The collector has one shared password and no user model.
  Views are therefore global — fine for a 20–200 person tool, and adding a user
  model to store a favourite would be the tail wagging the dog. Worth stating in
  the docs rather than leaving implicit.
- **Does a board need its own time range**, or does it inherit the global one?
  Probably inherit, with per-panel override as a later refinement.
- **Should the host app be able to write views** through the API, so Parshvm
  could ship a default board? Attractive, but it means the app key gains write
  access to something other than ingest. Think it through before allowing it.

## Effort

**Step 1: S. Step 2: M. Step 3: M.** Step 4 is a project, not a task.

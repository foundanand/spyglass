# `tasks/manifest.json` says 17 shipped features are `todo`

> **P3** · repo · `todo-012`

## Problem

`tasks/manifest.json` is described as "the source of truth for ordering and
dependencies". It has drifted badly. Seventeen tasks are marked `todo` that are
demonstrably shipped and working:

```
p3-sdk-errors               todo   ← errors.ts exists, 3 sources, deduped, tested
p3-sdk-network              todo   ← network.ts patches fetch + XHR
p3-sdk-network-bodies       todo   ← body allow-list implemented
p3-dashboard-timeline       todo   ← UserTimeline.tsx ships in the binary
p3-dashboard-errors         todo   ← Errors.tsx ships
p4-sdk-report-widget        todo   ← widget.ts, Shadow DOM, severity select
p4-sdk-report-api           todo   ← spyglass.report() exists
p4-incident-slice           todo   ← GET /v1/incidents/:id works
p4-dashboard-incident       todo   ← Incident.tsx ships
p5-funnel-query             todo   ← GET /v1/query/funnel works
p5-dashboard-aggregates     todo   ← Insights.tsx ships
p5-dashboard-auth           todo   ← dashboardAuth() gates every read route
p5-packaging                todo   ← Makefile cross-compiles; Docker image builds
p5-docs-readme              todo   ← README + docs/*.mdx exist
p5-slack-webhook            todo   ← genuinely not implemented (see todo-010)
p5-sdk-publish              todo   ← decision reversed; see todo-011
p4-sdk-autocapture          todo   ← genuinely not implemented (see todo-002)
```

Only three of those are actually outstanding — and two of them are outstanding
for reasons the manifest does not record (autocapture may be cut; publish was
deliberately abandoned for the vendoring approach).

## Why it matters

A status field that is wrong for most of its rows is worse than no status field.
Anyone — a person, or a model handed this repo — reading the manifest to decide
what to work on will conclude that error tracking and the incident view need
building, and start rebuilding shipped features.

It also devalues the three rows that are correct. `p4-sdk-autocapture: todo` is
true and important ([002](./002-autocapture-is-a-no-op.md)), and it is buried
among fourteen false ones.

## Approach

Decide what `tasks/` is _for_ now that the build it describes is largely done.

**Option A — mark it historical.** Set every shipped task to `done`, and put a
note at the top of `tasks/README.md` saying this folder records the original
build and is no longer the live backlog; that lives in `todo/`. Rows that are
genuinely outstanding get a pointer to the todo item that replaced them.

**Option B — retire it.** Delete `tasks/`, keep `todo/`, and let the changelog be
the historical record. The task briefs have served their purpose.

**A is better.** The briefs contain real design intent — `p4-sdk-autocapture`
holds the only written specification of what autocapture should do, which
[002](./002-autocapture-is-a-no-op.md) depends on. Keep them, stop pretending
they are a work queue.

While in there: `manifest.json`'s `note` field points at "the phases in
CLAUDE.md §10". Verify that reference still resolves — section numbering may have
moved.

## Acceptance

- Every row's `status` reflects reality.
- `tasks/README.md` states that the folder is historical and points at `todo/`.
- The three genuinely-outstanding rows cross-reference their todo items.
- `CLAUDE.md` mentions `todo/` as the live backlog, so a fresh session finds it.

## Files

- `tasks/manifest.json`
- `tasks/README.md`
- `tasks/*/metadata.json` — the per-task `status` fields
- `CLAUDE.md`

## Open questions

- Is anything still using the manifest programmatically? Grep before editing the
  schema.

## Effort

**XS.** Twenty minutes of bookkeeping that saves the next person a wasted day.

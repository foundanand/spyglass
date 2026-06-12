# Tasks

The build, broken into self-contained units of work — each sized so a smaller
model (or a parallel run) can pick up exactly one folder and complete it without
needing the whole picture in context.

## Layout

```
tasks/
  manifest.json            # index of every task: id, phase, deps, status
  <task-id>/
    task.md                # the brief: Problem + Your job + Acceptance
    metadata.json          # structured fields (phase, files, deps, exit check)
```

`manifest.json` is the source of truth for ordering and dependencies; each
`<task-id>/` folder is the hand-off package given to whoever (or whatever) does
the work.

## Per-task conventions

**`task.md`** — written in plain-brief voice, no solution code:

1. **Problem** — what's missing and why it matters.
2. **Your job** — the concrete deliverable, scoped to this task only.
3. **Acceptance** — how we know it's done (the phase's exit check, a passing
   test, a manual verification step).

**`metadata.json`** — machine-readable fields, e.g.:

```json
{
  "id": "p1-collector-events-endpoint",
  "phase": 1,
  "component": "collector",
  "depends_on": ["p1-collector-schema"],
  "src_files": ["collector/ingest/events.go"],
  "exit_check": "POST /v1/events inserts a batch in one transaction; table-driven test green",
  "status": "todo"
}
```

`status`: `todo` | `in_progress` | `done` | `blocked`.

Keep tasks small (1–3 files, one clear exit check) so they parallelize and so a
failure is cheap to retry.

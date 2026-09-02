# Tasks — historical

> **This folder is not a work queue.** It records the _original_ build
> breakdown. The live backlog is [`todo/`](../todo/) — start there.

The build, broken into self-contained units of work — each sized so a smaller
model (or a parallel run) could pick up exactly one folder and complete it
without needing the whole picture in context.

The briefs are kept because they hold the design intent behind what was built.
The statuses were wrong for a long time: seventeen tasks sat at `todo` for
features that had demonstrably shipped, which is worse than having no status
field at all — anyone reading it to decide what to work on would have concluded
that error tracking and the incident view needed building, and started
rebuilding them.

They now reflect reality. Every task is `done` except two, which are `wontfix`
and say why in a `resolution` field:

| Task                 | Resolution                                                             |
| -------------------- | ---------------------------------------------------------------------- |
| `p4-sdk-autocapture` | Cut, not deferred — replay already captures interactions visually.     |
| `p5-sdk-publish`     | Reversed — the SDK is not on npm; distribution is `scripts/vendor.sh`. |

Nothing reads `manifest.json` programmatically; it is documentation.

## Layout

```
tasks/
  manifest.json            # index of every task: id, phase, deps, status
  <task-id>/
    task.md                # the brief: Problem + Your job + Acceptance
    metadata.json          # structured fields (phase, files, deps, exit check)
```

`manifest.json` indexed ordering and dependencies while the build was running;
each `<task-id>/` folder was the hand-off package. Both are now a record of how
the thing was built, not instructions for building it.

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

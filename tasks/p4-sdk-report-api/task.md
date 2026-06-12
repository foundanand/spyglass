# spyglass.report() programmatic

> Phase 4 · sdk · `p4-sdk-report-api`
> Reference: CLAUDE.md §5

## Problem

Apps need a programmatic way to file a bug report (no widget UI).

## Your job

Implement `spyglass.report(comment, opts?)` emitting the same `bug_report` event shape as the widget. Shared code path with the widget.

## Acceptance

report('it broke') enqueues a bug_report event with the comment. Unit test asserts payload.

## Dependencies

`p1-sdk-capture`

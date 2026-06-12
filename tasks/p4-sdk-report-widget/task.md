# Bug-report widget (Shadow DOM)

> Phase 4 · sdk · `p4-sdk-report-widget`
> Reference: CLAUDE.md §5

## Problem

A floating bug-report button lets users file a report that becomes a `bug_report` event — rendered in Shadow DOM so host styles don't leak in or out.

## Your job

Implement the widget (enabled by `reportWidget: true`): floating button, comment box (optional severity), emits a `bug_report` event with `{comment, severity?}` (§4). All UI in a Shadow DOM root.

## Acceptance

Button appears when enabled; submitting emits a bug_report event. No style bleed either direction. Manual check in example app.

## Dependencies

`p1-sdk-capture`

# Optional Slack webhook on bug_report

> Phase 5 · collector · `p5-slack-webhook`
> Reference: CLAUDE.md §13.4

## Problem

Cheap win: notify Slack when a new bug_report arrives, linking straight to its incident page. Off unless configured.

## Your job

Add an optional `slack_webhook` config key; on a new `bug_report` event, POST a message with a link to `/v1/incidents/:id` (or the dashboard incident URL). No-op when unset. This is the only outbound call and must be explicitly opt-in (§8 no phone-home applies to telemetry, not operator-configured webhooks).

## Acceptance

With a webhook set, filing a report posts a Slack message linking the incident. Unset → no outbound calls. Table-driven test with a stub server.

## Dependencies

`p4-incident-slice`

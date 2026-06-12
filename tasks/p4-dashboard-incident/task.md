# Incident view (the killer page)

> Phase 4 · dashboard · `p4-dashboard-incident`
> Reference: CLAUDE.md §7.4

## Problem

Phase 4 exit: from a report/error, open an incident page with replay auto-cued, breadcrumbs, network waterfall, console, and the stack/comment on top.

## Your job

Build the Incident view from `/v1/incidents/:id`: replay clip auto-cued to the moment, breadcrumb timeline, network waterfall, console output, and the comment/stack header. This is the Phase 4 exit (§10).

## Acceptance

Click the report widget → open its incident → replay is cued to the exact moment with breadcrumbs/network/console alongside. **Phase 4 done.**

## Dependencies

`p2-dashboard-player`, `p4-incident-slice`, `p3-dashboard-errors`

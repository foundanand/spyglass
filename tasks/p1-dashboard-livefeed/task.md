# Live feed view + filters

> Phase 1 · dashboard · `p1-dashboard-livefeed`
> Reference: CLAUDE.md §7.1

## Problem

The Phase 1 exit: see events from the example app land in the dashboard, filterable.

## Your job

Build the Live Feed view: poll `GET /v1/query/events`, render a scrolling event stream, and provide user/type/app filters. This is the Phase 1 exit criterion (§10).

## Acceptance

Run collector + nextjs-demo with the SDK; `capture()` calls appear in the live feed within seconds. Filters narrow the stream. **Phase 1 done.**

## Dependencies

`p1-dashboard-shell`, `p1-query-events`

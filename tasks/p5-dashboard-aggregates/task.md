# Aggregates view (DAU, top events/pages, errors)

> Phase 5 · dashboard · `p5-dashboard-aggregates`
> Reference: CLAUDE.md §7.5

## Problem

Simple aggregates: DAU, top events, top pages, error counts by day — plain SQL GROUP BY.

## Your job

Add aggregate query endpoints (GROUP BY) and a dashboard view rendering DAU, top events, top pages, and daily error counts. No analytics engine, just SQL.

## Acceptance

Aggregates render from real data and match hand-run SQL. Endpoints table-driven tested.

## Dependencies

`p1-dashboard-shell`, `p1-query-events`

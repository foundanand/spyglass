# GET /v1/query/events + /v1/query/users

> Phase 1 · collector · `p1-query-events`
> Reference: CLAUDE.md §6

## Problem

The dashboard needs to read events back: a filtered event stream and an active-users summary.

## Your job

Implement `GET /v1/query/events?user=&type=&from=&to=` (parameterized SQL using the indexes, sane default limit + ordering) and `GET /v1/query/users` (distinct users, last_seen, session counts). Return JSON. Table-driven test for filter combinations.

## Acceptance

Filters compose correctly and hit the indexes. Users endpoint returns last_seen + session count. Test covers user filter, type filter, time range.

## Dependencies

`p1-store-open`

# User timeline view

> Phase 3 · dashboard · `p3-dashboard-timeline`
> Reference: CLAUDE.md §7.2

## Problem

Operators need a per-user chronological view: sessions and the breadcrumb trail within each.

## Your job

Build the User Timeline view: pick a user (from /v1/query/users), list their sessions, and render chronological breadcrumbs (pageviews, captures, network, errors) per session.

## Acceptance

Selecting a user shows their sessions and ordered breadcrumbs across event types. Manual check against seeded data.

## Dependencies

`p1-dashboard-shell`, `p1-query-events`

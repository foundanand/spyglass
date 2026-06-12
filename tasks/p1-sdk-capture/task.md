# capture(), pageview(), setUser()

> Phase 1 · sdk · `p1-sdk-capture`
> Reference: CLAUDE.md §5

## Problem

The public verbs that produce events: `capture(name, props)`, automatic pageviews, and late `setUser()`.

## Your job

Implement `capture(name, props?)` → enqueue an `event`-typed record (with ts, app, user_id, session_id, url). Implement `pageview(url)` → `pageview`-typed record. Implement `setUser()` for late identification, updating subsequent events. All shaped to the §4 event schema.

## Acceptance

capture enqueues a well-formed event. pageview enqueues type `pageview`. setUser changes user_id on later events. Unit test asserts payload shape.

## Dependencies

`p1-sdk-queue`, `p1-sdk-session`

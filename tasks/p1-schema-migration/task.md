# SQLite schema v1 + migration runner

> Phase 1 · collector · `p1-schema-migration`
> Reference: CLAUDE.md §4, §12

## Problem

We need the v1 schema (events, sessions, indexes) created on first boot, via numbered migration files that are applied in order and never edited once shipped.

## Your job

Write `001_init.sql` with the exact `events` and `sessions` tables + the three indexes from §4. Implement a migration runner that tracks applied versions in a `schema_migrations` table and applies pending files in order on boot. Embed migrations via Go `embed`.

## Acceptance

Fresh DB → both tables + 3 indexes exist. Re-running boot applies nothing new (idempotent). Schema matches §4 exactly.

## Dependencies

`p0-collector-skeleton`

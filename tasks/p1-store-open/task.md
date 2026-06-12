# Store: open WAL DB + prepared inserts

> Phase 1 · collector · `p1-store-open`
> Reference: CLAUDE.md §3, §4

## Problem

Handlers need a store abstraction: open the DB in WAL mode, run migrations, and provide a single-transaction batch insert for events plus a session upsert.

## Your job

Implement `store.Open(dataDir)` → enable WAL, busy_timeout, run migrations. Expose `InsertEvents(batch)` doing one transaction with a prepared statement, and `UpsertSession(...)` updating `last_seen`/`started_at`. Keep it driver-agnostic over `modernc.org/sqlite`.

## Acceptance

DB opens in WAL. `InsertEvents` writes a batch atomically (rollback on error). Session upsert updates last_seen. Unit test inserts and reads back.

## Dependencies

`p1-schema-migration`

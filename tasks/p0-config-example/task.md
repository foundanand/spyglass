# spyglass.config.example.json

> Phase 0 · repo · `p0-config-example`
> Reference: CLAUDE.md §6

## Problem

Operators need a copy-paste starting config, and the collector's loader (Phase 1) needs a reference shape to validate against.

## Your job

Create `spyglass.config.example.json` with `listen`, `dataDir`, `apps` (one example app with a `key`), `retention` (replays_days 21, events_days 0), and `auth.dashboard_password` using the `env:SPYGLASS_PASS` form. Keys must justify themselves against the dynamoip test (§1) — no speculative config.

## Acceptance

File parses as JSON and mirrors §6. No config keys beyond those in §6.

## Dependencies

None

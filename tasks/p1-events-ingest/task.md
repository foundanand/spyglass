# POST /v1/events (auth, CORS, limits)

> Phase 1 · collector · `p1-events-ingest`
> Reference: CLAUDE.md §6, ingest-exposure (internet-exposed)

## Problem

The ingest endpoint is internet-exposed, so it must validate the app key, enforce a CORS origin allowlist, cap payload size, and rate-limit — while inserting a batch in a single transaction.

## Your job

Implement `POST /v1/events`: parse a batched JSON body, validate the app key against config (the browser key is a public filter, not a secret), enforce CORS against the app's allowed origins, cap body size, and apply a simple per-app/IP rate limit. On success, single-transaction insert + session upsert. Table-driven test: happy path, bad key, oversize body, bad origin.

## Acceptance

Valid batch → rows inserted, 2xx. Bad/missing key → 401/403. Oversize → 413. Disallowed origin → CORS rejected. Test covers all four.

## Dependencies

`p1-store-open`, `p1-config-loader`

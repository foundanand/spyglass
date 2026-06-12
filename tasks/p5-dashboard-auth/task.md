# Dashboard shared-password auth

> Phase 5 · collector · `p5-dashboard-auth`
> Reference: CLAUDE.md §6, §13.2

## Problem

The dashboard and query endpoints must sit behind the single shared password from config (v1 decision, §13.2).

## Your job

Implement shared-password auth: a login that sets a signed cookie/session, gating `GET /` and `/v1/query/*` and `/v1/incidents/*` and `/v1/sessions/*`. Ingest routes stay key-gated, not password-gated. Password from `auth.dashboard_password` (env-resolved).

## Acceptance

Unauthenticated dashboard/query access is rejected; correct password grants access. Ingest unaffected. Table-driven test.

## Dependencies

`p1-http-server`, `p1-dashboard-shell`

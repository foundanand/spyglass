# GET /v1/incidents/:event_id (slice assembly)

> Phase 4 · collector · `p4-incident-slice`
> Reference: CLAUDE.md §6, §7.4

## Problem

The killer feature: for any error/bug_report event, assemble the surrounding slice from the same session as a single query.

## Your job

Implement `GET /v1/incidents/:event_id`: look up the event, compute the `[ts−60s, ts+10s]` window, and return the breadcrumb events, the network events, the replay chunk(s) + seek offset covering the moment, and the comment/stack — all scoped to the same `session_id` (§7.4).

## Acceptance

Given an error event id, the response contains the windowed events, network rows, replay cue (chunk+offset), and the stack/comment. Table-driven test.

## Dependencies

`p1-query-events`, `p2-replay-manifest`

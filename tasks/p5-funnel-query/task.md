# GET /v1/query/funnel

> Phase 5 · collector · `p5-funnel-query`
> Reference: CLAUDE.md §6, §7.5

## Problem

A simple step funnel over events, computed in SQL — good enough, no analytics engine.

## Your job

Implement `GET /v1/query/funnel?steps=a,b,c`: count users progressing through the named events in order within a window, using SQL. Return per-step counts.

## Acceptance

Funnel returns monotonic per-step counts for ordered events. Table-driven test with a seeded sequence.

## Dependencies

`p1-store-open`

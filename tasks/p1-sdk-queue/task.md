# Event queue + batching + transport

> Phase 1 · sdk · `p1-sdk-queue`
> Reference: CLAUDE.md §5

## Problem

Events must be batched in memory and flushed efficiently, not sent one-by-one.

## Your job

Implement an in-memory queue that flushes on 20 events or every 5s, whichever first, POSTing the batch (with app key) to `endpoint + /v1/events`. Retry/backoff is minimal; on failure keep events for the next flush. Transport is a thin fetch wrapper.

## Acceptance

20 enqueues → immediate flush. Time-based flush at 5s. Batch hits the right URL with the app key. Unit test with mocked fetch + clock.

## Dependencies

`p1-sdk-init`

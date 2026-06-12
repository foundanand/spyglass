# Replay upload + backpressure

> Phase 2 · sdk · `p2-sdk-replay-upload`
> Reference: CLAUDE.md §5

## Problem

Chunks upload to the collector, and under pressure replay must be dropped before events (events are the priority).

## Your job

POST each gzipped chunk to `/v1/replay?session=&seq=`. Implement backpressure: bounded in-flight/queued chunks; when exceeded, drop oldest replay chunks (never events). Use sendBeacon/keepalive on unload for the last chunk.

## Acceptance

Chunks arrive in order with correct session+seq. Simulated backpressure drops replay, not events. Manual + unit check.

## Dependencies

`p2-sdk-chunk-gzip`, `p1-sdk-queue`

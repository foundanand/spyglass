# Daily retention sweep

> Phase 2 · collector · `p2-retention-sweep`
> Reference: CLAUDE.md §6, §8

## Problem

Replays must auto-expire (default 21 days) to bound disk; events default to forever.

## Your job

Implement an in-process daily sweep: delete replay dirs (and their sessions' chunk references) older than `retention.replays_days`; honor `events_days` (0 = keep). Run on a ticker, with a run-on-boot. Log what was removed (no silent truncation).

## Acceptance

Replay dirs older than the window are deleted; newer kept. events_days=0 deletes no events. Sweep logs counts. Unit test with injected clock + temp dir.

## Dependencies

`p2-replay-disk-layout`

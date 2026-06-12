# Replay disk layout + meta.json seek index

> Phase 2 · collector · `p2-replay-disk-layout`
> Reference: CLAUDE.md §4

## Problem

Seeking needs a per-session `meta.json` mapping chunk seq → start timestamp, maintained as chunks arrive.

## Your job

Implement the replay-dir helper: ensure `replays/{session}/`, append/update `meta.json` (first-chunk timestamp index per §4) as chunks are written, and provide lookups used by the manifest endpoint.

## Acceptance

meta.json lists each chunk with its start ts in order. Survives restarts (rebuilds/extends from disk). Unit test.

## Dependencies

`p2-replay-ingest`

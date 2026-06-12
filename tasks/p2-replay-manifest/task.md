# GET /v1/sessions/:id/replay (manifest + stream)

> Phase 2 · collector · `p2-replay-manifest`
> Reference: CLAUDE.md §6, §7.3

## Problem

The player needs a manifest (chunks + timestamps) and a way to fetch each chunk.

## Your job

Implement `GET /v1/sessions/:id/replay` returning the manifest from meta.json, plus chunk streaming (e.g. `?seq=` or a sub-route) that serves the gzipped blob with correct headers. Stream, don't buffer whole sessions.

## Acceptance

Manifest lists chunks + start timestamps. Each chunk fetch returns the gzipped bytes. Table-driven test.

## Dependencies

`p2-replay-disk-layout`

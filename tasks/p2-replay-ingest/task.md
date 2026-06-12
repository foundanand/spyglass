# POST /v1/replay → disk

> Phase 2 · collector · `p2-replay-ingest`
> Reference: CLAUDE.md §4, §6

## Problem

The collector must accept gzipped replay chunks and persist them to disk (never into SQLite), bumping the session's chunk count.

## Your job

Implement `POST /v1/replay?session=&seq=`: validate app key/origin/size, write the raw gzipped body to the session's replay dir as `{seq}.json.gz`, and increment `sessions.chunk_count`. Reject duplicate/out-of-range seq sanely.

## Acceptance

Chunk lands at `replays/{session}/{seq}.json.gz`. chunk_count increments. Bad key/oversize rejected. Table-driven test.

## Dependencies

`p1-store-open`

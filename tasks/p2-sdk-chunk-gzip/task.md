# ~10s chunking + CompressionStream gzip

> Phase 2 · sdk · `p2-sdk-chunk-gzip`
> Reference: CLAUDE.md §4, §5

## Problem

rrweb output must be sliced into ~10s chunks and gzipped client-side before upload.

## Your job

Buffer rrweb events, cut a chunk every ~10s, gzip with native `CompressionStream`, and hand the blob + sequence number to the uploader. Track first-event timestamp per chunk for the seek index.

## Acceptance

Chunks emitted ~every 10s, gzipped, sequence-numbered, with a start timestamp. Unit test feeds synthetic events and asserts chunk boundaries.

## Dependencies

`p2-sdk-rrweb`

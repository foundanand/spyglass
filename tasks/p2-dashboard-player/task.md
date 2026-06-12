# rrweb-player view + console pane

> Phase 2 · dashboard · `p2-dashboard-player`
> Reference: CLAUDE.md §7.3

## Problem

Phase 2 exit: watch a full session replay with console logs, seekable by timestamp.

## Your job

Integrate rrweb-player in a Replay view: fetch the manifest, stream chunks, support seek-by-timestamp, and show a console pane (logs come from the rrweb stream). This is the Phase 2 exit (§10).

## Acceptance

Pick a session → watch it play, seek around, see console output alongside. **Phase 2 done.**

## Dependencies

`p1-dashboard-shell`, `p2-replay-manifest`

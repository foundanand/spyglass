# rrweb record + console plugin (lazy)

> Phase 2 · sdk · `p2-sdk-rrweb`
> Reference: CLAUDE.md §5, §3

## Problem

Replay must add zero bytes when off and lazy-load rrweb (plus the official console-record plugin) only when `replay: true`.

## Your job

Add rrweb as the sole runtime dep. Implement a lazily-imported recorder that starts rrweb `record()` with the console plugin and respects `maskInputs`. Console logs travel inside the rrweb stream (no separate pipeline).

## Acceptance

replay:false ships no rrweb bytes (separate chunk). replay:true records events incl. console. maskInputs honored. Manual check via example app.

## Dependencies

`p1-sdk-init`

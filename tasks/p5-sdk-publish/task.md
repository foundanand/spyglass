# Publish @spyglass/sdk + size budget gate

> Phase 5 · sdk · `p5-sdk-publish`
> Reference: CLAUDE.md §5, §12

## Problem

Ship the SDK to npm with a hard size budget: ≤5KB gz core, rrweb only loaded when replay:true.

## Your job

Finalize `package.json` (files, exports, sideEffects for tree-shaking), add a `size-check.mjs` that fails CI if the core exceeds 5KB gz, and document the publish flow. Confirm rrweb/autocapture are separate lazy chunks.

## Acceptance

Size check passes at ≤5KB gz core. `npm publish --dry-run` is clean. rrweb absent from the core chunk.

## Dependencies

`p1-sdk-capture`, `p2-sdk-replay-upload`, `p3-sdk-network`, `p4-sdk-report-widget`

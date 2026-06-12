# sendBeacon on tab close

> Phase 1 · sdk · `p1-sdk-beacon`
> Reference: CLAUDE.md §5

## Problem

Tab-close events are lost if we rely on fetch during unload. sendBeacon survives it.

## Your job

On `visibilitychange` (hidden) and `pagehide`, flush the pending queue with `navigator.sendBeacon` (falling back to keepalive fetch). Ensure no double-send with the timer flush.

## Acceptance

Hiding/closing the tab flushes remaining events via sendBeacon. No duplicate delivery. Unit test stubs sendBeacon.

## Dependencies

`p1-sdk-queue`

# Session id + 30min idle reset

> Phase 1 · sdk · `p1-sdk-session`
> Reference: CLAUDE.md §5

## Problem

Events need a session id that persists within a tab session and rolls over after 30 minutes of inactivity.

## Your job

Implement session management: random id stored in `sessionStorage`, last-activity timestamp, and a new id minted when the gap exceeds 30min. Expose `currentSessionId()`. Make time injectable for tests.

## Acceptance

Same id within a session. After >30min idle, next call mints a new id. Unit test with faked clock.

## Dependencies

`p1-sdk-init`

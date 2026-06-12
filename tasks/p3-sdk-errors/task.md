# Error handlers + dedup

> Phase 3 · sdk · `p3-sdk-errors`
> Reference: CLAUDE.md §5

## Problem

Uncaught errors, promise rejections, and console.error calls should become `error` events with stack info, without flooding on repeats.

## Your job

Hook `window.onerror`, `unhandledrejection`, and patch `console.error`. Emit `error`-typed events carrying `{stack, source, line, col}` (§4). Dedup identical errors within a 5s window. Don't swallow the original handlers.

## Acceptance

A thrown error and a rejected promise each produce one error event with a stack. Repeated identical errors within 5s collapse to one. Unit test.

## Dependencies

`p1-sdk-capture`

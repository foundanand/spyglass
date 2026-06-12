# Error list + network rows

> Phase 3 · dashboard · `p3-dashboard-errors`
> Reference: CLAUDE.md §7.2

## Problem

Phase 3 exit: errors are visible with stacks and linked to the session, and network rows show in the timeline.

## Your job

Build an error list (grouped, with stack + count) and surface network rows inside the user timeline. Link each error to its session/timeline. This is the Phase 3 exit (§10).

## Acceptance

Throwing in nextjs-demo surfaces an error with stack, linked to the session. Network rows visible in the timeline. **Phase 3 done.**

## Dependencies

`p3-dashboard-timeline`

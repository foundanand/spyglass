# examples/nextjs-demo skeleton

> Phase 0 · example · `p0-example-app`
> Reference: CLAUDE.md §11

## Problem

We need a throwaway app to exercise the SDK end-to-end during every phase. It must consume the local workspace SDK, not a published one.

## Your job

Scaffold a minimal Next.js (app-router) app under `examples/nextjs-demo` that depends on `@spyglass/sdk` via `workspace:*`. One page with a couple of buttons (to wire `capture()` later). No SDK calls yet — just the import resolving.

## Acceptance

`pnpm --filter nextjs-demo dev` boots. `import { spyglass } from '@spyglass/sdk'` resolves to the local package.

## Dependencies

`p0-monorepo`, `p0-sdk-skeleton`

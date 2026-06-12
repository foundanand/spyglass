# @spyglass/sdk package + esbuild + vitest

> Phase 0 · sdk · `p0-sdk-skeleton`
> Reference: CLAUDE.md §5, §12

## Problem

The SDK package doesn't exist. We need the `@spyglass/sdk` package wired for TS strict, an esbuild bundle (ESM, with the core kept small), and vitest — before writing any SDK logic.

## Your job

Create `sdk/package.json` (name `@spyglass/sdk`, type module, exports map), `tsconfig.json` extending `../tsconfig.base.json`, an esbuild `build.mjs` that bundles `src/index.ts` to `dist/` (ESM + minified, code-splitting enabled so rrweb/autocapture can be lazy chunks), `vitest.config.ts`, and a stub `src/index.ts` exporting an empty `spyglass` object. rrweb is the ONLY runtime dep (added later, in Phase 2).

## Acceptance

`pnpm --filter @spyglass/sdk build` produces a bundle. `pnpm --filter @spyglass/sdk test` runs (zero tests OK). tsconfig is strict.

## Dependencies

`p0-monorepo`

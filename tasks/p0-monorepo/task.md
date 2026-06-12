# pnpm workspace + repo foundation

> Phase 0 · repo · `p0-monorepo`
> Reference: CLAUDE.md §11, §12

## Problem

The repo has no toolchain. Before any code, we need the pnpm workspace that ties the npm side (sdk + example app) together, plus shared TS/format config. The Go collector is a standalone module and is NOT a workspace package.

## Your job

Create the root `package.json` (private, name `spyglass`, packageManager pnpm), `pnpm-workspace.yaml` listing `sdk` and `examples/*`, a `.gitignore` (node_modules, data/, dist/, *.db, .source, Go build artifacts), a `tsconfig.base.json` with `strict: true` for the SDK to extend, and a shared prettier config. `git init` the repo.

## Acceptance

`pnpm install` runs clean at root. `tsconfig.base.json` has `strict: true`. `.gitignore` covers `data/`, `dist/`, `node_modules/`, `*.db`.

## Dependencies

None

# Preact dashboard shell + Go embed

> Phase 1 · dashboard · `p1-dashboard-shell`
> Reference: CLAUDE.md §3, §7

## Problem

The dashboard is a Preact SPA embedded in the binary. We need its build (esbuild) and the Go `embed` that serves it at `/`.

## Your job

Set up a Preact + esbuild app under `collector/dashboard/ui` (built to a `dist/` that Go embeds). Implement `embed.go` serving the static assets at `GET /`. App router/shell with a nav placeholder for the views. No data views yet.

## Acceptance

Build produces static assets; `GET /` serves the SPA shell. Binary is self-contained (no external files). Manual load in browser.

## Dependencies

`p0-collector-skeleton`, `p0-monorepo`

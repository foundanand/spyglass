# Packaging: cross-compile + npx wrapper + Docker

> Phase 5 · collector · `p5-packaging`
> Reference: CLAUDE.md §3, §10

## Problem

Releasable single-binary story: cross-compiled static binaries, an easy install (npx wrapper or install script), and a Docker example.

## Your job

Add cross-compile targets (darwin/linux, amd64/arm64) producing static binaries. Provide an `npx spyglassd` wrapper or `install.sh`. Write a minimal Dockerfile example. Verify ~15–25MB RAM / single-file ops story holds.

## Acceptance

Binaries cross-compile for all four targets. One-command install works. Docker example runs the collector. Manual verification.

## Dependencies

`p1-http-server`

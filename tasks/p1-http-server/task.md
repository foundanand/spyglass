# HTTP server + /v1 router + shutdown

> Phase 1 · collector · `p1-http-server`
> Reference: CLAUDE.md §6

## Problem

Routes exist but nothing wires them. We need the HTTP server: mount /v1 handlers, listen on the configured address, and shut down gracefully.

## Your job

Wire a router mounting the ingest + query handlers (and a placeholder for `GET /`). Listen on `config.listen`. Handle SIGINT/SIGTERM with graceful shutdown that flushes/closes the store. Update `main.go` to load config → open store → run server.

## Acceptance

`spyglassd --config example` boots and serves the /v1 routes. Ctrl-C shuts down cleanly without dropping in-flight inserts.

## Dependencies

`p1-config-loader`

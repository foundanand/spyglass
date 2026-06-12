# Go module skeleton (spyglassd)

> Phase 0 · collector · `p0-collector-skeleton`
> Reference: CLAUDE.md §3, §6, §11

## Problem

There is no Go module. The collector needs its package layout (ingest/store/query/dashboard) and an entrypoint that reads `--config` before any real handlers exist.

## Your job

Run `go mod init` for the collector module. Add `modernc.org/sqlite` as a dependency (pure-Go, no CGo). Create `main.go` that parses a `--config` flag, prints a startup banner, and exits cleanly. Create empty `ingest/`, `store/`, `query/`, `dashboard/` packages with a doc comment each. Keep total Go deps ≤5 (§12).

## Acceptance

`go build ./...` and `go vet ./...` pass. `spyglassd --config foo.json` parses the flag (may stub the actual load). Only `modernc.org/sqlite` added so far.

## Dependencies

None

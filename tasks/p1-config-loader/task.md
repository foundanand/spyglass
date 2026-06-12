# Config loading + validation

> Phase 1 · collector · `p1-config-loader`
> Reference: CLAUDE.md §6

## Problem

The collector must read its single config file at boot, resolve `env:VAR` references (e.g. dashboard password), and fail fast on missing/invalid fields.

## Your job

Implement config struct + loader: parse the JSON, resolve any `env:NAME` string into the env var's value, validate `listen`, `dataDir`, at least one app with a non-empty `key`, and retention numbers. Return clear errors. Table-driven test covering valid config, missing app key, bad env ref.

## Acceptance

Loading the example config succeeds. Missing `apps` or empty `key` errors. `env:` resolution works. Table-driven test passes.

## Dependencies

`p0-collector-skeleton`, `p0-config-example`

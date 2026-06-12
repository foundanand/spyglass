# spyglass.init() + config + types

> Phase 1 · sdk · `p1-sdk-init`
> Reference: CLAUDE.md §5

## Problem

Everything hangs off `spyglass.init(config)`. We need the typed config surface and the singleton that holds endpoint/app/user/flags.

## Your job

Define the `init` config type exactly per §5 (endpoint, app, user, replay, autocapture, network, maskInputs, reportWidget — with the documented defaults). Implement `init()` to validate required fields (endpoint, app, user.id) and store a module singleton. No transport yet.

## Acceptance

init() with valid config sets state; missing endpoint/app/user.id throws. Defaults applied (replay true, autocapture false, network true). Unit test.

## Dependencies

`p0-sdk-skeleton`

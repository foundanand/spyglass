# Opt-in autocapture (click + change)

> Phase 4 · sdk · `p4-sdk-autocapture`
> Reference: CLAUDE.md §2, §5

## Problem

Autocapture exists but is strictly opt-in and must ship zero bytes when disabled (§2).

## Your job

Implement a lazily-imported autocapture module: when `autocapture: true`, delegate-listen on `click` (selector, trimmed innerText, x/y) and `change` on form controls (field name only, never values unless explicitly unmasked). No bytes loaded when off.

## Acceptance

autocapture:false → module not in the bundle path. autocapture:true → clicks + form changes captured, no field values. Manual + unit check.

## Dependencies

`p1-sdk-capture`

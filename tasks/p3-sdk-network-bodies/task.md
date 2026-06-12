# Opt-in body capture (allow-list)

> Phase 3 · sdk · `p3-sdk-network-bodies`
> Reference: CLAUDE.md §5, §8

## Problem

Request/response bodies are sensitive: capture them only when explicitly allow-listed per route prefix, and truncate.

## Your job

Extend the network patch: when `network: { bodies: ["/api/"] }` matches the URL prefix, attach a `body_excerpt` truncated to 2KB. Default off. Never for non-matching routes.

## Acceptance

Matching route → truncated body_excerpt present. Non-matching → no body. Truncation at 2KB. Unit test for match + truncation.

## Dependencies

`p3-sdk-network`

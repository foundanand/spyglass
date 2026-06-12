# fetch + XHR interception (metadata)

> Phase 3 · sdk · `p3-sdk-network`
> Reference: CLAUDE.md §5, §8

## Problem

Network calls should be recorded as `network` events with method, URL, status, duration, and sizes — never auth headers.

## Your job

Patch `fetch` and `XMLHttpRequest` to time requests and emit `network` events with `{method, status, duration_ms, req_size, res_size}` (§4). Never capture `Authorization`/`Cookie` headers. Don't alter request behavior.

## Acceptance

A fetch and an XHR each yield a network event with timing/status/sizes. Auth/Cookie headers absent. Passthrough behavior unchanged. Unit test.

## Dependencies

`p1-sdk-capture`

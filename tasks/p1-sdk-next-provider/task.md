# <SpyglassProvider> app-router pageviews

> Phase 1 · sdk · `p1-sdk-next-provider`
> Reference: CLAUDE.md §5

## Problem

Next.js app-router apps should get pageviews for free; plain JS apps must still work without this helper.

## Your job

Implement `<SpyglassProvider config={...}>` that calls `init()` on mount and fires a `pageview` whenever `usePathname()`/`useSearchParams()` change. Keep it an optional subpath export so non-Next apps don't pull React.

## Acceptance

Mounting the provider in nextjs-demo fires pageviews on navigation. Importing core SDK without the provider pulls no React. Manual check in example app.

## Dependencies

`p1-sdk-capture`

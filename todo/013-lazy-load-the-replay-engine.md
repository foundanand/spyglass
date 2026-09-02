# rrweb is 81% of the dashboard payload and loads on every page

> **P1** · dashboard · `todo-013`

## Problem

The dashboard bundle is 320KB raw / **100.7KB gzipped**, and rrweb is almost all
of it. From `esbuild --analyze`:

```
node_modules/rrweb/dist/rrweb.js ──── 253.1kb ── 80.9%
  └ src/views/replaySurface.ts
     └ src/views/Incident.tsx
```

It is imported statically (`replaySurface.ts:1`, `import { Replayer } from
"rrweb"`), so it is in the single `app.js` entry chunk. Every visit to the live
feed, the timeline, the error list or insights downloads and parses the entire
replay engine, for a view the user may never open.

Measured, same source, rrweb excluded:

|                                | raw     | gzipped     |
| ------------------------------ | ------- | ----------- |
| Current `app.js`               | 320,136 | **100,661** |
| App code only (rrweb external) | 60,038  | **19,312**  |

**81KB of the 100KB gzipped payload is a feature behind one of five tabs.**

The SDK already solves exactly this problem for itself — `sdk/src/index.ts` does
`void import("./replay.js")` so rrweb becomes a lazy chunk and the core stays
~1.7KB gz. The dashboard never got the same treatment.

## Why it matters

This is the project's own stated value. The README leads with "~5KB gzipped SDK.
rrweb loads lazily, only when replay is on" and "~21MB Docker image" — the
dashboard quietly undoes that on the read side. A 100KB dashboard is not
disqualifying, but a 19KB one is _conspicuously_ light, and that is the pitch.

It matters most where it is least convenient: an operator checking errors over a
phone tether, or an air-gapped box on slow internal networking, pays the full
replay engine to read a table.

The app code itself is genuinely small — 19KB gz for Preact plus every view,
component and chart. That part needs no work. rrweb is the whole problem, and it
is one build flag and two import statements away from being fixed.

## Approach

Split it, exactly as the SDK does.

1. `build.mjs`: add `splitting: true`. The config already has `format: "esm"` and
   `outdir`, which are the only prerequisites, and `index.html` already loads the
   entry with `<script type="module">` — so nothing else in the loading path
   changes.
2. Convert `replaySurface.ts`'s rrweb import to a dynamic `import("rrweb")`
   inside the surface factory, or lazily import `replaySurface` itself from
   `ReplayPlayer.tsx` and `Incident.tsx`. The second is simpler and moves the
   rrweb CSS with it.
3. Show a loading state while the chunk arrives. `SkeletonRows` already exists;
   the player has a natural place for it since it already waits on the chunk
   manifest.

**No Go change is needed.** `dashboard/embed.go` serves any file by name out of
`ui/dist` and derives the content type from the extension, so emitted chunks are
served correctly with no route work. Worth changing `//go:embed ui/dist` to
`//go:embed all:ui/dist` while in there — the default form silently skips files
beginning with `_` or `.`, which is a trap waiting for a future bundler naming
change.

Consider prefetching the replay chunk on hover over the Replay tab, so the
common path stays instant. Optional, and only after the split lands.

## Acceptance

- Initial `app.js` is under 25KB gzipped.
- Opening Live feed, Timeline, Errors or Insights never requests the rrweb chunk
  — verify in the network panel, not by reasoning about it.
- Opening Replay or an Incident loads it once and the player works exactly as
  before, including the idle-skip timeline and event markers.
- The chunk is served correctly from the embedded binary (`make build` then run
  it — not just the dev server).
- A size assertion in CI, so this cannot silently regress. The SDK has a size
  budget; the dashboard has none.

## Files

- `collector/dashboard/ui/build.mjs` — `splitting: true`
- `collector/dashboard/ui/src/views/replaySurface.ts` — dynamic import
- `collector/dashboard/ui/src/views/ReplayPlayer.tsx` — lazy load + loading state
- `collector/dashboard/ui/src/views/Incident.tsx` — same
- `collector/dashboard/dashboard/embed.go` — `all:` prefix
- `.github/workflows/ci.yml` — size gate

## Open questions

- Does the incident view want the player eagerly, given that arriving there
  _is_ the intent to watch a replay? Probably prefetch rather than eager-load,
  so the two views share one code path.
- Is the 1.9KB rrweb stylesheet worth splitting too, or does it stay in
  `app.css`? Splitting CSS in esbuild is fiddlier than JS; almost certainly not
  worth it for 934 bytes gzipped.

## Effort

**S.** One flag, two imports, a loading state. The largest single win available
anywhere in this backlog per line changed.

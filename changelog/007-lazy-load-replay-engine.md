# Lazy-Load the Replay Engine

The dashboard shipped rrweb — the entire session-replay engine — in its entry
bundle, so every visit to a table downloaded and parsed a feature behind one of
five tabs.

### Changed

- **rrweb now loads only when a replay is opened** (`todo-013`).
  `replaySurface.ts` was statically imported by `ReplayPlayer.tsx` and
  `Incident.tsx`, which put it in the single `app.js` entry chunk. Both now
  reach it through `await import("./replaySurface")` at the point a session is
  actually opened, and take `Marker` / `ReplayHandle` as type-only imports,
  which are erased at compile time and carry no runtime dependency.

  `splitting: true` in `build.mjs` does the rest — `format: "esm"` and `outdir`
  were already set, and `index.html` already loaded the entry as
  `type="module"`, so nothing in the loading path changed.

  | initial payload  | before      | after      |
  | ---------------- | ----------- | ---------- |
  | `app.js` raw     | 320,136     | 53,901     |
  | `app.js` gzipped | **100.7KB** | **16.6KB** |

  rrweb becomes `replaySurface-*.js`, 81.4KB gz, fetched on demand.

  Verified in a browser against the embedded binary, not by reasoning about the
  bundle: visiting Live feed, Timeline, Errors and Insights requests `app.js`
  and nothing else; opening a replay session fetches the chunk once, mounts the
  player, and reports the correct duration and timeline markers with no console
  errors.

- **`//go:embed all:ui/dist`.** The bare form silently skips files whose names
  begin with `_` or `.`, which is a shape esbuild's generated chunk names can
  take. No route work was needed — `embed.go` already serves any file by name
  and derives its content type from the extension.

- **The dashboard build clears `dist` first.** Content-hashed chunk names mean a
  stale chunk from a previous build would otherwise linger, and `all:ui/dist`
  would bake it into the binary permanently.

### Added

- **A size budget for the dashboard, enforced in CI** (`npm run size-check`).
  The SDK had one; the dashboard had none, so this regression had nothing
  stopping it.

  It measures the entry chunk **plus everything it imports statically,
  transitively** — not just `app.js`'s own bytes. This distinction is the whole
  value of the check: with `splitting: true`, esbuild hoists shared code into
  separate chunk files that the entry then imports at the top, and those are
  fetched on page load just as surely as inlined code. A budget that looked only
  at `app.js` reported 16.6KB while the browser downloaded 98.1KB.

  Confirmed by re-introducing the exact regression it guards against: restoring
  the static import produces a passing-looking `app.js` of 16.6KB, and the check
  correctly reports a 98.1KB initial payload and exits non-zero.

---

## Summary of Changes

The README leads with "~5KB gzipped SDK, rrweb loads lazily" — the dashboard
quietly undid that on the read side, paying the full replay engine to render a
table. That matters most where it is least convenient: an operator checking
errors over a phone tether, or an air-gapped box on slow internal networking.

The app code was never the problem. 16.6KB gz covers Preact plus every view,
component and chart. One dependency, statically imported, was 81% of the
payload.

**Files Modified:**

- `collector/dashboard/ui/build.mjs` - `splitting: true`; clear `dist` before building
- `collector/dashboard/ui/src/views/ReplayPlayer.tsx` - dynamic import, type-only types
- `collector/dashboard/ui/src/views/Incident.tsx` - same
- `collector/dashboard/ui/size-check.mjs` - new; static-import-graph size budget
- `collector/dashboard/ui/package.json` - `size-check` script
- `collector/dashboard/embed.go` - `all:` embed prefix
- `.github/workflows/ci.yml` - size budget step

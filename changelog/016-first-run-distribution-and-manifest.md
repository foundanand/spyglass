# First-Run Setup, SDK Distribution, and an Honest Task Manifest

Three items that share a theme: the parts of the project that talk to a person
who is not already inside it.

### Added

- **A first-run setup panel** (`todo-016`). A freshly started collector showed
  "no activity yet" on every view — accurate, and indistinguishable from a
  broken install. First-run is where a self-hosted tool gets abandoned: the
  operator has already run a binary, written a config and wired an SDK, and the
  payoff screen looks like failure, with no support channel to ask and no error
  to search for.

  The empty state is now the last step of setup. Three items, not a wizard:

  1. **The collector is up** — version, origin, and the app slugs it is
     configured for, so the half the operator controls is visibly fine.
  2. **The `init` snippet**, pre-filled with this collector's own address and
     app slug, so neither can be mistyped. The key is the one thing only they
     have.
  3. **The CSP line**, pre-filled with this origin. This is the most likely
     reason a correct-looking install shows nothing, and the failure is
     _silent_ — a `connect-src` that omits the collector makes the browser block
     every POST with no console error and no failed request the app can see.

  It resolves itself the moment the first event lands, with no reload —
  verified end to end against a genuinely fresh collector: panel, one `curl`,
  and the live dashboard appeared on its own with the event on it.

  It fires only when **nothing has ever arrived**. An empty _window_ is a normal
  state and still gets the terse line; showing setup instructions to someone
  with three months of data would be worse than saying nothing.

- **`GET /v1/query/meta`** — version, app **slugs**, and `has_any_events`. It
  never returns app keys: the dashboard password and the ingest keys are
  separate credentials on purpose, and this sits behind the former. A test
  asserts the response contains no key-shaped field.

- **`scripts/vendor.sh`** (`todo-011`) — builds, size-checks, packs and copies
  the SDK into a consuming repo, with a `VENDORED.json` recording the source
  commit and whether the tree was dirty, so "which build is this app running"
  stays answerable a month later.

  This is the script every consumer was going to have to write. It **copies
  rather than symlinks**, deliberately.

- **`sdk/size-check.mjs`, wired into CI.** The 5KB core budget existed in
  `CLAUDE.md` and was never enforced. It measures the entry plus its transitive
  _static_ imports (rrweb stays lazy and uncounted) and additionally asserts the
  core entry imports nothing external — a linked SDK whose entry pulls in React
  loads a second copy of it, and the hook errors that follow point nowhere near
  the cause. Current: **4.34KB gz**, rrweb 79.58KB lazy.

### Fixed

- **`exports` now includes `./package.json`.** A CJS tool could not resolve
  _anything_ in the package: `createRequire().resolve()` threw
  `ERR_PACKAGE_PATH_NOT_EXPORTED`, which is how a `next.config.js` helper hit a
  wall. Resolving the manifest is the standard way a build tool locates a
  package directory, and it now works.

  `require.resolve("@spyglass/sdk")` itself still throws, by design: the package
  is ESM-only and a dual-package hazard is worse than this papercut. The docs
  say so and show the pattern that does work.

- **`tasks/manifest.json` no longer lies** (`todo-012`). Seventeen tasks sat at
  `todo` for features that had demonstrably shipped. A status field that is
  wrong for most of its rows is worse than none — anyone reading it to decide
  what to work on would conclude error tracking and the incident view needed
  building, and start rebuilding them.

  Fifteen are now `done`. Two are `wontfix` with a `resolution` explaining why:
  `p4-sdk-autocapture` (cut, not deferred) and `p5-sdk-publish` (reversed — the
  SDK is deliberately not on npm). The per-task `metadata.json` files were
  updated to match, so the drift does not simply move somewhere else, and a
  check confirms manifest and metadata now agree on every row.

  `tasks/README.md` says plainly that the folder is historical and points at
  `todo/`. The briefs are kept — they hold the design intent behind what was
  built. Confirmed nothing reads the manifest programmatically, and that its
  reference to "the phases in CLAUDE.md §10" still resolves.

### Changed

- **The SDK docs gained an "Installing" section** that reflects reality: that
  `npm link` cannot work in a pnpm project at all, that a cross-repo `link:`
  breaks under Turbopack because it resolves symlinks to their real path, and
  that widening `turbopack.root` to fix it is a trap — measured at **1.5s → over
  2 minutes** for a first compile on a host app with ~11 sibling projects. A
  private registry is named as the better answer for anyone who can run one.

- `README.md` and `docs/getting-started.mdx` match the panel, including a CSP
  step that was previously only in the README's integration checklist.

---

## Summary of Changes

Every one of these is about somebody encountering the project cold: an operator
staring at an empty dashboard, a developer trying to install a package that
isn't on npm, or anyone opening `tasks/` to work out what is left to do. All
three previously gave an answer that was accurate and useless, or confidently
wrong.

**Files Modified:**

- `collector/query/meta.go`, `meta_test.go` - new; the endpoint and its key-leak guard
- `collector/server.go` - route, app slugs
- `collector/dashboard/ui/src/views/Setup.tsx` - new; the panel
- `collector/dashboard/ui/src/App.tsx` - show it only when nothing has ever arrived
- `collector/dashboard/ui/src/index.html` - panel styles
- `collector/dashboard/ui/size-check.mjs` - budget raised to 32KB with the reasoning
- `sdk/package.json` - `./package.json` export, `size-check` script
- `sdk/size-check.mjs` - new; 5KB budget and link-safety assertion
- `scripts/vendor.sh` - new; the supported distribution path
- `tasks/manifest.json`, `tasks/*/metadata.json`, `tasks/README.md` - statuses corrected
- `docs/sdk.mdx`, `docs/getting-started.mdx`, `docs/api.mdx`, `README.md`, `claude.md`
- `.github/workflows/ci.yml` - SDK size budget step

# The SDK Reported the Wrong Version

### Fixed

- **`VERSION` was hardcoded and had drifted.** `sdk/src/index.ts` carried
  `export const VERSION = "0.0.0"` typed in by hand, so the package published to
  npm as **0.0.1 while the SDK reported 0.0.0** to the collector — and
  `spyglass.version` is the field you would reach for to answer "which SDK build
  is this app running".

  That matters more here than in most libraries: reporting accurately on the app
  it is embedded in is the entire job of this package.

  Caught by installing `@foundanand/spyglass-sdk@0.0.1` from the public registry
  into a scratch project and importing it, rather than trusting the publish log.

### Changed

- **The version is now derived from `package.json` at build time**, via esbuild's
  `define` in `build.ts` and an identical `define` in `vitest.config.ts` so tests
  see a real value. There is one source of truth and no literal to forget.

- **The test asserts the invariant, not the number.** It previously read
  `expect(VERSION).toBe("0.0.0")` — a literal, which is exactly what let the
  drift happen and then kept passing through it. It now checks that `VERSION`
  matches `package.json` and looks like a semver.

  Confirmed load-bearing: removing the `define` makes it fail with
  `__SPYGLASS_VERSION__ is not defined` rather than passing quietly. (Worth
  checking explicitly — three tests in this package had been passing without
  exercising anything; see `changelog/018`.)

- Bumped to **0.0.2**, which is what actually ships this fix: 0.0.1 is immutable
  on npm and will always report `0.0.0`.

---

## Summary of Changes

0.0.1 published correctly and installs fine; it just misreports its own version.
0.0.2 is the first release where `spyglass.version` is trustworthy, and the
mechanism now makes that class of drift impossible rather than merely fixed.

**Files Modified:**

- `sdk/src/index.ts` - `VERSION` injected rather than typed in
- `sdk/build.ts` - read `package.json`, inject via esbuild `define`
- `sdk/vitest.config.ts` - the same define, so tests match the build
- `sdk/src/index.test.ts` - assert agreement with `package.json`, not a literal
- `sdk/package.json` - 0.0.2

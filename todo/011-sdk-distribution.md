# Installing the SDK is genuinely awkward, in three separate ways

> **P3** · sdk · `todo-011`

## Problem

`@spyglass/sdk` is deliberately not on npm — GPL, self-hosted, air-gap. That is a
sound decision, and the documented path is `pnpm pack` a tarball and vendor it.
Integrating it into a real Next.js app surfaced three distinct problems with
that, only one of which is documented.

### 1. `npm link` does not work at all in a pnpm project

```
$ npm link @spyglass/sdk
npm error Cannot read properties of null (reading 'matches')
```

npm cannot parse pnpm's `node_modules` layout. Anyone reaching for the obvious
local-development workflow hits this immediately.

### 2. A `link:` to a sibling checkout breaks under Turbopack

pnpm's own equivalent works at the package-manager level, and then the bundler
rejects it. Turbopack resolves a symlinked dependency to its **real** path and
refuses anything outside the workspace root, which it infers from the lockfile
directory. Result: `Module not found: Can't resolve '@spyglass/sdk'`, despite
Node and `tsc` both resolving it fine.

The apparent fix — pointing `turbopack.root` at the shared parent — works and is
a trap. Measured on the host app, with ~11 sibling projects each carrying
`node_modules`:

|                            | Default root | Root at shared parent |
| -------------------------- | ------------ | --------------------- |
| First `/dashboard` compile | 1.5s         | **> 2 min**           |
| An API route               | 62ms         | 51–93s                |

It also changes what `output: standalone` traces.

The workable answer is to copy the built package _into_ the consuming repo and
link that, so the real path is back inside the root. Which works, and is a
per-consumer script every consumer now has to write.

### 3. ESM-only with no `require` condition

```json
"exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } }
```

Any CJS tool resolving the package fails:

```
ERR_PACKAGE_PATH_NOT_EXPORTED: No "exports" main defined
```

Hit while writing a `next.config.js` helper — `createRequire().resolve()` cannot
see the package at all. Workaroundable, but it is a papercut for every build tool
that has not gone ESM.

There is also a **fourth**, latent: importing `@spyglass/sdk/next` from a linked
package loads a second copy of React, because the bundler resolves `react`
through the symlink to the SDK's own `node_modules`. The core entry is safe (it
has no external imports at all — verified) but nothing warns you, and hook errors
point nowhere near the cause.

## Why it matters

The SDK is 1.7KB gzipped and genuinely nice to use once installed. Installing it
is where people will give up, and every problem above is silent or misleading
rather than a clear error.

`p5-sdk-publish` in the old task manifest assumed npm. That decision was reversed
for good reasons, and the replacement distribution story was never finished.

## Approach

Pick a supported path and make it work end to end, rather than leaving three
half-paths.

**Ship a `spyglass vendor` command** (or a script in the repo) that builds, packs
and copies the SDK into a target repo's `vendor/`, writing a provenance file with
the source commit and dirty state. This is what every consumer ends up
hand-writing; write it once.

**Add a `require` condition.** Either a small CJS build alongside the ESM one, or
at minimum expose `./package.json` in `exports` so tools can resolve _something_.

**Document the linked-package hazards** in `docs/sdk.mdx`: that `npm link` is
unsupported in pnpm projects, that a cross-repo `link:` fails under Turbopack and
why widening the root is not the fix, and that only the core entry is safe to
link (with the `grep -o 'from"[^"]*"' dist/index.js` check that proves it).

A private registry (Verdaccio, or a git dependency) is the other honest answer
and sidesteps all of this. Worth naming as the recommended option for anyone who
can run one.

## Acceptance

- One documented, tested path from a fresh spyglass checkout to a working
  install in a consuming app, that does not require the consumer to invent a
  script.
- `require.resolve("@spyglass/sdk")` no longer throws in a CJS context.
- `docs/sdk.mdx` covers the Turbopack and double-React hazards explicitly.

## Files

- `sdk/package.json` — exports map, `require` condition
- `sdk/build.ts` — CJS output if that route is taken
- `scripts/vendor.sh` — new
- `docs/sdk.mdx` — an "Installing" section that reflects reality
- `README.md` — the quick-start install block

## Open questions

- Is a CJS build worth the dual-package hazard, or is exposing `./package.json`
  enough for the tools that actually need it? Start with the latter.
- Should the repo publish to a private registry instead and make vendoring the
  fallback? Would remove most of this file, at the cost of infrastructure.

## Effort

**S–M**, mostly documentation and one script. The `require` condition is the only
part with a design decision in it.

# Repo-Wide Prettier Formatting

### Changed

- Ran `pnpm format` across the repository. 98 files were not Prettier-clean;
  **87 of them predated this branch** — including `changelog/001`,
  `changelog/002`, `collector/dashboard/ui/src/App.tsx` and most of the
  dashboard views and `tasks/*/metadata.json`.

---

## Summary of Changes

`CONTRIBUTING.md` lists `pnpm format:check` as the thing to run before
committing, but it is **not** one of the checks in `.github/workflows/ci.yml`.
Nothing enforced it, so it drifted — by the time it was noticed, most of the
dashboard and both earlier changelog entries were failing.

No behaviour changed. This is whitespace, quoting, trailing commas and line
wrapping only. The full CI job was re-run afterwards because Prettier rewrote 14
`.ts`/`.tsx`/`.mjs` source files: dashboard build, `go vet`, `go test ./...`
(air-gap guard included), static `CGO_ENABLED=0` build, SDK typecheck, and 76
SDK tests — all green.

Two consequences worth knowing:

- **`git blame` is polluted** across those 14 source files. The standard remedy
  is a `.git-blame-ignore-revs` file listing this commit, which `git config
blame.ignoreRevsFile .git-blame-ignore-revs` then honours. Not added here —
  it needs this commit's SHA, so it is a deliberate follow-up.
- **This will happen again** unless `format:check` becomes a CI step. It is one
  line in the `sdk` job and it is the only reason the drift went unnoticed.

**Files Modified:**

- 68 files reformatted — no behavioural change. Notable groups: `tasks/*/metadata.json` (43 files), the dashboard views and components under `collector/dashboard/ui/src/`, several `sdk/src/` modules and tests, `collector/dashboard/ui/build.mjs`, and the earlier `changelog/` entries.
- `changelog/005-repo-wide-formatting.md` - This file

# Publishing the SDK to npm

The SDK was deliberately not on npm — GPL, self-hosted, air-gap — and
`p5-sdk-publish` had been closed `wontfix` on that reasoning. Reversed: getting
it into a real app for testing was costing more than the distribution purity was
worth.

### Added

- **`@foundanand/spyglass-sdk` on npm**, starting at **0.0.1**.

  ```bash
  npm i @foundanand/spyglass-sdk
  ```

- **Automatic release from `master`.** A third CI job publishes when a merge
  lands and everything else is green. `needs: [collector, sdk]` is what enforces
  "passes everything" — the publish job cannot start until the collector job
  (including the air-gap guard) and the SDK job have both succeeded.

  It skips, rather than fails, in the two cases that are not errors:

  - **The version is unchanged.** Most merges touch the collector and not the
    SDK, and npm refuses to republish an existing version. Without this check
    every such merge would fail an otherwise green build. Bumping
    `sdk/package.json`'s version is what triggers a release.
  - **No `NPM_TOKEN` is configured.** A fork — or this repo before the secret is
    added — should not have a red build over a release it was never going to
    make.

  Published with `--provenance`, so anyone installing can verify which commit
  and workflow built a given version, and tagged `sdk-v<version>` on success.

- **`prepublishOnly`** runs the build and the size budget, so even a manual
  `npm publish` cannot ship a stale or oversized `dist`.

- Package metadata for the npm page: description, keywords, repository (with
  `directory: sdk`), homepage, bugs, engines, and
  `publishConfig.access: public` — scoped packages default to restricted, which
  would otherwise need a paid plan or a flag on every publish.

### Changed

- **Renamed `@spyglass/sdk` → `@foundanand/spyglass-sdk`** across 18 files.
  `@spyglass` would have needed an npm org that does not exist, and the
  unscoped `spyglass` is taken by an unrelated package (v1.0.1). A user scope
  needs no setup and cannot collide. This also settles the first of
  `CLAUDE.md` §13's open questions.

  `changelog/` and `tasks/` keep the old name — they are historical records, and
  rewriting them to match the present would be dishonest.

- **npm is now the documented install path**, with vendoring kept as the
  air-gapped one rather than the only one. The README, getting-started and SDK
  docs said the package was deliberately not published; they now say what is
  true, and the air-gap section notes that nothing at runtime ever contacts the
  registry.

- `p5-sdk-publish` moves from `wontfix` to `done`, with its history recorded
  rather than erased.

---

## Summary of Changes

The tarball is 380KB packed, most of which is sourcemaps (rrweb's alone is
992KB unpacked). They are kept: sourcemaps never reach a browser, and the ~4KB
figure the project advertises is the runtime payload, which is unchanged.

**What still needs a human:** the `NPM_TOKEN` repository secret, and the first
publish. Until the secret exists the publish job skips with a notice instead of
failing.

**Files Modified:**

- `sdk/package.json` - name, 0.0.1, publish metadata, `publishConfig`, `prepublishOnly`
- `.github/workflows/ci.yml` - the `publish` job, gated on both test jobs
- `README.md`, `docs/sdk.mdx`, `docs/getting-started.mdx`, `docs/index.mdx`, `CONTRIBUTING.md`, `claude.md` - the new name and install path
- `scripts/vendor.sh`, `examples/nextjs-demo/*`, `collector/dashboard/ui/src/views/Setup.tsx` - renamed
- `package.json`, `pnpm-lock.yaml` - workspace filters
- `tasks/manifest.json`, `tasks/p5-sdk-publish/metadata.json`, `tasks/README.md` - `wontfix` → `done`

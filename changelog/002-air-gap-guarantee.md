# Air-gap Guarantee — Enforced, Documented, and CI-checked

### Added

- **Air-gap guard test** ([collector/airgap_test.go](../collector/airgap_test.go)) — turns the "runs fully disconnected" claim into something the build enforces:
  - `TestNoAccidentalOutboundInCollector` scans all shipped collector Go source (tests excluded) and fails if it finds an outbound-client call (`http.Get`/`Post`/`NewRequest`/`Client{}`, `net.Dial*`, `tls.Dial`, `smtp.*`, `websocket.Dial`, …). Server-side symbols are deliberately not flagged. A deliberate, reviewed egress can opt out with an inline `// airgap:allow <reason>` marker, so any future Slack-webhook / on-prem-LLM feature becomes a documented decision rather than a silent regression.
  - `TestNoExternalAssetsInDashboard` scans the embedded dashboard bundle (`index.html`, `app.css`, `app.js`) and fails on any CDN host, external font, or remote `<script>`/`<link>`/`url()`/`fetch`/`import`. Verified to catch violations and honour the allow-marker (probed with a temporary offending file during development).
- **CI workflow** ([.github/workflows/ci.yml](../.github/workflows/ci.yml)) — runs on every push/PR to `master`:
  - `collector` job: builds the embedded dashboard bundle first (it is a gitignored build artifact that `//go:embed ui/dist` requires, and building it lets the asset guard run for real instead of skipping), then `go vet`, `go test ./...` (both air-gap guards), and a `CGO_ENABLED=0` static build.
  - `sdk` job: `pnpm` typecheck + vitest unit tests (pnpm version comes from `package.json`'s `packageManager` field, not the action, to avoid `ERR_PNPM_BAD_PM_VERSION`).
  - Intended to be wired as a **required status check** on the protected `master` branch, so nothing that breaks the air-gap guarantee can merge.
- **README "Air-gapped / offline deployment" section** ([README.md](../README.md)) — documents what is guaranteed and tested (zero collector egress, self-contained dashboard, SDK-only-to-collector), how to move the collector (static binary / Docker) and SDK (`pnpm pack` tarball) across the enclave boundary, staggered-safe `/v1/` upgrades, and the one seam to watch (optional Slack/LLM egress, off by default, must be `// airgap:allow`-marked and pointed at in-enclave endpoints).

### Changed

- **pnpm workspace** ([pnpm-workspace.yaml](../pnpm-workspace.yaml)) — dropped `collector/dashboard/ui` from the workspace. The dashboard is npm-managed (its own `package-lock.json`, built via `npm` in the Makefile/CI); having it in the pnpm workspace too meant dual dependency management, which had already drifted the root `pnpm-lock.yaml` (`rrweb-player` vs `rrweb`) and broke `pnpm install --frozen-lockfile` in CI. Regenerated the lockfile so pnpm owns `sdk` + `examples` and npm owns the dashboard, with no overlap.
- **README intro** now leads with the air-gap positioning: the "no phone-home" bullet calls out *zero outbound calls / runs fully disconnected* and links to the enforcing test.
- **Repository metadata** (GitHub): description rewritten to lead with "Air-gap-friendly … runs fully disconnected — zero outbound calls"; added `air-gapped` and `offline-first` topics.

### Breaking Changes

- None. No runtime, wire-format, schema, or SDK-API changes — this change-set is tests, CI, and docs only.

---

## Summary of Changes

Following a source-level audit that confirmed the collector makes no outbound calls, the dashboard pulls no external/CDN assets, and the SDK only talks to its configured collector, this change-set makes the **air-gap guarantee non-rottable**: a Go guard test fails the build the moment accidental egress or an external asset is introduced, and a new CI workflow runs that guard (plus vet/build/SDK tests) on every push and PR to `master` — ready to be enforced as a required status check alongside the branch protection already on `master`. The README gains a dedicated air-gapped/offline deployment section and an air-gap-forward intro, and the GitHub description/topics were realigned to the same positioning.

**Files Modified:**

- `collector/airgap_test.go` — new; the two guard tests described above.
- `.github/workflows/ci.yml` — new; collector (vet + test + static build) and sdk (typecheck + test) jobs on push/PR to `master`.
- `README.md` — new "Air-gapped / offline deployment" section; intro bullet now leads with air-gap and links the guard test.

**Verification:** `go vet ./...`, `go test ./...` (guards pass; negative-probed to confirm they catch violations and respect `// airgap:allow`), `CGO_ENABLED=0 go build` — all green. `pnpm --filter @spyglass/sdk typecheck` clean; vitest 48/48 pass.

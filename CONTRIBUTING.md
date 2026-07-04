# Contributing to spyglass

Thanks for your interest in spyglass. It's a lightweight, self-hosted telemetry
stack — analytics, session replay, error tracking, and bug reports — for small
closed-loop apps. **One Go binary. One SQLite file. One npm package. Zero
external services.** Contributions that keep it that small and that simple are
very welcome.

Please read this whole file before opening a large PR — spyglass is
deliberately opinionated, and knowing what we will and won't accept up front
saves everyone time.

---

## Ways to contribute

- **Report a bug** — open an issue with steps to reproduce, what you expected,
  and what happened. Collector version (`spyglassd --version`), OS/arch, and
  browser help a lot for SDK/replay issues.
- **Request a feature** — open an issue describing the problem first, not just
  the solution. Because the project is scope-disciplined (see
  [Project philosophy](#project-philosophy)), it's worth checking a feature fits
  before you build it.
- **Improve docs** — fixes to the README, `docs/`, or this file are always welcome
  and a great first contribution.
- **Send code** — bug fixes, tests, and small well-scoped features. For anything
  large, open an issue to discuss the approach before writing it.

If you're not sure whether something's wanted, **open an issue and ask** — that's
never wrong.

---

## Project layout

This is a monorepo with three deployable pieces:

```
collector/            Go module — the spyglassd binary (github.com/foundanand/spyglass/collector)
  ingest/  store/  query/       endpoints, SQLite access, read queries
  dashboard/ui/                 embedded dashboard SPA (Preact, esbuild) — npm-managed
sdk/                  npm package — @spyglass/sdk (TypeScript, esbuild, vitest)
examples/nextjs-demo/ throwaway app that exercises the SDK end-to-end
docs/                 user-facing documentation
changelog/            one file per change-set (see "Changelog", below)
```

Package management is split on purpose: the **root is a pnpm workspace** (`sdk`
+ `examples/*`), while **`collector/dashboard/ui` is npm-managed** with its own
lockfile and built via `npm` in the Makefile/CI. Don't add the dashboard to the
pnpm workspace.

---

## Development setup

**Prerequisites:** Go **1.25+**, Node **20+**, and **pnpm** (pinned via
`packageManager` in `package.json` — `corepack enable` will provision the right
version). No C toolchain is needed: the SQLite driver (`modernc.org/sqlite`) is
pure Go, so the binary builds with `CGO_ENABLED=0`.

The `Makefile` is the source of truth for build commands:

```bash
make build       # build the dashboard, then the collector binary for your host
make dashboard   # build only the embedded dashboard SPA
make collector   # build only the Go binary (needs dashboard/ui/dist to exist)
make run         # build, then run with ./spyglass.config.json
make test        # go test ./...  +  SDK vitest
make release     # cross-compile static binaries for darwin/linux × amd64/arm64
make clean       # remove build output
```

> The dashboard bundle (`collector/dashboard/ui/dist`) is a **build artifact**,
> not committed, and is consumed by `//go:embed`. Run `make dashboard` (or
> `make build`) before any `go build`/`go test` in the collector, or the embed
> fails to compile.

For SDK work, pnpm from the root:

```bash
pnpm install                       # install workspace deps
pnpm --filter @spyglass/sdk build  # build the SDK
pnpm --filter @spyglass/sdk test   # vitest
pnpm --filter @spyglass/sdk typecheck
```

To exercise replay/events by hand, run the collector and point the demo app at
it:

```bash
make run                           # collector on :7474 (per spyglass.config.json)
cd examples/nextjs-demo && pnpm dev
```

---

## Checks your PR must pass

CI (`.github/workflows/ci.yml`) runs on every PR into `master`. Reproduce it
locally before you push:

**Collector**

```bash
make dashboard                 # embed target must exist first
cd collector
go vet ./...
go test ./...                  # includes the air-gap guard (see below)
CGO_ENABLED=0 go build -o /dev/null .
```

**SDK**

```bash
pnpm install
pnpm --filter @spyglass/sdk typecheck
pnpm --filter @spyglass/sdk test
```

**Formatting** — Prettier covers TS/TSX/MJS/JSON/MD:

```bash
pnpm format          # write
pnpm format:check    # verify (what to run before committing)
```

Go code must be `gofmt`-clean and pass `go vet`. There are no linter debates —
`gofmt` and `go vet` are the standard.

### The air-gap guard is non-negotiable

spyglass makes **zero outbound network calls, ever**, and the dashboard ships
**no external assets** (no CDN scripts, fonts, or images). This is enforced by
`collector/airgap_test.go` and `TestNoExternalAssetsInDashboard`, and CI marks
the `collector` job as required. A PR that introduces an outbound call or a
remote asset **will not merge** — inline it or vendor it instead.

---

## Coding conventions

- **Go:** `gofmt` + `go vet`. Every endpoint gets a **table-driven test**.
- **TypeScript:** strict mode in `sdk/`. SDK core logic gets **vitest** unit tests.
- **Dashboard:** Preact + esbuild (`node build.mjs`); there is no separate
  typecheck step — the build is the gate. It uses `preact/compat`, so import
  from `preact/hooks`, not `react`.
- **Schema changes:** numbered migration files in `collector/store/migrations/`,
  applied on boot. **Never edit a shipped migration** — add a new one.
- **Wire format is versioned** (`/v1/`). The SDK and collector can deploy
  independently, so don't make a breaking wire change without bumping the version.
- **Dependencies are budgeted.** The collector stays at **≤5 Go dependencies**;
  the SDK's only runtime dependency is **rrweb**. Adding a dependency needs a
  strong justification in the PR.
- **Prefer deleting code to adding config.** Every new config key must justify
  itself against the "configure once, never touch again" goal.

---

## Changelog

Every change that's about to be pushed needs a matching entry in `changelog/`.
Copy `changelog/template.md` to the next sequential `NNN-feature-name.md`
(zero-padded, kebab-case), group your changes by type (Added / Changed / Fixed /
…), call out any breaking changes, and finish with a short summary plus the list
of files touched. Write it as part of the change, not after.

---

## Pull request process

1. **Fork** and branch off `master` (`git checkout -b fix/short-description`).
2. Make your change, **add/update tests**, and add a **changelog entry**.
3. Run the full local check set above; make sure `pnpm format:check`, the
   collector tests, and the SDK tests all pass.
4. Use clear commit messages. We follow [Conventional
   Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `chore:`,
   `docs:`, `refactor:`, `test:`), optionally scoped, e.g. `feat(dashboard): …`.
5. Open a PR against `master` describing **what** changed and **why**. Link the
   issue it addresses. Keep PRs focused — one concern per PR reviews faster.
6. Address review feedback; keep the branch up to date with `master`.

---

## Project philosophy

spyglass exists because PostHog/Highlight/OpenReplay assume billion-event scale
(ClickHouse, Kafka, Kubernetes) that most internal tools don't need. Keeping it
tiny is the point, so some things are **explicitly out of scope** and PRs adding
them will be declined:

- **No database servers of any kind** — no ClickHouse/Postgres/Redis/Kafka/Mongo.
  Embedded SQLite + flat files only. (If analytics ever outgrow SQLite, the
  escape hatch is DuckDB — still a file, never a server.)
- **No horizontal scaling / multi-tenant SaaS.** Single-tenant per deployment;
  vertical headroom on one machine is enormous.
- **No always-on DOM autocapture by default**, no anonymous-visitor analytics,
  no cookie-consent machinery, no ad/UTM attribution, no A/B testing.
- **No phone-home, no external calls** — see the air-gap guard above.

If your idea fits "solve the whole telemetry problem for a 20–200-user internal
app, on the smallest machine you have, with one binary and one config file," it's
probably a great fit. When in doubt, open an issue first.

---

## License

spyglass is licensed under **GPL-3.0-or-later**. By contributing, you agree that
your contributions are licensed under the same terms. See [LICENSE](LICENSE).

# Contributing Guide & Repo Docs

### Added

- [CONTRIBUTING.md](../CONTRIBUTING.md) — contributor guide for the open-source project: ways to contribute, repo layout, dev setup (Go 1.25 / Node 20 / pnpm, `make` targets), the exact CI checks to run locally, coding conventions, the non-negotiable air-gap guard, the changelog requirement, PR process, project philosophy / non-goals, and GPL-3.0 licensing of contributions.
- `changelog/` folder with `template.md` and this project's changelog entries; a "changelog before push" convention recorded in [CLAUDE.md](../CLAUDE.md) §12.

### Breaking Changes

- None. Documentation and process only; no code, wire format, or SDK changes.

---

## Summary of Changes

Repo-hygiene pass for open-sourcing: a real `CONTRIBUTING.md` grounded in the
actual tooling (Makefile targets, `.github/workflows/ci.yml` checks, the pnpm/npm
split, and the air-gap guarantee), plus the `changelog/` workflow it references.
No functional changes.

**Files Modified:**

- `CONTRIBUTING.md` - New: contributor guide.
- `changelog/template.md` - New: entry template.
- `changelog/001-replay-inspector-and-ui-polish.md` - New: prior change-set entry.
- `CLAUDE.md` - Add "changelog before push" convention (§12).

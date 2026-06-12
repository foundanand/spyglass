# Notes

Project-specific working notes for spyglass: conventions, edge cases, audits,
runbooks, and decisions that only make sense *inside* this codebase. The
counterpart to `developer-notes/` — what lives here is deliberately tied to
spyglass's domain (events, sessions, replay chunks, incident slices) and is not
meant to be portable.

Typical contents:

- Wire-format and schema decisions, and why they were made.
- Edge cases discovered while building (sendBeacon races, backpressure drops,
  retention sweep timing).
- Audits and gap analyses — date these in the filename, e.g.
  `schema-gap-audit-2026-06-12.md`.
- Ops runbooks (deploy, retention tuning, backup = `cp spyglass.db`).

One topic per file, named in `kebab-case.md`. No index required — keep it
loose; the filenames are the index.

# Developer Notes

Reusable design patterns extracted from this project. Unlike `notes/` (which
captures project-specific conventions like the collector's disk layout or the
SDK's batching quirks), this folder is **portable**: each note is written so it
can be lifted into a *different* codebase with minimal rework.

When you find yourself thinking "this was a clever idea, I want it in my next
project too", drop a note here.

## Index

| Note | What it's for |
| ---- | ------------- |
| _(none yet)_ | |

## Conventions for writing a note

A portable note has four sections:

1. **Problem** — what pain this pattern removes.
2. **Shape** — the files, types, and data flow, described abstractly (not
   tied to this project's domain).
3. **Drop-in checklist** — concrete steps to wire it into a new codebase.
4. **Extension points** — the knobs you'll actually turn when adapting it.

Keep domain words (event, session, replay, incident) out of the abstract
sections — use placeholders like `<Record>` / `<Stream>`. Put project-specific
examples at the very bottom if at all.

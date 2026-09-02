# Only the browser can report; nothing server-side or batch

> **P3** · collector · `todo-009`

## Problem

Every event in spyglass comes from a browser running the JS SDK. There is no
supported way for a server, a worker, a cron job or a CLI to report anything.

`POST /v1/events` would technically accept a batch from anywhere — it is just
JSON with an app key. But nothing documents that, nothing provides a client, and
two details make it awkward in practice: the app key is designed to be public
(it ships to the browser), and the CORS origin allowlist is written for browser
callers.

## Why it matters

The gap shows up as soon as a duration crosses the network boundary. A flow like
"export data" is timed from the click to the download — which is honest, but when
p90 is 40 seconds, spyglass cannot tell you whether that is query time, xlsx
serialisation, or transfer. The server knows; it has no way to say.

Same for anything the user never sees: a nightly job that silently fails, an
import that takes 20 minutes, a migration. Today those are invisible unless
somebody is watching a terminal.

This is a real scope decision, not an obvious yes. The project is explicitly
"telemetry for small closed-loop apps" built around identified browser sessions
and replay. Server-side events have no session, no user, and no replay — they are
a different shape of data, and letting them in dilutes the thing that makes the
incident view work.

## Approach

Deliberately minimal. Not an APM.

**Separate credential.** A `server_key` per app in the config, distinct from the
browser `key`, never sent to a client. The existing `env:NAME` support
(added alongside the flows work) means it can stay out of version control.
Server-key requests skip the origin check; browser keys keep it.

**Accept sessionless events.** `session_id` is required today. Server events have
none — either allow it empty, or mint a synthetic per-process one. Empty is more
honest; check that the dashboard's session views tolerate it rather than
rendering blanks.

**No new SDK.** The wire format is JSON over HTTP and is documented. A snippet in
the docs beats a Node package this project would then have to version, build,
publish and air-gap alongside the browser SDK.

**Correlate rather than merge.** If a server event carries the `session_id` the
browser sent it, the incident view can show both halves of a request. That is the
version of this feature actually worth building — server timing _attached to a
user session_, not a parallel firehose.

## Acceptance

- A `curl` with a server key inserts events, with no Origin header, and is
  documented as a supported path.
- A browser key still cannot skip the origin check.
- Sessionless events render sanely everywhere in the dashboard.
- A server event carrying a browser `session_id` appears on that session's
  timeline.

## Files

- `collector/config.go` — `server_key` per app
- `collector/ingest/events.go` — key class, origin skip, optional session
- `collector/ingest/events_test.go`
- `collector/dashboard/ui/src/views/UserTimeline.tsx` — sessionless rows
- `docs/api.mdx` — the server-side snippet

## Open questions

- **Is this in scope at all?** Argue it against `CLAUDE.md` §1–2 before building.
  The honest alternative is "spyglass is browser telemetry; use logs for the
  server", and that is a defensible answer.
- If yes, does `type` need a new value (`server`), or do server events reuse
  `event`/`error` with a marker prop? A new type means dashboard work everywhere.

## Effort

**M**, dominated by the scope decision rather than the code.

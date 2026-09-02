# Server-Side Ingest

### Added

- **`server_key` per app** (`todo-009`) — a second, non-public credential that
  lets a worker, cron job or CLI report events:

  ```json
  "apps": { "inventory": { "key": "sg_live_…", "server_key": "env:SG_SERVER_KEY" } }
  ```

  Absent by default, in which case this path does not exist and only browsers
  can report.

- **Sessionless events.** A nightly job has no sitting to belong to, so
  `session_id` may be empty. Empty is more honest than a synthetic id, and no
  session row is created for one — verified: zero phantom sessions after
  ingesting a sessionless batch. The dashboard renders those rows as `—` with a
  "no session (server-side event)" title, and does not offer an incident link,
  since an incident is a slice of a session and there is none to cue.

- **A documented `curl` snippet** rather than a Node package. The wire format is
  JSON over HTTP; a server SDK would be one more thing to version, build,
  publish and carry across an air gap.

### Security

- **The origin check is skipped only for server-keyed callers.** The browser
  `key` ships to the client and is public by design, so it is only meaningful
  alongside the origin allowlist — letting it skip the check would make that
  allowlist decorative. Verified: a browser key from a disallowed origin still
  gets **403**, while a server key with no `Origin` header at all gets **204**.

- **The collector refuses to start if `server_key` equals `key`**, which would
  quietly hand every browser the ability to bypass the origin check.

- Key comparison for both classes now uses `crypto/subtle`, and `server_key`
  resolves through `env:` so it stays out of version control.

---

## Summary of Changes

The backlog asked for this to be argued against the project's non-goals before
being built, and the argument that carried it is **correlation, not collection**.

A parallel firehose of server events is what logs are already for. But a flow
like "export data" is timed from the click to the download, which is honest and
useless when p90 is 40 seconds: spyglass cannot say whether that is query time,
serialisation, or transfer. The server knows and had no way to say.

Passing the browser's `session_id` on a server event is the whole feature.
Verified end to end: a `report.export` flow of 40s and an `xlsx.serialize` event
of 31s now sit on one session timeline, so the incident view shows both halves
of the same request. Without that id it is a firehose; with it, "export takes
40s" becomes "31s of it was xlsx serialisation".

**Files Modified:**

- `collector/config.go` - `server_key`, `env:` resolution, equality validation
- `collector/config_test.go` - equality rejection, env resolution, absent default
- `collector/ingest/events.go` - key class, constant-time compare, origin exemption, sessionless upsert skip
- `collector/ingest/events_test.go` - origin bypass and non-bypass, sessionless, correlation
- `collector/server.go` - pass `ServerKey` through
- `collector/dashboard/ui/src/views/{LiveFeed,Errors,Incident}.tsx` - sessionless rows render sanely
- `docs/api.mdx`, `docs/configuration.mdx`, `spyglass.config.example.json` - the snippet and the key

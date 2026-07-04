# spyglass

Self-hosted product analytics, session replay, error tracking, and bug reports
for small closed-loop apps. **One Go binary. One SQLite file. One npm package.
Zero external services.**

PostHog, Highlight, and OpenReplay assume billion-event scale — ClickHouse,
Kafka, Kubernetes, gigabytes of RAM. Most internal tools have 20–200 daily users
and need none of that. spyglass is the telemetry stack for that world: it records
*every* session continuously, with identified users, so "what happened when the
bug occurred" isn't a capture problem — it's a query over data already on disk.

- **~5KB gzipped SDK.** rrweb loads lazily (~85KB gz), only when replay is on.
- **~20MB RAM collector, ~21MB Docker image.** Pure-Go SQLite (`modernc.org/sqlite`), no CGo, static binary.
- **Configure once, never touch again.** One JSON file is the entire ops story.
- **GPL-3.0, self-hosted, no phone-home.** Everything stays on your machine.

---

## Quick start

### 1. Run the collector

```bash
# Docker — the whole thing, persisted to a volume:
SPYGLASS_PASS=changeme docker compose up -d
# → dashboard + collector at http://localhost:7474

# …or build the single binary from source:
make build
./collector/spyglassd --config spyglass.config.json
```

Config is one file — copy `spyglass.config.example.json` to
`spyglass.config.json` and set your app key:

```json
{
  "listen": ":7474",
  "dataDir": "./data",
  "apps": {
    "inventory": { "key": "sg_live_…", "origins": ["http://localhost:3000"] }
  },
  "retention": { "replays_days": 21, "events_days": 0 },
  "auth": { "dashboard_password": "env:SPYGLASS_PASS" }
}
```

`replays_days`/`events_days` of `0` means keep forever. The dashboard password is
optional (empty = open, for local dev); set it and the dashboard plus all query
endpoints require HTTP Basic auth.

Data (SQLite + replay chunks) lives on the `spyglass-data` volume and survives
rebuilds and restarts. Events are ~200 bytes each; replays dominate storage at
roughly 0.5–2 MB per user-hour of active use, capped by `replays_days`.

### 2. Add the SDK to your app

The SDK lives in `sdk/` (`@spyglass/sdk`). It is **not** published to npm —
build it, pack it, and install the tarball (or push it to your own registry):

```bash
# in this repo
pnpm --filter @spyglass/sdk build
cd sdk && pnpm pack        # → spyglass-sdk-0.0.0.tgz

# in your app
pnpm add file:./vendor/spyglass-sdk-0.0.0.tgz
```

```ts
import { spyglass } from "@spyglass/sdk";

spyglass.init({
  endpoint: "https://telemetry.internal.acme.dev",
  app: "inventory",
  key: "sg_live_…",    // app key — must match the collector config
  user: { id: "anand", name: "Anand" }, // identified by design
  replay: true,        // default true — rrweb + console, lazy-loaded
  network: true,       // default true — method, status, duration, sizes
  maskInputs: "password",
  reportWidget: true,  // floating bug-report button
});

spyglass.capture("invoice_created", { amount: 1200 });
spyglass.report("the totals look wrong");   // programmatic bug report
```

Next.js app-router pageviews wire up automatically:

```tsx
import { SpyglassProvider } from "@spyglass/sdk/next";

<SpyglassProvider config={{ endpoint, app: "inventory", key, user }}>
  {children}
</SpyglassProvider>
```

That's it. Errors, network calls, pageviews, and replay flow in with no further
code.

### 3. Integration checklist

Four things that bite real apps — check them before wondering why the dashboard
is empty:

- **Content-Security-Policy.** The SDK POSTs cross-origin to the collector. If
  your app ships a CSP, `connect-src 'self'` silently blocks every event and
  replay chunk — add the collector origin:

  ```
  connect-src 'self' https://telemetry.internal.acme.dev
  ```

  Derive it from the same env var the SDK reads so the two can't drift.

- **Identify when your user resolves.** `init()` requires `user.id`, but most
  apps fetch the session asynchronously. Two patterns that work: defer `init()`
  until your auth query settles, or init at login with what you have and call
  `setUser()` when the profile arrives. Mount the provider *inside* your auth
  gate and you also stop tracking login screens and public pages for free.

- **Make it removable.** Read `endpoint`/`key` from env and skip `init()` when
  they're unset. Telemetry becomes a config flag, not a code change — and CI /
  local dev run untracked by default.

- **PII-heavy screens.** Replay records the DOM, so whatever users can see, the
  replay can show. For apps handling sensitive data start from
  `maskInputs: "all"` and `network: false` (API payloads defeat DOM masking),
  set a short `replays_days`, and loosen deliberately — not the other way
  around.

---

## What you get

| Dashboard view | What it shows |
| --- | --- |
| **Live feed** | The event stream, filterable by user / type / app. |
| **Timeline** | Pick a user → sessions → chronological breadcrumbs (pageviews, captures, network, errors). |
| **Errors** | Every error and bug report, with stack traces; click through to the incident. |
| **Replay** | Session player with seek, ⏩ skip-idle fast-forward (on by default), event markers on the timeline, and a console pane synced to playback. |
| **Insights** | DAU, top events, top pages, errors-by-day, and a step funnel. |
| **Incident** | The killer view: for any error or bug report, the slice `[ts−60s, ts+10s]` from that session — replay auto-cued to the moment, breadcrumb timeline, network waterfall, console, and the stack/comment on top. |

Replays reconstruct the DOM, not pixels. One consequence: if the recorded app
serves its web fonts without CORS headers, the replay iframe falls back to
system fonts. Cosmetic only — layout and content are exact. Self-host fonts with
`Access-Control-Allow-Origin` if it bothers you.

---

## API

### Collector endpoints

| Route | Purpose |
| --- | --- |
| `POST /v1/events` | Batched JSON events → single-transaction insert (app-key auth). |
| `POST /v1/replay?session=&seq=` | Gzipped rrweb chunk → disk (app-key auth). |
| `GET /v1/query/events` | Filtered event stream (`user`, `type`, `app`, `from`, `to`, `limit`). |
| `GET /v1/query/users` | Active users, last seen, session counts. |
| `GET /v1/query/sessions` | Session list. |
| `GET /v1/query/funnel?steps=a,b,c` | Sequential step funnel. |
| `GET /v1/query/aggregates` | DAU, top events, top pages, errors-by-day. |
| `GET /v1/sessions/:id/replay` | Chunk manifest + streaming chunk fetch. |
| `GET /v1/incidents/:event_id` | Incident slice for an error/bug_report. |
| `GET /` | Embedded dashboard. |

Ingest endpoints (`/v1/events`, `/v1/replay`) authenticate with per-app keys.
Everything else is gated by the dashboard password when one is set.

### SDK surface

```ts
spyglass.init(config);
spyglass.capture(name, props?);
spyglass.setUser({ id, name?, email? });   // late identification
spyglass.report(comment, extra?);          // programmatic bug report
```

---

## Privacy defaults

- `maskInputs: "password"` minimum, always.
- Network bodies are opt-in per route prefix (`network: { bodies: ["/api/"] }`);
  `Authorization` / `Cookie` headers are **never** recorded.
- Replays auto-expire (21 days default); events are tiny and kept by default.
- No phone-home, no external calls, ever. Everything stays on the operator's box.

---

## Development

```
spyglass/
  collector/        Go module: spyglassd (ingest, store, query, embedded dashboard)
  sdk/              @spyglass/sdk (TypeScript, esbuild)
  examples/
    nextjs-demo/    throwaway app that exercises everything
```

```bash
make build      # build dashboard + collector for this host
make release    # cross-compile static binaries (darwin/linux × amd64/arm64)
make test       # Go + SDK test suites
make run        # build, then run against spyglass.config.json
```

The dashboard is a Preact SPA embedded into the binary via `go:embed`; there is
no Node on the server. SQLite runs in WAL mode as a library *inside* the binary —
the database is one file, backup is `cp`.

## License

GPL-3.0 — free for commercial use; if you distribute the software, your modifications must be shared. See [LICENSE](LICENSE).

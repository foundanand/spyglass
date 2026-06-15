# spyglass

Self-hosted product analytics, session replay, error tracking, and bug reports
for small closed-loop apps. **One Go binary. One SQLite file. One npm package.
Zero external services.**

PostHog, Highlight, and OpenReplay assume billion-event scale — ClickHouse,
Kafka, Kubernetes, gigabytes of RAM. Most internal tools have 20–200 daily users
and need none of that. spyglass is the telemetry stack for that world: it records
*every* session continuously, with identified users, so "what happened when the
bug occurred" isn't a capture problem — it's a query over data already on disk.

- **~5KB gzipped SDK.** rrweb loads lazily, only when replay is on.
- **~20MB RAM collector.** Pure-Go SQLite (`modernc.org/sqlite`), no CGo, static binary.
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

### 2. Add the SDK to your app

The SDK lives in `sdk/` (`@spyglass/sdk`). Install it from the workspace or your
own registry — it is **not** published to npm.

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

---

## What you get

| Dashboard view | What it shows |
| --- | --- |
| **Live feed** | The event stream, filterable by user / type / app. |
| **Timeline** | Pick a user → sessions → chronological breadcrumbs (pageviews, captures, network, errors). |
| **Errors** | Every error and bug report, with stack traces; click through to the incident. |
| **Replay** | rrweb-player with seek and a console pane. |
| **Insights** | DAU, top events, top pages, errors-by-day, and a step funnel. |
| **Incident** | The killer view: for any error or bug report, the slice `[ts−60s, ts+10s]` from that session — replay auto-cued to the moment, breadcrumb timeline, network waterfall, console, and the stack/comment on top. |

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

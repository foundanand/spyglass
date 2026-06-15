# CLAUDE.md — Spyglass (working name)

HIGHLY IMPORTANT: **before doing something, always check online for potential best practices and solutions without assuming anything, and always double-check whether whatever you have done is done according to the best practices or not.**

Lightweight, self-hosted user behavior analytics + session replay + bug reporting for small closed-loop apps.
One Go binary. One SQLite file. One npm package. Zero external services.

> Working name is "spyglass" — rename freely. Keep the name short, lowercase, npm-available.

---

## 1. Mission

PostHog / Highlight / OpenReplay assume billion-event scale: ClickHouse, Kafka, Kubernetes, gigabytes of RAM. Most internal tools have 20–200 daily users and need none of that. Spyglass is the telemetry stack for that world.

**The dynamoip test (our DX north star — see https://dynamoip.com):**

* `npm install`, one config file, one command. Configure once, never touch again.
* A single deployable that runs forever on the smallest machine you have.
* Solves the *whole* problem (events + replay + errors + bug reports), not a slice of it.
* Open-source, GPL-3.0, built first for our own projects, generalizable later.

**The structural advantage:** in a closed internal system we record *every* session continuously, with identified users. So "what happened when the bug occurred" is not a capture problem (Jam/Capture.dev solve it with in-browser ring buffers) — it's a query over data already on disk. Bug reporting becomes a view layer, nearly free.

## 2. Non-goals

* No *always-on* DOM autocapture. It exists, but strictly opt-in (`autocapture: true`); off by default because explicit `capture()` + auto-pageviews give cleaner data. When off, the code for it never loads.
* No anonymous-visitor analytics (tracking logged-out strangers — all our users are authenticated), no cookie-consent machinery (GDPR banners for tracking the public), no ad attribution (UTM/campaign tracking — we run no ads), no A/B testing (variant experiments — separate product, could be added much later).
* No horizontal scaling, no multi-tenant SaaS (single-tenant per deployment). Vertical headroom on one machine is enormous; no hard user ceiling.
* No database servers of any kind: no ClickHouse/Postgres/Redis/Kafka/MongoDB. Embedded SQLite + flat files only.

## 3. Architecture

```
┌─────────────────────────────┐
│  Next.js app (or any web)   │
│  @spyglass/sdk (~5KB gz)    │
│  ├─ events (capture, pages) │
│  ├─ rrweb recorder + console│
│  ├─ fetch/XHR interceptor   │
│  ├─ error handlers          │
│  └─ bug-report widget       │
└──────────┬──────────────────┘
           │ batched JSON / gzipped chunks (sendBeacon on unload)
           ▼
┌─────────────────────────────┐
│  spyglassd (Go, single bin) │
│  ├─ POST /v1/events         │──► SQLite (WAL)  spyglass.db
│  ├─ POST /v1/replay         │──► disk          replays/{session}/{n}.json.gz
│  ├─ GET  /v1/query/*        │
│  └─ GET  /     (dashboard)  │  embedded static UI + rrweb-player
└─────────────────────────────┘
```

* ~15–25MB RAM. Cross-compiled static binary (darwin/linux, amd64/arm64).
* SQLite driver: `modernc.org/sqlite` (pure Go, no CGo, trivial cross-compile).
* Dashboard: static HTML/JS embedded via Go `embed`. No SSR, no Node on the server.

### Why these choices

| Decision                              | Rationale                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SQLite (embedded), WAL mode           | SQLite is a**library inside the binary, not a server** . No DB process, no RAM allocation, no ops; the database is one file, backup =`cp`. This is what makes the single-binary install story possible. Handles 50k inserts/sec in transactions and hundreds of millions of rows on one machine.                                                                                                                                     |
| Why not MongoDB / NoSQL               | Mongo is a separate server process (~500MB+ RAM, install/monitor/backup tooling) — the exact heaviness this project exists to avoid. Our queries are analytical (time ranges, counts, funnels) where SQL is the natural fit. Schema flexibility is preserved via the `props`JSON column + SQLite's JSON1 functions. If analytics ever outgrow SQLite, the escape hatch is DuckDB (also embedded, also a file) — never a database server. |
| Replay blobs on disk, not in DB       | rrweb chunks are large (MBs). Files keep the DB small; retention = delete old dirs.                                                                                                                                                                                                                                                                                                                                                          |
| Go sidecar (vs Next.js API route)     | One collector serves many apps; survives app redeploys; matches "neutral pipe" infra thinking.                                                                                                                                                                                                                                                                                                                                               |
| rrweb                                 | The same engine under PostHog/Highlight. We build storage + viewer only.                                                                                                                                                                                                                                                                                                                                                                     |
| Continuous recording (vs ring buffer) | Closed system, known users → record everything; bug reports are time-slices.                                                                                                                                                                                                                                                                                                                                                                |

## 4. Data model

### SQLite schema (v1)

```sql
CREATE TABLE events (
  id          INTEGER PRIMARY KEY,
  ts          INTEGER NOT NULL,          -- unix ms
  app         TEXT NOT NULL,             -- app slug from config
  user_id     TEXT NOT NULL,
  session_id  TEXT NOT NULL,
  type        TEXT NOT NULL,             -- 'event' | 'pageview' | 'error' | 'network' | 'bug_report'
  name        TEXT NOT NULL,             -- event name, or url path, or error message
  url         TEXT,
  props       TEXT                       -- JSON
);
CREATE INDEX idx_events_user_ts    ON events(user_id, ts);
CREATE INDEX idx_events_type_ts    ON events(type, ts);
CREATE INDEX idx_events_session    ON events(session_id, ts);

CREATE TABLE sessions (
  session_id  TEXT PRIMARY KEY,
  app         TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  started_at  INTEGER NOT NULL,
  last_seen   INTEGER NOT NULL,
  chunk_count INTEGER DEFAULT 0,         -- replay chunks on disk
  meta        TEXT                       -- JSON: browser, viewport, etc.
);
```

`props` conventions: errors carry `{stack, source, line, col}`; network carries `{method, status, duration_ms, req_size, res_size, body_excerpt?}`; bug_report carries `{comment, severity?}`.

### Replay storage

```
data/
  spyglass.db
  replays/
    {session_id}/
      meta.json                # first-chunk timestamp index for seeking
      000001.json.gz           # rrweb events, gzipped client-side
      000002.json.gz
```

Chunk = ~10s of rrweb events. Console logs travel inside the rrweb stream via the official console-record plugin (no separate pipeline).

## 5. SDK (`@spyglass/sdk`)

### API surface (keep it this small)

```ts
import { spyglass } from "@spyglass/sdk";

spyglass.init({
  endpoint: "https://telemetry.internal.acme.dev",   // dynamoip pairs nicely here
  app: "inventory",
  user: { id: "anand", name?: "Anand", email?: ... }, // identified by design
  replay: true,                 // default true
  autocapture: false,           // default false; true = record all clicks + form interactions
  network: true,                // default true (headers + sizes; bodies opt-in)
  maskInputs: "password",       // "all" | "password" | "none"
  reportWidget: true,           // floating bug-report button
});

spyglass.capture("invoice_created", { amount: 1200 });
spyglass.setUser({ id, ... });   // late identification
spyglass.report("it broke");     // programmatic bug report
```

### Internals

* **Batching:** in-memory queue; flush every 5s or 20 events; `navigator.sendBeacon` on `visibilitychange`/`pagehide`. Never lose tab-close events.
* **Sessions:** random ID in `sessionStorage`; new ID after 30min idle.
* **Replay:** rrweb `record()` + console plugin; gzip chunks with native `CompressionStream`; POST every ~10s; backpressure → drop replay before dropping events.
* **Network:** patch `fetch` + `XMLHttpRequest`. Default: method, URL, status, duration, sizes. Bodies only when `network: { bodies: ["/api/"] }` allow-list matches; truncate to 2KB. Never capture `Authorization`/`Cookie` headers.
* **Errors:** `window.onerror`, `unhandledrejection`, patched `console.error`. Dedup identical errors within 5s.
* **Autocapture (opt-in):** when `autocapture: true`, delegate-listen on `click` (record selector, trimmed innerText, x/y) and `change` on form controls (field name only, never values unless unmasked). Lazy-loaded module — zero bytes shipped when disabled.
* **Report widget:** floating button → comment box → emits `bug_report` event. Shadow DOM, no style bleed.
* **Next.js helper:** `<SpyglassProvider config={...}>` — wires app-router pageviews via `usePathname`/`useSearchParams`. Works in plain JS apps without it.
* **Budget:** ≤5KB gz core; rrweb lazy-loaded as a second chunk only when `replay: true`.

## 6. Collector (`spyglassd`)

### Endpoints

| Route                                          | Purpose                                                    |
| ---------------------------------------------- | ---------------------------------------------------------- |
| `POST /v1/events`                            | Batched JSON events → single-transaction insert           |
| `POST /v1/replay?session=&seq=`              | Gzipped rrweb chunk → disk, bump `sessions.chunk_count` |
| `GET /v1/query/users`                        | Active users, last seen, session counts                    |
| `GET /v1/query/events?user=&type=&from=&to=` | Filtered event stream                                      |
| `GET /v1/query/funnel?steps=a,b,c`           | Simple step funnel (SQL, good enough)                      |
| `GET /v1/sessions/:id/replay`                | Chunk manifest + streaming chunk fetch                     |
| `GET /v1/incidents/:event_id`                | **Incident slice**(see §7)                          |
| `GET /`                                      | Embedded dashboard                                         |

### Config — one file, dynamoip-style

```json
// spyglass.config.json
{
  "listen": ":7474",
  "dataDir": "./data",
  "apps": { "inventory": { "key": "sg_live_..." } },
  "retention": { "replays_days": 21, "events_days": 0 },
  "auth": { "dashboard_password": "env:SPYGLASS_PASS" }
}
```

Run: `spyglassd --config spyglass.config.json`. That's the whole ops story. Retention sweep runs daily in-process.

## 7. Dashboard

Plain embedded SPA (vanilla or Preact, no build complexity beyond esbuild). Views, in build order:

1. **Live feed** — event stream, filterable by user/type/app.
2. **User timeline** — pick a user → sessions → chronological breadcrumbs (pageviews, clicks-of-interest, captures, network, errors).
3. **Replay player** — rrweb-player, seek by timestamp, console pane alongside.
4. **Incident view (the killer feature):** for any `error` or `bug_report` event, assemble the slice `[ts−60s, ts+10s]` from the same `session_id`:
   * replay clip auto-cued to the moment
   * breadcrumb timeline (events table)
   * network waterfall (from `network` events)
   * console output (from the replay stream)
   * the comment/stack trace on top
     This is Capture.dev/Jam's product, derived as a *query* over data we already have.
5. **Simple aggregates** — DAU, top events, top pages, error counts by day. SQL `GROUP BY`, no more.
6. *(Later, optional)* **Auto-summary** — POST the incident slice to an LLM for a one-paragraph writeup. Off by default; config key for an API endpoint.

## 8. Privacy defaults (internal ≠ careless)

* `maskInputs: "password"` minimum, always.
* Network bodies opt-in per route prefix; auth headers never recorded.
* Replays auto-expire (21 days default); events are tiny and keep forever.
* Everything stays on the operator's machine. No phone-home, no external calls, ever.

## 9. Sizing anchors (reference math, not limits)

* 60 users × ~600 events/day ≈ 36k rows/day ≈ 13M rows/yr — trivial for SQLite, which holds hundreds of millions of rows comfortably. 10x the users still doesn't change the architecture.
* Replay ≈ 1–5MB compressed per active hour → worst case ~1–2GB/day, real-world far less; 21-day retention ⇒ tens of GB max. Scale retention with disk, not architecture.
* Collector RAM target: <50MB under load. If it exceeds this, something is wrong — fix it, don't scale it.

## 10. Build phases

**Phase 1 — Events core (the spine).**
Go: `/v1/events`, SQLite schema, batched insert, config loading. SDK: init, capture, pageviews, batching, sendBeacon, sessions. Dashboard: live feed only. *Exit: events from a Next.js dev app visible in dashboard.*

**Phase 2 — Replay.**
SDK: rrweb + console plugin, gzip chunks, upload. Go: `/v1/replay`, disk layout, manifest endpoint, retention sweep. Dashboard: replay player with seek. *Exit: watch any session end-to-end with console logs.*

**Phase 3 — Errors + network.**
SDK: error handlers, fetch/XHR patch, dedup. Dashboard: error list, network rows in user timeline. *Exit: throw in dev app → error appears with stack, linked to session.*

**Phase 4 — Incident view + report widget.**
SDK: widget, `report()`. Go: `/v1/incidents/:id` slice assembly. Dashboard: the incident page. *Exit: click report → open incident → replay cued to that exact moment.*

**Phase 5 — Polish & release.**
Funnel/aggregate queries, dashboard auth, `npx spyglassd` wrapper or install script, README in dynamoip's voice, Docker example, GPL-3.0 license, publish `@spyglass/sdk`.

Each phase ships working software. Do not start phase N+1 with phase N broken.

## 11. Repo layout

```
spyglass/
  collector/         # Go module: spyglassd
    main.go
    ingest/  store/  query/  dashboard/ (embedded static)
  sdk/               # npm: @spyglass/sdk (TypeScript, esbuild)
    src/{core,replay,network,errors,widget,next}.ts
  examples/
    nextjs-demo/     # throwaway app that exercises everything
  docs/
  spyglass.config.example.json
```

## 12. Conventions for working in this repo

* TypeScript strict in `sdk/`; standard `gofmt`/`go vet` in `collector/`. No linter debates.
* Every endpoint gets a table-driven Go test; SDK core gets vitest unit tests; replay tested manually via `examples/nextjs-demo`.
* Schema changes = numbered migration files applied on boot (`store/migrations/`). Never edit a shipped migration.
* Wire format is versioned (`/v1/`). SDK and collector may deploy independently.
* Prefer deleting code to adding config. Every config key must justify itself against the dynamoip test (§1).
* Dependencies: collector ≤5 Go deps; SDK runtime deps = rrweb only.

## 13. Open questions (decide during build, don't block on)

1. Name + npm scope availability.
2. Dashboard auth: single shared password v1 vs per-user — leaning shared password v1.
3. Source-map support for stack traces — defer; internal apps can ship unminified or upload maps in v2.
4. Slack webhook on new `bug_report` — cheap, probably Phase 5.

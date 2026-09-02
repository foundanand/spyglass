# spyglass

Self-hosted product analytics, session replay, error tracking, and bug reports
for small closed-loop apps. **One Go binary. One SQLite file. One npm package.
Zero external services.**

PostHog, Highlight, and OpenReplay assume billion-event scale — ClickHouse,
Kafka, Kubernetes, gigabytes of RAM. Most internal tools have 20–200 daily users
and need none of that. spyglass is the telemetry stack for that world: it records
_every_ session continuously, with identified users, so "what happened when the
bug occurred" isn't a capture problem — it's a query over data already on disk.

- **~5KB gzipped SDK.** rrweb loads lazily (~85KB gz), only when replay is on.
- **~20MB RAM collector, ~21MB Docker image.** Pure-Go SQLite (`modernc.org/sqlite`), no CGo, static binary.
- **Configure once, never touch again.** One JSON file is the entire ops story.
- **Air-gap-ready — no phone-home, ever.** No outbound calls unless you configure a webhook, and none at all by default; runs fully disconnected. GPL-3.0, self-hosted — everything stays on your machine. ([enforced by a test](collector/airgap_test.go).)

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

Any value may be written as `"env:NAME"` to read it from the environment
instead — the app key and the dashboard password both support it, so the config
file can live in version control with no credential in it.

`replays_days`/`events_days` of `0` means keep forever. The dashboard password is
optional (empty = open, for local dev); set it and the dashboard plus all query
endpoints require HTTP Basic auth.

Data (SQLite + replay chunks) lives on the `spyglass-data` volume and survives
rebuilds and restarts. Events are ~200 bytes each; replays dominate storage at
roughly 0.5–2 MB per user-hour of active use, capped by `replays_days`.

### 2. Add the SDK to your app

The SDK lives in `sdk/` (`@spyglass/sdk`). It is **not** published to npm — GPL,
self-hosted, air-gap. One command vendors it into your app:

```bash
# in this repo
scripts/vendor.sh /path/to/your-app

# in your app
pnpm add file:./vendor/spyglass-sdk
```

That builds, size-checks and packs the SDK, copies it in, and writes a
`VENDORED.json` recording the source commit — so "which build is this running"
stays answerable. If you can run a private registry (Verdaccio) or install from
a git URL, prefer that.

> `npm link` does not work in pnpm projects, and a cross-repo `link:` breaks
> under Turbopack. Both fail silently or misleadingly — see
> [Installing](docs/sdk.mdx) for what goes wrong and why the script copies
> rather than symlinks.

```ts
import { spyglass } from "@spyglass/sdk";

spyglass.init({
  endpoint: "https://telemetry.internal.acme.dev",
  app: "inventory",
  key: "sg_live_…", // app key — must match the collector config
  user: { id: "anand", name: "Anand" }, // identified by design
  replay: true, // default true — rrweb + console, lazy-loaded
  network: true, // default true — method, status, duration, sizes
  maskInputs: "password",
  reportWidget: true, // floating bug-report button
});

spyglass.capture("invoice_created", { amount: 1200 });
spyglass.report("the totals look wrong"); // programmatic bug report

// How long did it take? Time the span the user actually experiences.
spyglass.startFlow("invoice.create"); // the form opened
spyglass.endFlow("invoice.create", { items: 3 }); // it saved
```

Next.js app-router pageviews wire up automatically:

```tsx
import { SpyglassProvider } from "@spyglass/sdk/next";

<SpyglassProvider config={{ endpoint, app: "inventory", key, user }}>{children}</SpyglassProvider>;
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
  `setUser()` when the profile arrives. Mount the provider _inside_ your auth
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

| Dashboard view | What it shows                                                                                                                                                                                                 |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Live feed**  | The event stream, filterable by user / type / app.                                                                                                                                                            |
| **Timeline**   | Pick a user → sessions → chronological breadcrumbs (pageviews, captures, network, errors).                                                                                                                    |
| **Errors**     | Every error and bug report, with stack traces; click through to the incident.                                                                                                                                 |
| **Replay**     | Session player with seek, ⏩ skip-idle fast-forward (on by default), event markers on the timeline, and a console pane synced to playback.                                                                    |
| **Insights**   | DAU, top events, top pages, errors-by-day, a step funnel, and flow durations (p50/p90, abandon rate) grouped by user, day, or any event prop.                                                                 |
| **Incident**   | The killer view: for any error or bug report, the slice `[ts−60s, ts+10s]` from that session — replay auto-cued to the moment, breadcrumb timeline, network waterfall, console, and the stack/comment on top. |

### Flow timing

Counts tell you an action happened; they cannot tell you what it costs the
person doing it. Wrap one in `startFlow`/`endFlow` and the collector will report
p50, p90, p95, mean and max over completed runs — plus how often people started
the action and gave up:

```ts
// when the create-task form opens
spyglass.startFlow("task.create", { entry: "keyboard" });
// when the task exists
spyglass.endFlow("task.create", { clients: 3 });
// when the dialog is dismissed without saving (a no-op if it already ended)
spyglass.cancelFlow("task.create", "dialog_dismissed");
```

Then ask one question four ways:

```
/v1/query/flows?name=task.create                     # how long does it take
/v1/query/flows?name=task.create&group=user          # who is slow at it
/v1/query/flows?name=task.create&group=day           # is it getting worse
/v1/query/flows?name=task.create&group=prop:clients  # what makes it slow
```

Three things the design does on purpose, because they are the difference between
a number you can act on and one you cannot:

- **Durations cover completed runs only**, with the abandon rate reported next
  to them. A fast median often just means the slow attempts gave up.
- **A flow open longer than 30 minutes is dropped, not reported.** Someone left
  the form open over lunch; that is not a four-hour task creation.
  (`flowTimeoutMs`.)
- **An "abandonment" under 100ms is ignored** — that is a component remounting,
  not a decision. React StrictMode double-invokes effects in development, so
  without this every start-on-mount flow reports a 0ms abandonment per page
  visit. (`minAbandonMs`; completions are never filtered.)

Open flows live in `sessionStorage`, so a flow survives navigation within the
tab and dies with it. It also works before `init()`, which is how a login flow
can start on the login page — where there is no user to attribute it to — and be
closed by the dashboard once there is.

---

Replays reconstruct the DOM, not pixels. One consequence: if the recorded app
serves its web fonts without CORS headers, the replay iframe falls back to
system fonts. Cosmetic only — layout and content are exact. Self-host fonts with
`Access-Control-Allow-Origin` if it bothers you.

---

## API

### Collector endpoints

| Route                              | Purpose                                                               |
| ---------------------------------- | --------------------------------------------------------------------- |
| `POST /v1/events`                  | Batched JSON events → single-transaction insert (app-key auth).       |
| `POST /v1/replay?session=&seq=`    | Gzipped rrweb chunk → disk (app-key auth).                            |
| `GET /v1/query/events`             | Filtered event stream (`user`, `type`, `app`, `from`, `to`, `limit`). |
| `GET /v1/query/users`              | Active users, last seen, session counts.                              |
| `GET /v1/query/sessions`           | Session list.                                                         |
| `GET /v1/query/funnel?steps=a,b,c` | Sequential step funnel.                                               |
| `GET /v1/query/flows`              | Duration stats per flow (`name`, `group=user\|day\|prop:<key>`).      |
| `GET /v1/query/aggregates`         | DAU, top events, top pages, errors-by-day.                            |
| `GET /v1/sessions/:id/replay`      | Chunk manifest + streaming chunk fetch.                               |
| `GET /v1/incidents/:event_id`      | Incident slice for an error/bug_report.                               |
| `GET /`                            | Embedded dashboard.                                                   |

Ingest endpoints (`/v1/events`, `/v1/replay`) authenticate with per-app keys.
Everything else is gated by the dashboard password when one is set.

### SDK surface

```ts
spyglass.init(config);
spyglass.capture(name, props?);
spyglass.setUser({ id, name?, email? });   // late identification
spyglass.report(comment, extra?);          // programmatic bug report

// Flow timing — how long an action takes, not just how often it happens.
spyglass.startFlow(name, props?);
spyglass.endFlow(name, props?);            // completed; returns elapsed ms
spyglass.cancelFlow(name, reason?);        // the user gave up
spyglass.failFlow(name, reason?);          // it broke; not the user's doing
const f = spyglass.flow(name); f.end();    // handle form, for same-scope start/end
```

---

## Privacy defaults

- `maskInputs: "password"` minimum, always.
- Network bodies are opt-in per route prefix (`network: { bodies: ["/api/"] }`);
  `Authorization` / `Cookie` headers are **never** recorded.
- Replays auto-expire (21 days default); events are tiny and kept by default.
- No phone-home. The collector makes no outbound call at all unless you
  configure `webhooks` — see [Air-gapped deployment](#air-gapped--offline-deployment).

---

## Air-gapped / offline deployment

spyglass is built to run inside a disconnected enclave. At runtime the **only**
network traffic is _browser → collector_, and both live inside your network —
nothing ever leaves it.

**What's guaranteed (and tested):**

- **The collector makes zero outbound connections out of the box.** No update
  check, no telemetry, no license call, no LLM. The single opt-in exception is
  described below; with it unconfigured, no egress code path exists at all.
- **The dashboard loads entirely from the binary.** No CDN, no Google Fonts, no
  remote scripts or stylesheets. A browser with no internet renders it fully.
- **The SDK only ever talks to your configured `endpoint`** (your collector).
  rrweb is bundled into your app at build time — it is never fetched from a CDN.

This is enforced by [`collector/airgap_test.go`](collector/airgap_test.go),
which fails the build (and CI) if an outbound call or external asset slips in.

**Moving it across the boundary:**

- **Collector:** one static, CGo-free binary (`make release` → `darwin/linux ×
amd64/arm64`) or the ~21MB Docker image. Copy it in on approved media; there
  is nothing to install and no runtime dependency to resolve. The database is a
  single SQLite file, so backup and restore are `cp`.
- **SDK:** not on npm — run `scripts/vendor.sh /path/to/your-app` outside the
  enclave and carry the resulting `vendor/spyglass-sdk` directory in with the
  rest of the app, or build your app where the checkout is reachable. Its only
  runtime dep, rrweb, is bundled, and `VENDORED.json` records which commit the
  copy came from.
- **Upgrades are staggered-safe.** The wire format is versioned (`/v1/`), so the
  SDK and collector can be updated independently — no lockstep redeploy across
  the boundary.

### The one exception: `webhooks`

One feature can make the collector originate a connection, and only one:

```json
{
  "webhooks": {
    "on_bug_report": "env:SG_WEBHOOK",
    "on_new_error": "env:SG_WEBHOOK",
    "dashboard_url": "https://spyglass.internal"
  }
}
```

Precisely what happens when you set it:

- **Unconfigured, nothing can leave.** This is structural, not a flag. With no
  URL the notifier is never constructed, and no code path exists that could
  dial out — you cannot enable egress by fat-fingering a config key.
- **Configured, exactly one call per notification** goes to the URL you named:
  a small JSON body with the app, user, event name, the bug report's comment,
  and a deep link to the incident view. Never event contents beyond that, never
  a replay, never the database.
- **Two triggers only**, not a rules engine: a `bug_report` arriving, or an
  error signature seen for the first time in 15 minutes. A burst of the same
  error is one message, not one per event.
- **Fire-and-forget**, 5s timeout, no retry queue. A dead receiver logs a line;
  it never delays or fails `POST /v1/events`.
- **The collector logs `webhooks: enabled`** at startup, so an operator can see
  from the logs alone whether this deployment can talk to anything.

**Point it at an in-enclave receiver — a Mattermost server, an internal relay,
anything on your own network — and the air gap is intact.** That is the intended
pattern. Pointing it at `hooks.slack.com` is a deliberate decision to send bug
report text outside your network.

The webhook call carries an inline `// airgap:allow <reason>` marker, which is
what lets it past [`collector/airgap_test.go`](collector/airgap_test.go). Every
other outbound call still fails the build — the guard is the feature, not an
obstacle, and this exception is reviewable because it had to be written down.

The auto-summary that would POST an incident slice to an LLM remains **not
implemented**, and would need the same treatment.

See also the **Content-Security-Policy** and **web-font** notes in the
[integration checklist](#3-integration-checklist) — both are the browser side of
staying fully self-contained.

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
no Node on the server. SQLite runs in WAL mode as a library _inside_ the binary —
the database is one file, backup is `cp`.

## License

GPL-3.0 — free for commercial use; if you distribute the software, your modifications must be shared. See [LICENSE](LICENSE).

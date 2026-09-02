# Flow Timing — Measuring How Long Actions Take

### Added

- **`flow` events and the SDK timing API.** A flow is the span between a user
  committing to an action and finishing (or giving up on) it:

  ```ts
  spyglass.startFlow("task.create");
  spyglass.endFlow("task.create", { clients: 3 }); // completed
  spyglass.cancelFlow("task.create", "dialog_dismissed"); // abandoned
  spyglass.failFlow("task.create", "server_error"); // failed
  spyglass.flow("task.create"); // handle form: .end() / .cancel() / .fail()
  spyglass.isFlowActive(name);
  spyglass.activeFlows();
  ```

  Also `flowTimeoutMs` and `minAbandonMs` config options, a new `"flow"` event
  type on the wire, and a `FlowOutcome` type.

- **`GET /v1/query/flows`** — duration statistics per flow: completions,
  abandons, failures, abandon rate, p50/p90/p95, mean, min, max, and total time
  spent. Takes `app`, `name`, `from`, `to`, `limit`, and:

  - `group=user` — who is slow at this
  - `group=day` — is it getting worse
  - `group=prop:<key>` — what makes it slow, bucketed by any prop the app
    attached to the event

  The response also carries every flow name seen in the window, so a dashboard
  can populate a picker without knowing in advance what the app it is watching
  emits. This is the primitive custom dashboards are meant to build on: one
  query answers four questions depending on one parameter, rather than four
  endpoints.

- **`store.Flows()` / `store.FlowNames()`** backing it, with nearest-rank
  percentiles computed in Go.

- **A "Flow durations" panel** in the embedded dashboard's Insights view, with
  the flow and grouping pickers, and a `flow` badge, colour token and filter
  chip in the live feed.

- **`env:NAME` support for app keys.** Previously only
  `auth.dashboard_password` could come from the environment, which made the
  config file — "the entire ops story" — the one place a credential had to be
  written literally. Operators were forced to either commit a key or keep the
  file out of version control entirely.

- **`startAll(config)`**, the single definition of "spyglass is running",
  exported for consumers wiring their own provider.

### Changed

- **`postJSON` now retries only what retrying can fix.** A network error, a 5xx
  or a 429 asks the caller to re-queue; a 4xx does not. Previously _any_ HTTP
  response counted as success, so a batch rejected for a bad app key was
  silently dropped — and re-queueing it instead would have resent the same
  rejected payload forever, blocking every event behind it at the front of the
  queue.

### Fixed

- **`<SpyglassProvider>` started almost nothing.** It called `init()` and
  `registerBeacon()` and stopped there, so an app following the documented
  Next.js app-router setup got pageviews but no error tracking, no network
  timing, no replay and no report widget — none of it obvious from outside,
  because events _do_ arrive. Both entry points now call `startAll()`.

- **`retention.replays_days: 0` deleted replays after 21 days.** The README
  documents `0` as "keep forever", and `retention.StartSweep` implements it that
  way, but the config loader could not tell an explicit `0` from an absent key
  and applied the default to both — so an operator who asked to keep replays
  forever quietly lost them after three weeks.

- **A `%c`-styled console group is no longer recorded as an error.** `%c` is a
  devtools styling directive; logging libraries use it for pretty grouped output
  and reach for `console.error` for the whole group, successful operations
  included. tRPC's development logger does exactly this, which put a consuming
  app's error count an order of magnitude out. The test is narrow: a genuine
  error message does not begin with `%c`.

- **A flow cancelled within 100ms is ignored.** React StrictMode runs every
  effect mount → cleanup → mount in development, so the natural pattern — start
  a flow on mount, cancel it on cleanup — emitted a 0ms abandonment on every
  page visit and pegged that flow's abandon rate near 50%. The gap is
  unambiguous: a remount cancels within the same tick, the fastest human decision
  to bail out is a couple of hundred milliseconds. Configurable via
  `minAbandonMs`; completions are never filtered.

### Breaking Changes

- None. `flow` is a new event type that older collectors ignore and older SDKs
  never send, so the wire format stays compatible in both directions.

---

## Summary of Changes

spyglass could answer how _often_ something happened — DAU, top events, funnel
step counts — but not how _long_ it took. "How long does creating a task take"
is the question most internal-tool operators actually have, and no amount of
counting answers it.

A flow is timed on the client and shipped as one event carrying `duration_ms`
and an outcome. The alternative — emitting a start and an end event and pairing
them in SQL — costs twice the events and pairs wrongly whenever one half is
dropped, the user opens two tabs, or the flow spans a session boundary. One
event per flow keeps the collector's job to plain aggregation over a number that
is already correct.

Two decisions shape the numbers. Durations describe _completed_ runs only, with
the abandon rate reported alongside — a fast median often just means the slow
attempts gave up, and averaging abandonments into it hides exactly that. And a
flow left open past 30 minutes is treated as forgotten rather than slow, so a
form left open over lunch does not report a four-hour task creation.

Open flows live in `sessionStorage`, so a flow survives navigation within the
tab and dies with it. That also means it can be started before `init()` — a
login flow can begin on the login page, where there is no user to attribute it
to, and be closed by the dashboard once there is.

Three bugs surfaced while integrating this into a real app and are fixed here:
the Next.js provider was starting almost nothing, an explicit "keep replays
forever" was being overridden by the default, and dropped-batch handling treated
every HTTP response as a success.

**Files Modified:**

**SDK**

- `sdk/src/flow.ts` - New. Flow timing: start/end/cancel/fail, the handle form, introspection
- `sdk/src/flow.test.ts` - New. 21 tests: durations, restart, timeout, the remount guard, persistence
- `sdk/src/start.ts` - New. `startAll()`, the one definition of "running"
- `sdk/src/constants.ts` - New. Shared defaults, so `core` and the feature modules never import each other
- `sdk/src/index.ts` - Exposed the flow API; `init()` delegates to `startAll()`
- `sdk/src/next.tsx` - `SpyglassProvider` now calls `startAll()`; documented mounting it inside the auth gate
- `sdk/src/types.ts` - `"flow"` event type, `FlowOutcome`, `flowTimeoutMs`, `minAbandonMs`
- `sdk/src/core.ts` - Defaults for the two new options
- `sdk/src/transport.ts` - Retry 5xx/429, drop 4xx
- `sdk/src/transport.test.ts` - New. Retry semantics per status class
- `sdk/src/errors.ts` - Skip `%c`-styled console groups
- `sdk/src/errors.test.ts` - Tests for that filter

**Collector**

- `collector/store/flows.go` - New. `Flows()`, `FlowNames()`, percentiles, grouping
- `collector/store/flows_test.go` - New. Grouping, windows, percentiles, the empty and all-abandoned cases, a hostile prop key
- `collector/query/flows.go` - New. `GET /v1/query/flows` and group parsing
- `collector/query/flows_test.go` - New. Handler behaviour, grouping, 400s, empty-array shape
- `collector/server.go` - Registered the route behind the dashboard gate
- `collector/config.go` - `env:` for app keys; an explicit `replays_days: 0` survives defaults
- `collector/config_test.go` - Tests for both; reformatted with gofmt

**Dashboard**

- `collector/dashboard/ui/src/views/Flows.tsx` - New. The flow durations panel
- `collector/dashboard/ui/src/views/Insights.tsx` - Mounted it
- `collector/dashboard/ui/src/views/LiveFeed.tsx` - `flow` badge and filter chip
- `collector/dashboard/ui/src/index.html` - `--c-flow` token, badge, row accent, table styles

**Documentation**

- `changelog/003-flow-timing.md` - This file
- `README.md` - Flow timing in the SDK surface, the dashboard table and the API table
- `docs/sdk.mdx` - The flow API
- `docs/api.mdx` - `GET /v1/query/flows`

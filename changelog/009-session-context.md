# Session Context — Recording Where Things Happened

spyglass recorded what happened and how long it took, and nothing about the
environment it happened in. A grep across the SDK for `userAgent`, `innerWidth`,
`screen.*`, `referrer` or `navigator.language` returned no matches, and
`sessions.meta` — a column that exists in the schema, is read back into
`Session.Meta`, and is rendered by the dashboard — was `NULL` for every row ever
written, because `UpsertSession` was called with a hardcoded `nil`.

### Added

- **`sdk/src/context.ts`** (`todo-003`). Collected once per session and attached
  to the session, not to every event — repeating it on the 254 network events of
  a real session would inflate the store for nothing.

  `viewport_w/h`, `viewport_bucket`, `screen_w/h`, `dpr`, `ua`, `language`, `tz`,
  `referrer`, `connection`. Every field individually guarded, so it degrades to
  a partial context rather than throwing in jsdom, an SSR shim or an old browser.

  `viewport_bucket` bands at 640 / 1024 / 1440 — the widths where layouts
  actually break, not device marketing names. It is the axis you group by; the
  raw width is kept for when you need it.

- **`meta` on the `POST /v1/events` envelope**, forwarded into `UpsertSession`.
  Optional, so an older SDK or `context: false` simply omits it.

- **`group=session:<key>` on `/v1/query/flows`.** This is what makes the capture
  worth having. Measured end to end on seeded data:

  ```
  group=session:viewport_bucket
    mobile    p50 = 130,000ms   completions 3
    desktop   p50 =  52,000ms   completions 3
    unknown   p50 =  25,306ms   completions 15
  ```

  A `LEFT JOIN`, and only when the grouping needs one: a flow from a session
  with no context row is still counted, bucketed as `unknown`, rather than
  dropped from the aggregate. The meta key is a bound `json_extract` path, so it
  never reaches the SQL text.

- **A "per device size" / "per connection" / "per timezone" / "per language"
  grouping in the dashboard's flow panel**, alongside the existing per-user and
  per-day.

- **`context?: boolean`** config, default `true`.

### Fixed

- **`flush()` silently dropped events when a POST was already in flight.** The
  batch was spliced out of the queue _before_ the `flushing` guard was checked,
  so the second of two overlapping flushes discarded its events entirely —
  no retry, no re-queue, no error.

  Found while writing the context tests, where a second flush produced no
  request at all. A standalone reproduction confirmed it: enqueue one event and
  flush against a request that never settles, enqueue two more and flush, and
  the queue length is **0** — both events gone.

  It fires exactly where it hurts most: a flush is triggered by a full 20-event
  queue or the 5s timer, so a busy app on a slow connection is the case most
  likely to overlap two flushes, and the case least able to afford losing the
  batch. Events now stay queued and a retry is scheduled. `sendBeacon` is exempt
  — it is the tab-close path, and there is no later flush to come back for.

### Changed

- Privacy docs gained a "Session context is coarse and switchable" section. No
  canvas, no font enumeration, no WebGL, no plugin list, no IP address; the raw
  UA is parsed for display in the dashboard and never turned into an identifier.

---

## Summary of Changes

This is the biggest multiplier available on data spyglass was already
collecting. Before it, `user` and `day` were the only two axes that existed, so
"the invoice form is abandoned 30% of the time" had no follow-up question. It is
also why this landed before the saved-views work: a dashboard builder over three
dimensions is a dashboard builder over three dimensions.

The queue bug was found by accident and is the more serious of the two changes.

Verified: `sessions.meta` populated end to end against a running binary, the
5KB SDK budget still met (4.12KB gz eager core), and `collector/airgap_test.go`
still passing — no new outbound call.

**Files Modified:**

- `sdk/src/context.ts` - new; collection, viewport banding
- `sdk/src/context.test.ts` - new; fields, banding, no-fingerprint assertion, `context:false`
- `sdk/src/queue.ts` - attach meta to the first batch of a session; **in-flight flush no longer drops events**
- `sdk/src/queue.test.ts` - regression tests for the drop and the retry
- `sdk/src/types.ts`, `sdk/src/core.ts` - the `context` option
- `collector/ingest/events.go` - accept `meta`, forward to `UpsertSession`
- `collector/store/flows.go` - `session` grouping, conditional `LEFT JOIN`, qualified columns
- `collector/store/flows_test.go` - grouping by meta, unknown bucket, missing-key error
- `collector/query/flows.go` - `group=session:<key>`
- `collector/dashboard/ui/src/views/Flows.tsx` - context grouping options, `unknown` label
- `docs/sdk.mdx`, `docs/privacy.mdx`, `claude.md` - the option, the privacy stance, the endpoint table

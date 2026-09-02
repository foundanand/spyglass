# No device, viewport, browser or referrer is recorded at all

> **P1** · sdk + collector · `todo-003`

## Problem

spyglass records _what_ happened and (since flows) _how long it took_. It records
nothing about _where_. A grep across the SDK for every obvious source of context
returns nothing:

```
userAgent · innerWidth · screen.* · referrer · navigator.language · platform
→ no matches in sdk/src
```

Request headers are not recorded either. `sanitizedHeaders()` exists at
`sdk/src/network.ts:63` and is exported at `:257` **but is never called on the
capture path** — safe by accident rather than by design.

And the column that exists for exactly this is never populated.
`collector/ingest/events.go:115`:

```go
_ = h.store.UpsertSession(sid, e.App, e.UserID, e.Ts, e.Ts, nil)
                                                          // ^^^ always nil
```

`sessions.meta` is `TEXT` in the schema, read back into `Session.Meta`, rendered
by the dashboard — and is `NULL` for every row ever written.

## Why it matters

This is the single biggest multiplier on data already being collected. Every
existing metric becomes several:

- "task creation takes 52s" → _on mobile it takes 2m10s_
- "9 errors this week" → _all of them Safari_
- "the invoice form is abandoned 30% of the time" → _45% under 1400px, where the
  line-item grid wraps_

Without it, `group=user` and `group=day` are the only two axes that exist. That
is also why this should land **before** the custom-dashboard work ([005](./005-saved-views-and-custom-dashboards.md)):
a dashboard builder over data with three dimensions is a dashboard builder over
three dimensions.

The support case is just as strong. "It's broken on my machine" is unanswerable
today; the replay shows the DOM but not the viewport it was rendered at.

## Approach

Capture once at `init()`, attach to the session rather than to every event — this
is per-session context, and repeating it on 254 network events would inflate the
store for nothing.

Candidate fields, all cheap and all available synchronously:

| Field          | Source                                             | Why                                                          |
| -------------- | -------------------------------------------------- | ------------------------------------------------------------ |
| `viewport_w/h` | `innerWidth/Height`                                | The one that actually explains layout bugs                   |
| `screen_w/h`   | `screen.width/height`                              | Distinguishes a small window from a small device             |
| `dpr`          | `devicePixelRatio`                                 | Retina vs not                                                |
| `ua`           | `navigator.userAgent`                              | Raw; parse server-side or in the dashboard, never in the SDK |
| `language`     | `navigator.language`                               |                                                              |
| `tz`           | `Intl.DateTimeFormat().resolvedOptions().timeZone` | Reads timestamps correctly                                   |
| `referrer`     | `document.referrer`                                | Only meaningful on first pageview                            |
| `connection`   | `navigator.connection?.effectiveType`              | Explains slow flows; not in Safari                           |

Ship it on the **first** event of a session — either as a `props` blob on a
synthetic `session_start` event, or as a new optional `meta` field on the ingest
envelope that the handler forwards into `UpsertSession`. The second is cleaner
(the column is already there and already plumbed to the dashboard) and costs one
optional field on the wire.

Then make it queryable. The `group=prop:<key>` machinery from the flows endpoint
is the obvious model — extend grouping to session meta so
`group=session:viewport_w` works, or denormalise the few fields worth slicing by
onto events. Decide before building; the query shape is the hard part, not the
capture.

Viewport should probably also update on resize, or at least record the value at
each pageview — a session that starts maximised and ends in a split pane is one
session with two answers.

### Privacy

This is the first thing spyglass would record that a user did not do
deliberately. It stays defensible because none of it is an identifier — but:

- **No fingerprinting surface.** No canvas, no font enumeration, no WebGL, no
  plugin list. Coarse, useful, boring fields only.
- **No IP address.** The collector must not start logging or storing it.
- A `context: false` config to switch the whole thing off, for the air-gapped
  deployments this project targets.
- The air-gap guarantee is untouched — all of this goes to the operator's own
  collector, as everything else does.

## Acceptance

- A session row carries populated `meta` after the first event.
- At least one dashboard view slices by one of these fields — viewport bucket is
  the most useful first cut.
- `context: false` records none of it, and a test asserts that.
- No new outbound call; `collector/airgap_test.go` still passes.
- The SDK core stays inside its 5KB gzipped budget (currently ~1.7KB).

## Files

- `sdk/src/context.ts` — new, collection
- `sdk/src/core.ts` / `types.ts` — the `context` option
- `sdk/src/queue.ts` or `capture.ts` — attach to the first flush of a session
- `collector/ingest/events.go` — accept and forward `meta`
- `collector/store/store.go` — grouping by session meta
- `collector/query/…` — expose it
- `collector/dashboard/ui/src/views/` — at least one slice
- `docs/sdk.mdx`, `docs/privacy.mdx`, `README.md`

## Open questions

- **Session meta vs event props.** Meta is smaller and matches the existing
  schema; props make every event independently sliceable without a join. Meta
  first, denormalise later if the queries get ugly.
- **Parse the UA where?** In the dashboard is cheapest and keeps the raw string
  intact. A Go parser in the collector is a dependency this project would rather
  not take.
- **Does viewport belong on the session or the pageview?** It changes mid-session.
  Pageview is more accurate and more rows.

## Effort

**M.** Capture is an afternoon. Making it _queryable_ — deciding the grouping
model and wiring it end to end — is the real work.

# The funnel counts who reached a step, never how long it took

> **P2** · collector · `todo-007`

## Problem

`Store.Funnel` (`collector/store/store.go`) walks each user's events in time order and counts how many reached step _i_. It
returns `[]FunnelStep{Name, Count}` — no timing at all.

So a funnel can tell you 30 people viewed, 12 added, 5 checked out. It cannot
tell you the drop happened because step 2 takes four minutes.

Flows now measure duration, but only for spans an app explicitly wrapped in
`startFlow`/`endFlow`. A funnel is derived from events that already exist and
needs no instrumentation — which is exactly why it is the right place to find a
slow step you didn't know to measure.

## Why it matters

Counts localise a problem to a step; durations explain it. Having built the
duration machinery for flows, the funnel is the obvious second consumer — the
timestamps are already in the rows being walked.

There is also a real difference between the two that is worth keeping: a flow is
a deliberate, client-timed span with an explicit outcome. A funnel step gap is
inferred from whatever events happened to be emitted. The inferred one is noisier
(it includes lunch breaks) but free.

## Approach

The walk in `Funnel` already has each matching event's user and name in time
order. Add the timestamp to the scan and accumulate, per step transition, the
elapsed time from the previous step for users who made it. Report p50 and p90
per transition alongside the count — reuse `percentile()` and the summarising
shape from `collector/store/flows.go` rather than writing a second one.

```json
{
  "steps": [
    { "name": "view", "count": 30 },
    { "name": "cart", "count": 12, "from_prev": { "p50_ms": 8200, "p90_ms": 41000 } },
    { "name": "checkout", "count": 5, "from_prev": { "p50_ms": 96000, "p90_ms": 380000 } }
  ]
}
```

The lunch-break problem needs a decision. An inferred gap has no upper bound —
someone who starts on Friday and finishes on Monday contributes 72 hours.
Options: a `maxStepMs` parameter that excludes gaps beyond it from the timing
(but still counts the conversion), or lean on p50 and simply never report a mean.
Both; the flow timeout precedent (`DEFAULT_FLOW_TIMEOUT_MS`) argues for an
explicit cap with a sane default.

The funnel is currently "good enough" by explicit design (`CLAUDE.md`, and the
doc comment says so). Adding timing should not turn it into a general sequence
engine — no fan-out, no per-step windows beyond the cap, no branching.

## Acceptance

- The funnel response carries p50/p90 per step transition.
- A gap longer than the cap is excluded from timing but still counted as a
  conversion — with a test that pins exactly that.
- The existing count semantics are unchanged; existing tests pass untouched.
- The dashboard funnel builder shows the timing under each step.

## Files

- `collector/store/store.go` — `Funnel()` and its result type
- `collector/store/store_test.go` — timing cases, cap behaviour
- `collector/query/funnel.go` — the `maxStepMs` param
- `collector/query/query_test.go`
- `collector/dashboard/ui/src/views/Insights.tsx` — the funnel builder
- `docs/api.mdx`

## Open questions

- Default cap. 30 minutes matches the flow timeout and the session idle window,
  which is a defensible symmetry. But a funnel legitimately spans days
  (sign-up → first invoice), so a cap tuned for a single sitting may be wrong
  here. Possibly no default, timing only reported when a cap is supplied.
- Should the response also report _time to convert overall_ (first step to last)
  rather than only per-transition? Cheap to add during the same walk.

## Effort

**S–M.** The walk already exists; this is accumulation plus a decision about the
cap.

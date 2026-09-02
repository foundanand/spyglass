# User Traits — Slicing by Cohort Instead of by Person

### Added

- **`user.traits`** (`todo-006`) — queryable cohort attributes on the identity:

  ```ts
  spyglass.init({
    user: { id: "PARV0004", traits: { role: "Partner", team: "audit", admin: false } },
  });
  spyglass.setUser({ id: "PARV0004", traits: { role: "Manager" } });
  ```

- **`group=trait:<key>`** and **`trait=<key>:<value>`** filtering on
  `/v1/query/flows`, plus a "per user trait…" option in the dashboard's flow
  panel. Measured end to end:

  ```
  group=trait:role
    Partner    p50 = 21,000ms   n=3
    Employee   p50 = 62,000ms   n=3
  ```

### Changed

- **Traits ride in the existing session `meta` blob rather than a new table.**
  The backlog left this open — a `users` table holding current values, or traits
  stamped per event — and noted that if session context (`todo-003`) landed
  first, one mechanism might serve both.

  It does, and better than either option on offer. No migration, no second
  storage shape, no parallel grouping syntax: `trait:<key>` is `session:<key>`
  reading under `$.traits`. It also delivers the _historically honest_ behaviour
  for free — the option the backlog assumed was the expensive one. A task filed
  while someone was an Employee stays attributed that way, and promoting them
  does not rewrite the past.

  The trade is that there is no single "current value" per user to query
  directly. That has not been needed yet, and the sessions carry it.

- **`context: false` no longer suppresses traits.** The switch is about what the
  SDK observes on its own; traits are declared by the host app. Session meta is
  re-sent when a trait changes, so `setUser` promoting someone takes effect
  without waiting for a new session.

### Security

- Trait keys are bound as JSON paths and never reach the SQL text, for grouping
  and filtering alike. Tested with `') UNION SELECT`, `'; DROP TABLE events; --`
  and friends: each is inert, and the events table survives intact.

- **Traits are narrowed to scalars in the SDK.** Strings, numbers, booleans and
  `null` are kept; objects, arrays and functions are dropped rather than
  serialised, so a whole user record cannot be parked in there by accident. At
  most 24 traits, keys to 40 characters, string values truncated at 120.

  That enforces shape, not judgement, and the docs say so plainly: traits
  describe a **cohort, never a person** — role, team, plan, tenure bucket, not
  email, not phone, not a client name.

---

## Summary of Changes

`group=user` gives one row per person. On a 40-person firm that is a readable
table; on a 200-person one it is noise. More importantly it produces the wrong
kind of statement: "PARV0004 is slow at this" is a performance review of a
person, and an awkward thing to put in front of a manager. "Employees are slower
at this than Partners, so the form assumes knowledge they don't have" is a
finding about the software. Which of those a tool produces determines whether
people are comfortable having it installed at all.

**Files Modified:**

- `sdk/src/types.ts` - `UserTraits`, `user.traits`
- `sdk/src/context.ts` - `sanitizeTraits()`: scalar-only, capped
- `sdk/src/queue.ts` - traits in `meta`, re-sent when they change
- `sdk/src/context.test.ts` - sanitising, wire shape, `context:false`, `setUser` re-send
- `collector/store/flows.go` - `trait` grouping and `Traits` filtering, shared session join
- `collector/store/flows_test.go` - grouping, filtering, and SQL-injection cases
- `collector/query/flows.go` - `group=trait:<key>`, repeatable `?trait=k:v`
- `collector/dashboard/ui/src/views/Flows.tsx` - "per user trait…" grouping
- `docs/sdk.mdx`, `docs/privacy.mdx`, `docs/api.mdx` - the option, the stance, the endpoint

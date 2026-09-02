# Cannot slice by anything about the user beyond their id

> **P2** · sdk + collector · `todo-006`

## Problem

The SDK takes `user: { id, name?, email? }` and nothing else. `name` and `email`
are display strings — they are not queryable dimensions, and nothing in the
collector groups by them.

So questions of the form "is this slower for _this kind of user_" cannot be
asked. In the Parshvm integration, the natural ones are:

- Do Partners file tasks faster than Employees? (`employeeLevel` is known at
  init and thrown away)
- Do admins hit more errors, because they reach screens nobody else does?
- Is the invoice flow slower for people who joined this quarter?

The workaround today is to attach the attribute to every event as a prop and
group by `prop:role` — which works, but means every call site has to remember to
pass it, and it is stored redundantly on every row.

## Why it matters

`group=user` gives one row per person. On a 40-person firm that is a readable
table; on a 200-person one it is noise. Grouping by _role_, _team_ or _tenure_ is
what turns a list into a finding.

It is also the difference between "PARV0004 is slow at this" — which is an
awkward thing to put in front of a manager — and "Employees are slower at this
than Partners, so the form assumes knowledge they don't have", which is a
product insight about the software rather than a performance review of a person.
That framing matters for whether people are comfortable having the tool at all.

## Approach

Extend the identity to carry arbitrary scalar traits:

```ts
spyglass.init({
  user: { id: "PARV0004", name: "…", traits: { role: "Partner", admin: false } },
});
spyglass.setUser({ id, traits: { role: "Manager" } }); // traits update too
```

Store them where they can be grouped by. Two shapes:

- **A `users` table** (`user_id, app, traits JSON, updated_at`) holding the
  _current_ value. Simple, small, and answers "how do Partners behave" — but
  rewrites history when someone is promoted.
- **Traits stamped on the event** at capture time. Bigger, but historically
  honest: a task filed while they were an Employee stays attributed that way.

For a behavioural tool, current-value is usually what people mean and is far
cheaper. Start there; note the limitation in the docs.

Then extend grouping — `group=trait:role` alongside the existing
`group=prop:<key>` — and add filtering, since "flows for Employees only" is as
useful as grouping by role. The prop-grouping machinery in
`collector/store/flows.go` is the template, including binding the key as a JSON
path so a trait name can never reach the SQL text.

### Privacy

Traits are the easiest place for someone to put something they should not.
Document hard: **scalars that describe a cohort, never anything identifying, and
never anything sensitive.** Role, team, plan, tenure bucket — not email, not
phone, not a client name. Consider a size cap and a scalar-only type, the way the
Parshvm integration narrowed its own `AnalyticsProps`.

## Acceptance

- `traits` survive `init` and `setUser`, and are queryable.
- `group=trait:<key>` works on the flows endpoint.
- A filter (`trait:role=Partner`) narrows a query.
- A hostile trait key cannot alter the SQL — same test as
  `TestFlowsPropKeyCannotInjectSQL`.
- Docs state plainly that traits hold the current value and rewrite history.

## Files

- `sdk/src/types.ts`, `sdk/src/core.ts`, `sdk/src/capture.ts`
- `collector/store/migrations/00N_user_traits.sql`
- `collector/store/users.go`, `collector/store/flows.go`
- `collector/query/flows.go`, `collector/query/users.go`
- `collector/dashboard/ui/src/views/Flows.tsx` — trait in the grouping picker
- `docs/sdk.mdx`, `docs/privacy.mdx`

## Open questions

- Current-value vs point-in-time. Start current; the migration to historical is
  additive later if anyone actually needs it.
- Do traits deserve their own table, or is this session `meta`
  ([003](./003-device-and-environment-context.md)) with a different name? If 003
  lands first, check whether one mechanism serves both — a `session.meta` blob
  holding device _and_ traits, with one grouping syntax, is a smaller surface
  than two parallel systems.

## Effort

**M**, and meaningfully smaller if 003 has already built the grouping path.

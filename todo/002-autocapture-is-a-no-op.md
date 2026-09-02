# `autocapture` is documented, typed, defaulted — and unimplemented

> **P0** · sdk · `todo-002`

## Problem

`autocapture` is a config option that does nothing. Every reference to it in the
entire codebase:

```
sdk/src/types.ts:22   /** Enable autocapture of clicks + form changes. Default: false */
sdk/src/types.ts:23   autocapture?: boolean;
sdk/src/core.ts:15    autocapture: false,
sdk/src/index.ts:2    // comment mentioning it
```

There is no `sdk/src/autocapture.ts`. Nothing reads `cfg.autocapture`. Setting it
to `true` type-checks, runs without error, and captures nothing.

It is also advertised as working:

- `docs/sdk.mdx` config table: "Record all clicks + form changes. Lazy-loaded;
  zero bytes when off."
- `tasks/p4-sdk-autocapture/` describes the intended behaviour in detail.

## Why it matters

A config option that silently does nothing is worse than a missing feature. The
missing feature is discoverable; this one costs somebody an afternoon of "why is
my dashboard empty" before they read the source. It also undermines the rest of
the config, which is otherwise honest.

Right now every non-automatic event has to be hand-written at a call site. That
is arguably the right default — hand-declared events are the ones that mean
something, and the Parshvm integration deliberately declares all of its — but the
choice should be stated, not faked.

## Approach

Two honest options. Pick one; do not leave it as it is.

**A — Delete it.** Remove the field, the default, the docs row, and the task
folder. Add a line to the docs saying autocapture is deliberately out of scope:
recording every click produces a haystack, and the project's whole premise is
that a small closed-loop app should record deliberate, named things plus full
replay. Replay already captures every interaction visually, which is most of what
autocapture is wanted for.

**B — Implement it,** to the brief already written in
`tasks/p4-sdk-autocapture/task.md`: a lazily-imported module, delegate-listening
on `click` (selector, trimmed innerText, coordinates) and `change` on form
controls (**field name only, never values**), loaded only when the flag is on so
it costs zero bytes when off.

If B, the privacy line needs to be explicit and tested: `maskInputs` governs
replay, and it must not be possible for autocapture to become a side channel that
records the values replay is masking.

**Recommendation: A.** Replay plus named events already covers it, the SDK has a
5KB gzipped budget to protect, and every autocapture implementation eventually
becomes a selector-maintenance problem. But it is a product call, not a technical
one.

## Acceptance

**If A:** no mention of `autocapture` survives outside the changelog; the docs
say why; `tasks/p4-sdk-autocapture` is removed or marked `wontfix`.

**If B:** `autocapture: false` (the default) leaves the module out of the loaded
bundle entirely — assert on the built output, not just behaviour. `autocapture:
true` records clicks and form _changes_ with no field values. A test proves a
masked input's value never appears in any emitted event.

## Files

- `sdk/src/types.ts`, `sdk/src/core.ts`, `sdk/src/index.ts`
- `docs/sdk.mdx` — the config table row
- `README.md` — check for mentions
- `tasks/p4-sdk-autocapture/` — remove or resolve
- `sdk/src/autocapture.ts` + test — only under option B

## Open questions

- Is autocapture wanted at all, given replay records every interaction visually?
  The answer decides A vs B and nothing else in this file matters until it is
  settled.

## Effort

**A: XS.** **B: M** — and it carries ongoing maintenance that A does not.

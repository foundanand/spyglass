# A freshly started collector gives no clue what to do next

> **P3** · dashboard · `todo-016`

## Problem

Start the collector, open the dashboard, and every view is empty with a terse
line: "no sessions yet", "no activity yet", "no captured events". All accurate,
none actionable.

Nothing on the screen says the collector is working, that it is waiting for an
SDK to post, what the app slug and key need to match, or how to check that the
CSP is not silently swallowing every request.

That last one matters more than it sounds. The single most likely reason a new
install shows nothing is a `connect-src` that does not include the collector
origin — the browser blocks every POST with **no console error and no failed
request the app can see**. The integration checklist in the README calls this out
as the first thing that bites real apps. The dashboard, which is where somebody
will be looking when it happens, says "no activity yet".

## Why it matters

First-run is where a self-hosted tool is abandoned. Someone has already done the
hard part — run a binary or a container, write a config, wire an SDK — and the
payoff screen is indistinguishable from a broken install. There is no support
channel to ask, and no error to search for.

The fix is small and one-time: turn the empty state into the last step of setup.

## Approach

Detect genuine emptiness — no events for this app, ever — and replace the generic
empty state with a short setup panel. Not a wizard; a checklist that answers "why
is this empty".

Worth showing:

- **The collector is running**, with its version and configured app slugs. Proves
  the half the operator controls is fine.
- **The snippet to paste**, pre-filled with the actual configured `endpoint` and
  app slug from the running config, so it cannot be mistyped.
- **The CSP line**, pre-filled with this collector's own origin —
  `connect-src 'self' http://localhost:7475` — because that is the most common
  failure and it is invisible from the app side.
- **A "waiting for first event" indicator** that resolves itself the moment one
  arrives, so the operator gets immediate confirmation rather than reloading.

Distinguish the two empty cases. "No events ever" is a setup problem and deserves
the panel. "No events in the selected window" (once
[004](./004-dashboard-time-range.md) lands) is a normal state and should just say
so and offer a wider range — showing setup instructions to someone with three
months of data would be worse than the current terse line.

The config the panel needs — listen address, app slugs, version — is already in
memory in the collector. A tiny `GET /v1/meta` returning app slugs and version,
behind the dashboard password, is enough. It must **not** return app keys: the
dashboard password and the ingest keys are separate credentials on purpose.

## Acceptance

- A collector with zero events shows setup guidance including a copy-pasteable
  snippet with the real endpoint and slug.
- The CSP line is shown with this collector's actual origin.
- The panel disappears on its own when the first event lands, without a reload.
- A collector with data but an empty _window_ shows a normal empty state, never
  the setup panel.
- No endpoint exposes an app key.

## Files

- `collector/query/meta.go` — new, small
- `collector/server.go` — the route, password-gated
- `collector/dashboard/ui/src/views/Setup.tsx` — new
- `collector/dashboard/ui/src/App.tsx` — route to it when genuinely empty
- `docs/getting-started.mdx` — should match the panel exactly

## Open questions

- Where does the panel live — its own route, or inline in whichever view the
  user landed on? Inline is friendlier; a route is easier to link to from docs.
- Should it self-test? A button that POSTs a synthetic event from the dashboard's
  own origin would prove the ingest path independently of the host app's CSP —
  helpful, but it puts a write path in the dashboard, which has so far been
  strictly read-only. Probably not worth the precedent.

## Effort

**S–M.** Mostly copywriting and one small endpoint.

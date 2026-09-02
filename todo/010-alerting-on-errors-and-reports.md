# Nothing tells you something broke; you have to go look

> **P3** · collector · `todo-010`

## Problem

spyglass is entirely pull. A bug report submitted at 2am sits in SQLite until
somebody opens the dashboard. A new error type spiking across every session is
invisible until noticed.

The README is honest about this — the Slack webhook and the LLM incident summary
are described as "off by default and not yet implemented", and that is accurate:
neither exists in any form.

## Why it matters

For a 20–200 user internal tool, the realistic failure mode is not a monitoring
gap, it is that nobody opens the dashboard for a fortnight. A single message when
a user files a bug report closes the loop between "someone hit a problem" and
"someone knows", which is most of the value of having bug reports at all.

The incident view is described as the killer feature. It is only killer if
somebody is looking at it, and today nothing ever makes them look.

## Approach

Narrow. Two triggers, not a rules engine:

1. A new `bug_report` arrives.
2. An error signature crosses a threshold — first-ever occurrence, or N in M
   minutes.

One outbound POST to a configured URL with a small JSON body and a deep link to
the incident view. Slack-shaped by default because that is the common case, but a
plain webhook so anything can receive it.

```json
{ "webhooks": { "on_bug_report": "env:SG_WEBHOOK", "on_new_error": "env:SG_WEBHOOK" } }
```

Off unless configured, and `env:` support already exists.

### The air-gap constraint is the hard part

This is the first deliberate outbound call the collector would ever make, and
`collector/airgap_test.go` fails the build on exactly that. The guard is not an
obstacle to route around — it is the feature. So:

- The call must carry an inline `// airgap:allow <reason>` marker, which is the
  documented escape hatch and makes the exception reviewable rather than
  accidental.
- It must be **impossible when unconfigured** — not "disabled by default" but
  structurally absent, so an air-gapped operator cannot enable egress by
  fat-fingering a config key.
- The README's air-gap section needs updating to say precisely what can now
  leave, under what condition. That section is a promise; it has to stay exact.
- Point it at an in-enclave endpoint and the guarantee holds — worth documenting
  as the intended pattern.

Delivery should be best-effort and never block ingest: fire-and-forget with a
timeout, log failures, no retry queue. A collector that stalls because Slack is
slow is a worse outcome than a missed notification.

Deduplicate. "N in M minutes" must not become N messages.

## Acceptance

- With no webhook configured, no outbound call is possible and the air-gap test
  passes unmodified.
- With one configured, a bug report produces one message containing a working
  incident link.
- A burst of the same error produces one message, not one per event.
- A slow or dead webhook endpoint does not delay or fail `POST /v1/events` — test
  with a hanging receiver.
- README air-gap section updated to describe the exception precisely.

## Files

- `collector/config.go` — `webhooks` block
- `collector/notify/` — new package, with the `airgap:allow` marker
- `collector/ingest/events.go` — the trigger hook
- `collector/airgap_test.go` — the allowed exception
- `README.md` — air-gap section
- `docs/configuration.mdx`, `docs/deployment.mdx`

## Open questions

- Error-signature grouping. There is dedup in the SDK (5s, `message::source`) but
  nothing server-side. "New error type" needs a stable signature — message plus
  source is probably enough, but stack-frame normalisation may be needed for
  minified builds.
- Does the LLM incident summary belong in the same item? It shares the egress
  problem and nothing else. Keep it separate; it is a much bigger scope
  conversation and a much weaker fit for an air-gapped tool.

## Effort

**M.** The code is small. Getting the air-gap story right, and the docs that go
with it, is the majority of the work.

# Webhook Alerting — the Collector's Only Egress

### Added

- **`webhooks` config** (`todo-010`) — two triggers, not a rules engine:

  ```json
  {
    "webhooks": {
      "on_bug_report": "env:SG_WEBHOOK",
      "on_new_error": "env:SG_WEBHOOK",
      "dashboard_url": "https://spyglass.internal"
    }
  }
  ```

  A bug report arriving, or an error signature seen for the first time in 15
  minutes. One small JSON body with a Slack-compatible `text` field alongside
  structured `kind`/`app`/`user`/`name`/`incident_url` — Slack-shaped because
  that is the common case, a plain webhook so anything can receive it.

  Verified end to end: one bug report plus a burst of **20 identical errors
  produced exactly 2 messages**, each carrying a working incident deep link.

- **`collector/notify`**, and `Store.LatestEventID` to resolve the incident link
  without reshaping the batch-insert hot path.

### Security

**This is the first outbound call the collector has ever made**, and the air-gap
guarantee is a promise rather than a nice-to-have, so the exception is
constructed to stay honest:

- **Unconfigured means no egress is possible — structurally, not by a flag.**
  `notify.New` returns `nil` when no URL is set, and a nil `*Notifier`'s methods
  do nothing. There is no `enabled` boolean to fat-finger: no URL, no notifier,
  no code path that can dial out.
- **The one call carries `// airgap:allow`.** Confirmed this is load-bearing
  rather than decorative by deleting the marker and watching
  `TestNoAccidentalOutboundInCollector` fail on `notify/notify.go:213`, then
  pass again once restored. Every other outbound call still fails the build.
- **The collector logs `webhooks: enabled` at startup**, so whether a deployment
  can talk to anything is visible from the logs alone.
- **Webhook URLs resolve through `env:`.** A Slack URL is a bearer token in
  practice and should not sit in a committed config file.
- **Point it at an in-enclave receiver and the air gap holds.** Documented as
  the intended pattern; pointing it at a public host is called out as a
  deliberate decision to send bug report text outside the network.

### Changed

- README's air-gap section now states the exception precisely — what leaves,
  under what condition, and what still cannot — rather than describing the
  webhook as "not yet implemented". `docs/configuration.mdx` gains a `webhooks`
  section with the same warning.

---

## Summary of Changes

For a 20–200 user internal tool the realistic failure mode is not a monitoring
gap, it is that nobody opens the dashboard for a fortnight. The incident view is
the product's best feature and it is worth nothing if nothing makes a person go
and look.

Delivery is fire-and-forget with a 5s timeout and no retry queue, because a
collector that stalls because Slack is slow is a worse outcome than a missed
notification. Tested against both a hanging receiver and a dead port: ingest
returns 204 in under a millisecond either way and the events are still stored.

**Files Modified:**

- `collector/notify/notify.go` - new; the notifier, dedup window, the marked call
- `collector/notify/notify_test.go` - new; nil-when-unconfigured, burst dedup, hanging and dead receivers
- `collector/config.go` - `webhooks` block with `env:` resolution
- `collector/server.go` - construct the notifier, log when enabled
- `collector/ingest/events.go` - post-commit trigger that cannot fail ingest
- `collector/ingest/events_test.go` - a hanging webhook must not delay `POST /v1/events`
- `collector/store/store.go` - `LatestEventID` for the incident link
- `README.md`, `docs/configuration.mdx` - the exception, stated exactly

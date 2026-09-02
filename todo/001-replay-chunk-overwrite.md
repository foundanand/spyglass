# Replay chunks overwrite each other across page loads

> **P0** · sdk + collector · `todo-001`

## Problem

A session that spans a full page load silently loses replay data. Chunks are
written to a path derived from a sequence number that resets on every page load,
while the session id does not.

`sdk/src/replay.ts:9`

```ts
let seq = 0; // module state — gone on every full page load
```

`sdk/src/replay.ts:81`

```ts
const chunkSeq = ++seq;
```

`collector/ingest/replay.go:93`

```go
chunkPath := filepath.Join(dir, fmt.Sprintf("%06d.json.gz", seq))
```

The session id comes from `sessionStorage` (`sdk/src/session.ts`) and survives a
reload for 30 minutes. So after a reload the SDK starts again at `seq=1` and the
collector overwrites `000001.json.gz` from before it.

`updateMeta` (`collector/ingest/replay.go:128`) makes it silent: it finds the
existing seq entry and updates its timestamp rather than appending, so the
manifest shrinks to match and nothing anywhere reports a problem.

### Evidence

One real session, `2fc12a07-005b-4a79-a155-b59bf821c885`:

```
sessions.chunk_count           50     (BumpChunkCount, one per accepted POST)
ls data/replays/<sid>/*.gz     18     files
meta.json seqs                 [1..18]  contiguous, no gaps
```

**32 of 50 chunks destroyed.** The replay still plays — it is a composite
stitched from fragments of different page loads, which is why it appears to jump.

## Why it matters

This is the feature the project's pitch rests on: "it records _every_ session
continuously, so 'what happened when the bug occurred' isn't a capture problem."
Right now it is a capture problem, for any session where someone hits reload or
follows a link that isn't a client-side navigation. Server-rendered apps and
multi-page apps lose almost everything.

It also fails in the direction that hides itself: the numbers look bigger than
reality (`chunk_count` counts uploads, not survivors), and the player renders
something, so nobody notices until they compare the two.

## Approach

Make the sequence counter share the lifetime of the session id it is namespaced
under — `sessionStorage`, same as `sdk/src/flow.ts` already does for open flows.

```
sg_replay_seq:<session_id>  →  last used seq
```

Read on the first upload after a load, increment and write on each upload. Keyed
by session id so a new session starts clean rather than inheriting a stale count.
Fall back to module state when storage throws (private mode) — no worse than
today.

Then make the collector refuse to destroy data even if a client gets this wrong:
`O_CREATE|O_EXCL` on the chunk file and a `409` on collision, rather than a
truncating create. A misbehaving or downgraded SDK should cost one dropped chunk,
not a silent overwrite of a good one.

Consider whether `chunk_count` should count accepted writes rather than POSTs, so
the two figures can never disagree again — that disagreement is the only reason
this was caught.

## Acceptance

- A session that reloads mid-recording keeps every chunk: seqs continue across
  the reload, file count equals upload count.
- A unit test asserts the counter survives a simulated reload (fresh module
  state, same `sessionStorage`) — mirror the "survives a navigation within the
  tab" test in `sdk/src/flow.test.ts`.
- A collector test asserts a duplicate seq does **not** truncate the existing
  file.
- Manual: load an app, reload twice, watch the replay through — one continuous
  recording, no jumps at the reload boundaries.

## Files

- `sdk/src/replay.ts` — persist the counter
- `sdk/src/replay.test.ts` — new; there is currently no test file for replay
- `collector/ingest/replay.go` — exclusive create, 409 on collision
- `collector/ingest/replay_test.go` — collision case
- `collector/store/store.go` — possibly `BumpChunkCount` semantics

## Open questions

- Should a colliding chunk be a `409` (client bug, loud) or silently accepted as
  a no-op (resilient)? Loud is better while the SDK and collector version
  together; revisit if they ever drift far apart across an air-gap boundary.
- Does the player handle a genuine gap in the seq sequence, if one is ever
  dropped for real? Worth checking `collector/dashboard/ui/src/views/ReplayPlayer.tsx`
  while in here.

## Effort

**S.** The SDK change is ~15 lines and mirrors existing code. Most of the work is
the two tests and confirming the player is happy.

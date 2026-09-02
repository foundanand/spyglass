# Replay Chunk Integrity, and Cutting `autocapture`

The two P0s from the backlog: one was silently destroying replay data, the other
was a config option that did nothing.

### Fixed

- **Replay chunks no longer overwrite each other across page loads**
  (`todo-001`). The chunk sequence counter lived in module state, which is reset
  by every full page load, while the session id lives in `sessionStorage` and
  survives one. After a reload the SDK restarted at `seq=1` and the collector
  truncated the chunk already at that path.

  It failed in the direction that hides itself: `chunk_count` counted uploads
  rather than survivors, and `updateMeta` found the existing seq entry and
  updated its timestamp in place instead of appending, so the manifest shrank to
  match. The player still rendered something — a composite stitched from
  fragments of different page loads, which is why replays appeared to jump.

  Measured on one real session (`2fc12a07-…`): 50 uploads, 18 files on disk,
  manifest seqs `[1..18]` contiguous. **32 of 50 chunks destroyed.**

  The counter now shares the lifetime of the session id it is namespaced under
  (`sg_replay_seq:<session_id>` in `sessionStorage`), mirroring how
  `sdk/src/flow.ts` keeps open flows. Keyed by session, so a new session starts
  from zero rather than inheriting a stale count, and falling back to module
  state when storage throws — no worse than the old behaviour.

### Changed

- **The collector refuses to destroy a replay chunk.** Chunk files are created
  with `O_CREATE|O_EXCL` and a duplicate `seq` is rejected with **409** instead
  of truncating what is already there. A client that gets its sequencing wrong
  now costs one dropped chunk, loudly, rather than a silent overwrite of a good
  one. A partial write is removed rather than left behind.

- **`sessions.chunk_count` counts accepted writes, not POSTs.** Rejected
  duplicates return before the bump, so the count can never again disagree with
  the files on disk — that disagreement is the only reason this bug was caught.

### Removed

- **`autocapture` (`todo-002`).** The option was typed, defaulted, and
  documented as working, but no `sdk/src/autocapture.ts` ever existed and
  nothing read `cfg.autocapture`. Setting it to `true` type-checked, ran without
  error, and captured nothing.

  Cut rather than built. Replay already captures every interaction visually, and
  explicit `capture()` calls plus automatic pageviews record the interactions
  that carry meaning; blanket DOM scraping on top of that produces a haystack —
  thousands of `clicked div.sc-a7f2` rows to search — while widening what leaves
  the page. It also costs bytes against a 5KB gzipped budget.

  The docs now say so under "There is no autocapture" rather than describing a
  feature that was never there.

### Breaking Changes

- `autocapture` is no longer a valid `init()` option. TypeScript will now reject
  it. It never did anything, so removing it changes no runtime behaviour — but a
  config passing it will need the line deleted.

---

## Summary of Changes

`todo-001` is the more serious of the two: the project's pitch is that it records
every session continuously, so "what happened when the bug occurred" is a query
rather than a capture problem. For any session that crossed a full page load it
was a capture problem, and worst for exactly the server-rendered and multi-page
apps that reload most.

`todo-002` is smaller but the same category of defect — the system stating
something untrue about itself. A config option that silently does nothing is
worse than a missing feature, because the missing feature is discoverable.

**Files Modified:**

- `sdk/src/replay.ts` - `nextSeq()` backed by `sessionStorage`, keyed by session id
- `sdk/src/replay.test.ts` - new; counter survives a simulated reload, 50 uploads → 50 distinct seqs
- `collector/ingest/replay.go` - exclusive create, 409 on duplicate seq, bump only on accepted writes
- `collector/ingest/replay_test.go` - a duplicate seq must not truncate, and `chunk_count` must match disk
- `sdk/src/types.ts`, `sdk/src/core.ts`, `sdk/src/core.test.ts`, `sdk/src/index.ts`, `sdk/build.ts` - `autocapture` removed
- `docs/sdk.mdx`, `docs/privacy.mdx` - config row removed; non-goal documented with its reasoning
- `claude.md`, `CONTRIBUTING.md` - §2 non-goals and §5 internals updated to match
- `collector/query/incidents.go`, `collector/query/query_test.go` - pre-existing `gofmt` drift

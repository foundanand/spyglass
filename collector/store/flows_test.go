package store_test

import (
	"testing"

	"github.com/foundanand/spyglass/collector/store"
)

// flowEvent builds one `flow` event as the SDK emits it.
func flowEvent(ts int64, app, user, name string, durationMs int, outcome string, extra map[string]interface{}) store.Event {
	props := map[string]interface{}{"duration_ms": durationMs, "outcome": outcome}
	for k, v := range extra {
		props[k] = v
	}
	return store.Event{
		Ts: ts, App: app, UserID: user, SessionID: "s-" + user,
		Type: "flow", Name: name, Props: props,
	}
}

func seedFlows(t *testing.T, st *store.Store) {
	t.Helper()
	// Ts values are real unix-ms so date() grouping produces sane days.
	// 2026-01-01T00:00:00Z = 1767225600000, +1 day = 1767312000000.
	const day1 = int64(1767225600000)
	const day2 = int64(1767312000000)

	events := []store.Event{
		// task.create — five completions (1s…5s), one abandon, one failure.
		flowEvent(day1+1, "parshvm", "alice", "task.create", 1000, "completed", map[string]interface{}{"clients": 1}),
		flowEvent(day1+2, "parshvm", "alice", "task.create", 2000, "completed", map[string]interface{}{"clients": 1}),
		flowEvent(day1+3, "parshvm", "bob", "task.create", 3000, "completed", map[string]interface{}{"clients": 5}),
		flowEvent(day2+4, "parshvm", "bob", "task.create", 4000, "completed", map[string]interface{}{"clients": 5}),
		flowEvent(day2+5, "parshvm", "bob", "task.create", 5000, "completed", map[string]interface{}{"clients": 5}),
		flowEvent(day2+6, "parshvm", "bob", "task.create", 9000, "abandoned", nil),
		flowEvent(day2+7, "parshvm", "bob", "task.create", 8000, "failed", nil),

		// A second flow, and one belonging to another app.
		flowEvent(day1+8, "parshvm", "alice", "invoice.create", 20000, "completed", nil),
		flowEvent(day1+9, "other", "carol", "task.create", 99000, "completed", nil),

		// Noise the aggregate must ignore.
		{Ts: day1 + 10, App: "parshvm", UserID: "alice", SessionID: "s1", Type: "event", Name: "task.create"},
		{Ts: day1 + 11, App: "parshvm", UserID: "alice", SessionID: "s1", Type: "flow", Name: "broken",
			Props: map[string]interface{}{"outcome": "completed"}}, // no duration_ms
	}
	if err := st.InsertEvents(events); err != nil {
		t.Fatal(err)
	}
}

// find returns the stat for a name/group pair.
func find(stats []store.FlowStat, name, group string) *store.FlowStat {
	for i := range stats {
		if stats[i].Name == name && stats[i].Group == group {
			return &stats[i]
		}
	}
	return nil
}

func TestFlowsUngrouped(t *testing.T) {
	st := openTestStore(t)
	seedFlows(t, st)

	stats, err := st.Flows(store.FlowQuery{App: "parshvm"})
	if err != nil {
		t.Fatalf("Flows: %v", err)
	}

	tc := find(stats, "task.create", "")
	if tc == nil {
		t.Fatal("no task.create row")
	}
	if tc.Completions != 5 {
		t.Errorf("completions = %d, want 5", tc.Completions)
	}
	if tc.Abandons != 1 || tc.Failures != 1 {
		t.Errorf("abandons/failures = %d/%d, want 1/1", tc.Abandons, tc.Failures)
	}
	// Durations describe completed runs only: 1000..5000.
	if tc.P50 != 3000 {
		t.Errorf("p50 = %d, want 3000", tc.P50)
	}
	if tc.Mean != 3000 {
		t.Errorf("mean = %d, want 3000", tc.Mean)
	}
	if tc.Min != 1000 || tc.Max != 5000 {
		t.Errorf("min/max = %d/%d, want 1000/5000", tc.Min, tc.Max)
	}
	if tc.TotalMs != 15000 {
		t.Errorf("total = %d, want 15000", tc.TotalMs)
	}
	// 1 abandon out of 7 attempts.
	if tc.AbandonRate != 0.1429 {
		t.Errorf("abandon rate = %v, want 0.1429", tc.AbandonRate)
	}

	if find(stats, "invoice.create", "") == nil {
		t.Error("invoice.create missing")
	}
	if find(stats, "broken", "") != nil {
		t.Error("a flow event with no duration_ms must be ignored")
	}
}

func TestFlowsExcludesOtherApps(t *testing.T) {
	st := openTestStore(t)
	seedFlows(t, st)

	stats, err := st.Flows(store.FlowQuery{App: "parshvm", Name: "task.create"})
	if err != nil {
		t.Fatal(err)
	}
	if len(stats) != 1 {
		t.Fatalf("got %d rows, want 1", len(stats))
	}
	if stats[0].Max == 99000 {
		t.Error("the other app's 99s run leaked into parshvm's stats")
	}
}

func TestFlowsGroupByUser(t *testing.T) {
	st := openTestStore(t)
	seedFlows(t, st)

	stats, err := st.Flows(store.FlowQuery{
		App: "parshvm", Name: "task.create",
		GroupBy: store.FlowGroupBy{Kind: "user"},
	})
	if err != nil {
		t.Fatal(err)
	}

	alice := find(stats, "task.create", "alice")
	bob := find(stats, "task.create", "bob")
	if alice == nil || bob == nil {
		t.Fatalf("want rows for alice and bob, got %+v", stats)
	}
	// Alice's completed runs are 1000 and 2000; nearest-rank p50 of two samples
	// is the lower one, and the mean sits between them.
	if alice.Completions != 2 || alice.P50 != 1000 || alice.Mean != 1500 {
		t.Errorf("alice = %d completions p50 %d mean %d, want 2 / 1000 / 1500",
			alice.Completions, alice.P50, alice.Mean)
	}
	if bob.Completions != 3 || bob.Abandons != 1 {
		t.Errorf("bob = %d completions %d abandons, want 3 / 1", bob.Completions, bob.Abandons)
	}
	// Busiest group first.
	if stats[0].Group != "bob" {
		t.Errorf("first row group = %q, want bob (most attempts)", stats[0].Group)
	}
}

func TestFlowsGroupByDay(t *testing.T) {
	st := openTestStore(t)
	seedFlows(t, st)

	stats, err := st.Flows(store.FlowQuery{
		App: "parshvm", Name: "task.create",
		GroupBy: store.FlowGroupBy{Kind: "day"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(stats) != 2 {
		t.Fatalf("got %d day rows, want 2: %+v", len(stats), stats)
	}
	d1 := find(stats, "task.create", "2026-01-01")
	if d1 == nil || d1.Completions != 3 {
		t.Errorf("2026-01-01 = %+v, want 3 completions", d1)
	}
}

func TestFlowsGroupByProp(t *testing.T) {
	st := openTestStore(t)
	seedFlows(t, st)

	stats, err := st.Flows(store.FlowQuery{
		App: "parshvm", Name: "task.create",
		GroupBy: store.FlowGroupBy{Kind: "prop", PropKey: "clients"},
	})
	if err != nil {
		t.Fatal(err)
	}

	one := find(stats, "task.create", "1")
	five := find(stats, "task.create", "5")
	if one == nil || five == nil {
		t.Fatalf("want rows grouped by the clients prop, got %+v", stats)
	}
	if one.Completions != 2 {
		t.Errorf("clients=1 completions = %d, want 2", one.Completions)
	}
	if five.Completions != 3 {
		t.Errorf("clients=5 completions = %d, want 3", five.Completions)
	}
	// The abandon/failure rows carry no clients prop, so they bucket under "".
	if none := find(stats, "task.create", ""); none == nil || none.Abandons != 1 {
		t.Errorf("rows without the prop should bucket under the empty group, got %+v", none)
	}
}

func TestFlowsGroupByPropNeedsKey(t *testing.T) {
	st := openTestStore(t)
	if _, err := st.Flows(store.FlowQuery{GroupBy: store.FlowGroupBy{Kind: "prop"}}); err == nil {
		t.Error("expected an error when prop grouping has no key")
	}
}

func TestFlowsPropKeyCannotInjectSQL(t *testing.T) {
	st := openTestStore(t)
	seedFlows(t, st)

	// The key is bound as a json path argument, never concatenated into SQL.
	stats, err := st.Flows(store.FlowQuery{
		App: "parshvm", Name: "task.create",
		GroupBy: store.FlowGroupBy{Kind: "prop", PropKey: "x'); DROP TABLE events; --"},
	})
	if err != nil {
		t.Fatalf("a hostile prop key should aggregate to nothing, not error: %v", err)
	}
	if len(stats) == 0 {
		t.Fatal("expected the rows to still be there, bucketed under an empty group")
	}
	if _, err := st.QueryEvents(store.EventQuery{}); err != nil {
		t.Fatalf("events table gone: %v", err)
	}
}

func TestFlowsTimeWindow(t *testing.T) {
	st := openTestStore(t)
	seedFlows(t, st)

	const day2 = int64(1767312000000)
	stats, err := st.Flows(store.FlowQuery{App: "parshvm", Name: "task.create", From: day2})
	if err != nil {
		t.Fatal(err)
	}
	if len(stats) != 1 || stats[0].Completions != 2 {
		t.Fatalf("day-2 window = %+v, want 2 completions", stats)
	}
}

func TestFlowsEmpty(t *testing.T) {
	st := openTestStore(t)
	stats, err := st.Flows(store.FlowQuery{App: "parshvm"})
	if err != nil {
		t.Fatal(err)
	}
	if len(stats) != 0 {
		t.Errorf("got %d rows from an empty store, want 0", len(stats))
	}
}

func TestFlowsLimit(t *testing.T) {
	st := openTestStore(t)
	seedFlows(t, st)

	stats, err := st.Flows(store.FlowQuery{App: "parshvm", Limit: 1})
	if err != nil {
		t.Fatal(err)
	}
	if len(stats) != 1 {
		t.Fatalf("got %d rows, want 1", len(stats))
	}
	if stats[0].Name != "task.create" {
		t.Errorf("kept %q, want the busiest flow task.create", stats[0].Name)
	}
}

func TestFlowNames(t *testing.T) {
	st := openTestStore(t)
	seedFlows(t, st)

	names, err := st.FlowNames("parshvm", 0, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(names) == 0 || names[0].Name != "task.create" {
		t.Fatalf("names = %+v, want task.create first", names)
	}
	for _, n := range names {
		if n.Name == "click" {
			t.Error("a non-flow event name leaked into FlowNames")
		}
	}
}

func TestFlowPercentiles(t *testing.T) {
	st := openTestStore(t)

	// 1..100 ms, so the nearest-rank percentiles are exact and obvious.
	var events []store.Event
	for i := 1; i <= 100; i++ {
		events = append(events, flowEvent(int64(1767225600000+i), "p", "u", "f", i, "completed", nil))
	}
	if err := st.InsertEvents(events); err != nil {
		t.Fatal(err)
	}

	stats, err := st.Flows(store.FlowQuery{App: "p"})
	if err != nil {
		t.Fatal(err)
	}
	got := stats[0]
	for _, tc := range []struct {
		label string
		got   int64
		want  int64
	}{
		{"p50", got.P50, 50},
		{"p90", got.P90, 90},
		{"p95", got.P95, 95},
		{"min", got.Min, 1},
		{"max", got.Max, 100},
	} {
		if tc.got != tc.want {
			t.Errorf("%s = %d, want %d", tc.label, tc.got, tc.want)
		}
	}
}

func TestFlowsSingleSample(t *testing.T) {
	st := openTestStore(t)
	if err := st.InsertEvents([]store.Event{
		flowEvent(1767225600000, "p", "u", "f", 250, "completed", nil),
	}); err != nil {
		t.Fatal(err)
	}

	stats, err := st.Flows(store.FlowQuery{App: "p"})
	if err != nil {
		t.Fatal(err)
	}
	// Every percentile of one observation is that observation.
	s := stats[0]
	if s.P50 != 250 || s.P90 != 250 || s.P95 != 250 || s.Mean != 250 {
		t.Errorf("single sample summarised as %+v", s)
	}
}

func TestFlowsAllAbandoned(t *testing.T) {
	st := openTestStore(t)
	if err := st.InsertEvents([]store.Event{
		flowEvent(1767225600000, "p", "u", "f", 500, "abandoned", nil),
		flowEvent(1767225600001, "p", "u", "f", 700, "abandoned", nil),
	}); err != nil {
		t.Fatal(err)
	}

	stats, err := st.Flows(store.FlowQuery{App: "p"})
	if err != nil {
		t.Fatal(err)
	}
	s := stats[0]
	if s.Completions != 0 || s.Abandons != 2 {
		t.Fatalf("got %+v", s)
	}
	if s.AbandonRate != 1 {
		t.Errorf("abandon rate = %v, want 1", s.AbandonRate)
	}
	// No completed run means no duration to report — not a zero that reads as "instant".
	if s.P50 != 0 || s.Mean != 0 || s.TotalMs != 0 {
		t.Errorf("durations should be absent for an all-abandoned flow: %+v", s)
	}
}

// Session context is the axis that turns "task.create takes 52s" into "on
// mobile it takes 2m10s". Flows from sessions with no context row must still be
// counted, bucketed as unknown rather than dropped.
func TestFlowsGroupBySessionMeta(t *testing.T) {
	st := openTestStore(t)

	if err := st.UpsertSession("s-mobile", "demo", "u1", 1000, 1000,
		map[string]interface{}{"viewport_bucket": "mobile", "ua": "Safari"}); err != nil {
		t.Fatal(err)
	}
	if err := st.UpsertSession("s-desktop", "demo", "u2", 1000, 1000,
		map[string]interface{}{"viewport_bucket": "desktop", "ua": "Chrome"}); err != nil {
		t.Fatal(err)
	}
	// Deliberately no meta: an older SDK, or context:false.
	if err := st.UpsertSession("s-nometa", "demo", "u3", 1000, 1000, nil); err != nil {
		t.Fatal(err)
	}

	mk := func(sid string, ms int) store.Event {
		return store.Event{
			Ts: 1000, App: "demo", UserID: "u", SessionID: sid, Type: "flow", Name: "task.create",
			Props: map[string]interface{}{"duration_ms": ms, "outcome": "completed"},
		}
	}
	if err := st.InsertEvents([]store.Event{
		mk("s-mobile", 130_000), mk("s-mobile", 130_000),
		mk("s-desktop", 52_000), mk("s-desktop", 52_000),
		mk("s-nometa", 60_000),
	}); err != nil {
		t.Fatal(err)
	}

	rows, err := st.Flows(store.FlowQuery{
		Name:    "task.create",
		GroupBy: store.FlowGroupBy{Kind: "session", PropKey: "viewport_bucket"},
	})
	if err != nil {
		t.Fatal(err)
	}

	got := map[string]int64{}
	total := 0
	for _, r := range rows {
		got[r.Group] = r.P50
		total += r.Completions
	}
	if total != 5 {
		t.Errorf("counted %d completed runs, want 5 — a session without meta must not be dropped", total)
	}
	if got["mobile"] != 130_000 {
		t.Errorf("mobile p50 = %d, want 130000", got["mobile"])
	}
	if got["desktop"] != 52_000 {
		t.Errorf("desktop p50 = %d, want 52000", got["desktop"])
	}
	if _, ok := got[""]; !ok {
		t.Errorf("session without meta should bucket under \"\", got groups %v", got)
	}

	// A meta key nobody set groups everything as unknown rather than erroring.
	none, err := st.Flows(store.FlowQuery{
		GroupBy: store.FlowGroupBy{Kind: "session", PropKey: "no_such_key"},
	})
	if err != nil {
		t.Fatalf("unknown meta key should not error: %v", err)
	}
	if len(none) != 1 || none[0].Group != "" {
		t.Errorf("unknown meta key: got %+v, want one unknown bucket", none)
	}

	if _, err := st.Flows(store.FlowQuery{GroupBy: store.FlowGroupBy{Kind: "session"}}); err == nil {
		t.Error("group by session with no key should error")
	}
}

func TestFlowsGroupByTraitAndFilter(t *testing.T) {
	st := openTestStore(t)

	seed := func(sid, user, role string, durations ...int) {
		t.Helper()
		if err := st.UpsertSession(sid, "demo", user, 1000, 1000, map[string]interface{}{
			"viewport_bucket": "desktop",
			"traits":          map[string]interface{}{"role": role, "admin": role == "Partner"},
		}); err != nil {
			t.Fatal(err)
		}
		var evs []store.Event
		for _, ms := range durations {
			evs = append(evs, store.Event{
				Ts: 1000, App: "demo", UserID: user, SessionID: sid, Type: "flow", Name: "task.file",
				Props: map[string]interface{}{"duration_ms": ms, "outcome": "completed"},
			})
		}
		if err := st.InsertEvents(evs); err != nil {
			t.Fatal(err)
		}
	}

	seed("s1", "alice", "Partner", 20_000, 22_000, 21_000)
	seed("s2", "bob", "Employee", 60_000, 65_000, 62_000)
	seed("s3", "carol", "Employee", 58_000)

	rows, err := st.Flows(store.FlowQuery{
		Name:    "task.file",
		GroupBy: store.FlowGroupBy{Kind: "trait", PropKey: "role"},
	})
	if err != nil {
		t.Fatal(err)
	}

	byRole := map[string]store.FlowStat{}
	for _, r := range rows {
		byRole[r.Group] = r
	}
	if byRole["Partner"].Completions != 3 || byRole["Employee"].Completions != 4 {
		t.Fatalf("completions by role = %+v", byRole)
	}
	// The finding this exists for: a statement about the software, not a person.
	if byRole["Partner"].P50 >= byRole["Employee"].P50 {
		t.Errorf("Partner p50 %d should be below Employee p50 %d",
			byRole["Partner"].P50, byRole["Employee"].P50)
	}

	// Filtering narrows to one cohort.
	filtered, err := st.Flows(store.FlowQuery{
		Name:   "task.file",
		Traits: map[string]string{"role": "Employee"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(filtered) != 1 || filtered[0].Completions != 4 {
		t.Errorf("trait filter = %+v, want one row of 4 completions", filtered)
	}

	// Two traits must both match.
	both, err := st.Flows(store.FlowQuery{
		Name:   "task.file",
		Traits: map[string]string{"role": "Partner", "admin": "1"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(both) != 1 || both[0].Completions != 3 {
		t.Errorf("two-trait filter = %+v, want Partner's 3 completions", both)
	}

	none, err := st.Flows(store.FlowQuery{
		Name:   "task.file",
		Traits: map[string]string{"role": "Nobody"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(none) != 0 {
		t.Errorf("filter matching nothing = %+v, want no rows", none)
	}

	if _, err := st.Flows(store.FlowQuery{GroupBy: store.FlowGroupBy{Kind: "trait"}}); err == nil {
		t.Error("group by trait with no key should error")
	}
}

// A trait key is bound as a JSON path and must never reach the SQL text.
func TestFlowsTraitKeyCannotInjectSQL(t *testing.T) {
	st := openTestStore(t)

	if err := st.UpsertSession("s1", "demo", "u1", 1000, 1000, map[string]interface{}{
		"traits": map[string]interface{}{"role": "Partner"},
	}); err != nil {
		t.Fatal(err)
	}
	if err := st.InsertEvents([]store.Event{{
		Ts: 1000, App: "demo", UserID: "u1", SessionID: "s1", Type: "flow", Name: "f",
		Props: map[string]interface{}{"duration_ms": 100, "outcome": "completed"},
	}}); err != nil {
		t.Fatal(err)
	}

	hostile := []string{
		`role') UNION SELECT 1,2,3,4 --`,
		`role'; DROP TABLE events; --`,
		`*`,
		`role" OR "1"="1`,
	}
	for _, key := range hostile {
		if _, err := st.Flows(store.FlowQuery{
			GroupBy: store.FlowGroupBy{Kind: "trait", PropKey: key},
		}); err != nil {
			t.Errorf("hostile trait key %q errored (%v); it should be inert, not fatal", key, err)
		}
		if _, err := st.Flows(store.FlowQuery{Traits: map[string]string{key: "x"}}); err != nil {
			t.Errorf("hostile trait filter key %q errored: %v", key, err)
		}
	}

	// The table is still there and still has its row.
	after, err := st.QueryEvents(store.EventQuery{Limit: 10})
	if err != nil {
		t.Fatalf("events table damaged: %v", err)
	}
	if len(after) != 1 {
		t.Errorf("expected the events table intact with 1 row, got %d", len(after))
	}
}

// The drill-down that makes "every number has a watchable session behind it"
// true: from a p90, reach the sessions that produced it.
func TestFlowSessionsSlowestFirst(t *testing.T) {
	st := openTestStore(t)

	mk := func(sid, user string, ms int, outcome string) store.Event {
		return store.Event{
			Ts: 1000, App: "demo", UserID: user, SessionID: sid, Type: "flow", Name: "task.create",
			Props: map[string]interface{}{"duration_ms": ms, "outcome": outcome},
		}
	}
	if err := st.InsertEvents([]store.Event{
		mk("s-fast", "alice", 1_000, "completed"),
		mk("s-mid", "bob", 50_000, "completed"),
		mk("s-slow", "carol", 200_000, "completed"),
		mk("s-gaveup", "dave", 90_000, "abandoned"),
		// Sessionless (server-side) runs have no recording to reach.
		{Ts: 1000, App: "demo", UserID: "cron", SessionID: "", Type: "flow", Name: "task.create",
			Props: map[string]interface{}{"duration_ms": 999_999, "outcome": "completed"}},
	}); err != nil {
		t.Fatal(err)
	}

	got, err := st.FlowSessions(store.FlowSessionQuery{Name: "task.create"})
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 4 {
		t.Fatalf("got %d runs, want 4 (the sessionless one is excluded): %+v", len(got), got)
	}
	if got[0].SessionID != "s-slow" || got[0].DurationMs != 200_000 {
		t.Errorf("first row = %+v, want the slowest", got[0])
	}
	for i := 1; i < len(got); i++ {
		if got[i-1].DurationMs < got[i].DurationMs {
			t.Errorf("rows are not slowest-first: %+v", got)
			break
		}
	}

	// "Sessions above p90" is expressed as a minimum duration.
	slow, err := st.FlowSessions(store.FlowSessionQuery{Name: "task.create", MinDurationMs: 60_000})
	if err != nil {
		t.Fatal(err)
	}
	if len(slow) != 2 {
		t.Errorf("min duration filter returned %d rows, want 2", len(slow))
	}

	// "Sessions where it was abandoned".
	gaveUp, err := st.FlowSessions(store.FlowSessionQuery{Name: "task.create", Outcome: "abandoned"})
	if err != nil {
		t.Fatal(err)
	}
	if len(gaveUp) != 1 || gaveUp[0].SessionID != "s-gaveup" {
		t.Errorf("abandoned filter = %+v", gaveUp)
	}

	if _, err := st.FlowSessions(store.FlowSessionQuery{}); err == nil {
		t.Error("a nameless flow query should error rather than scan everything")
	}
}

// A p50 and p90 hide a bimodal distribution; a histogram shows it.
func TestFlowHistogramBuckets(t *testing.T) {
	st := openTestStore(t)

	var evs []store.Event
	add := func(ms, n int) {
		for i := 0; i < n; i++ {
			evs = append(evs, store.Event{
				Ts: 1000, App: "demo", UserID: "u", SessionID: "s", Type: "flow", Name: "f",
				Props: map[string]interface{}{"duration_ms": ms, "outcome": "completed"},
			})
		}
	}
	add(150, 5)       // 100–250ms
	add(1_500, 3)     // 1s–2s
	add(75_000, 2)    // 60s–120s
	add(5_000_000, 1) // past the last edge → open-ended bucket
	// An abandoned run is not a measurement of how long the action takes.
	evs = append(evs, store.Event{
		Ts: 1000, App: "demo", UserID: "u", SessionID: "s", Type: "flow", Name: "f",
		Props: map[string]interface{}{"duration_ms": 150, "outcome": "abandoned"},
	})
	if err := st.InsertEvents(evs); err != nil {
		t.Fatal(err)
	}

	buckets, err := st.FlowHistogram("f", "", 0, 0)
	if err != nil {
		t.Fatal(err)
	}

	total := 0
	byLabel := map[string]int{}
	for _, b := range buckets {
		total += b.Count
		if b.Count > 0 {
			byLabel[b.Label] = b.Count
		}
	}
	if total != 11 {
		t.Errorf("bucketed %d runs, want 11 completed (the abandoned one excluded)", total)
	}
	if len(byLabel) != 4 {
		t.Errorf("expected 4 populated buckets, got %v", byLabel)
	}
	if buckets[len(buckets)-1].Count != 1 {
		t.Errorf("the final bucket must be open-ended and hold the 5,000,000ms run: %+v", buckets[len(buckets)-1])
	}
	if buckets[len(buckets)-1].MaxMs != -1 {
		t.Errorf("final bucket MaxMs = %d, want -1 (open-ended)", buckets[len(buckets)-1].MaxMs)
	}
}

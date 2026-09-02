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

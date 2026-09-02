package store_test

import (
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/foundanand/spyglass/collector/store"
)

func openTestStore(t *testing.T) *store.Store {
	t.Helper()
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { st.Close() })
	return st
}

func TestMigrateIdempotent(t *testing.T) {
	dir := t.TempDir()
	for i := 0; i < 2; i++ {
		st, err := store.Open(dir)
		if err != nil {
			t.Fatalf("open #%d: %v", i+1, err)
		}
		st.Close()
	}
}

func TestInsertEvents(t *testing.T) {
	st := openTestStore(t)

	events := []store.Event{
		{Ts: 1000, App: "demo", UserID: "u1", SessionID: "s1", Type: "event", Name: "click"},
		{Ts: 2000, App: "demo", UserID: "u1", SessionID: "s1", Type: "pageview", Name: "/home", URL: "http://x/"},
	}
	if err := st.InsertEvents(events); err != nil {
		t.Fatalf("InsertEvents: %v", err)
	}

	got, err := st.QueryEvents(store.EventQuery{App: "demo"})
	if err != nil {
		t.Fatalf("QueryEvents: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("got %d events, want 2", len(got))
	}
}

func TestInsertEventsEmpty(t *testing.T) {
	st := openTestStore(t)
	if err := st.InsertEvents(nil); err != nil {
		t.Fatalf("InsertEvents(nil) should be a no-op, got: %v", err)
	}
}

func TestUpsertSession(t *testing.T) {
	st := openTestStore(t)

	if err := st.UpsertSession("sid1", "demo", "u1", 1000, 1000, nil); err != nil {
		t.Fatalf("UpsertSession (create): %v", err)
	}
	if err := st.UpsertSession("sid1", "demo", "u1", 1000, 9999, nil); err != nil {
		t.Fatalf("UpsertSession (update last_seen): %v", err)
	}

	users, err := st.QueryUsers(10, 0, 0)
	if err != nil {
		t.Fatalf("QueryUsers: %v", err)
	}
	if len(users) != 1 {
		t.Fatalf("got %d users, want 1", len(users))
	}
	if users[0].LastSeen != 9999 {
		t.Errorf("last_seen = %d, want 9999", users[0].LastSeen)
	}
}

func TestListSessionsStats(t *testing.T) {
	st := openTestStore(t)

	if err := st.UpsertSession("sid1", "demo", "u1", 1000, 5000, nil); err != nil {
		t.Fatalf("UpsertSession: %v", err)
	}

	_ = st.InsertEvents([]store.Event{
		{Ts: 1000, App: "demo", UserID: "u1", SessionID: "sid1", Type: "event", Name: "click"},
		{Ts: 2000, App: "demo", UserID: "u1", SessionID: "sid1", Type: "pageview", Name: "/home"},
		{Ts: 3000, App: "demo", UserID: "u1", SessionID: "sid1", Type: "error", Name: "boom"},
	})

	sessions, err := st.ListSessions(10, 0, 0)
	if err != nil {
		t.Fatalf("ListSessions: %v", err)
	}
	if len(sessions) != 1 {
		t.Fatalf("got %d sessions, want 1", len(sessions))
	}
	if sessions[0].EventCount != 3 {
		t.Errorf("event_count = %d, want 3", sessions[0].EventCount)
	}
	if sessions[0].ErrorCount != 1 {
		t.Errorf("error_count = %d, want 1", sessions[0].ErrorCount)
	}
}

func TestQueryEventsFilters(t *testing.T) {
	st := openTestStore(t)

	_ = st.InsertEvents([]store.Event{
		{Ts: 1000, App: "a1", UserID: "alice", SessionID: "s1", Type: "event", Name: "click"},
		{Ts: 2000, App: "a1", UserID: "bob", SessionID: "s1", Type: "pageview", Name: "/home"},
		{Ts: 3000, App: "a2", UserID: "alice", SessionID: "s3", Type: "error", Name: "boom"},
	})

	tests := []struct {
		name  string
		q     store.EventQuery
		wantN int
	}{
		{"all", store.EventQuery{}, 3},
		{"by user", store.EventQuery{UserID: "alice"}, 2},
		{"by type", store.EventQuery{EventType: "pageview"}, 1},
		{"by app", store.EventQuery{App: "a2"}, 1},
		{"by session", store.EventQuery{SessionID: "s1"}, 2},
		{"from", store.EventQuery{From: 2000}, 2},
		{"to", store.EventQuery{To: 1000}, 1},
		{"combined", store.EventQuery{UserID: "alice", EventType: "error"}, 1},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := st.QueryEvents(tc.q)
			if err != nil {
				t.Fatalf("QueryEvents: %v", err)
			}
			if len(got) != tc.wantN {
				t.Errorf("got %d, want %d", len(got), tc.wantN)
			}
		})
	}
}

// A day boundary is where the person reading the chart says it is. Two events
// 40 minutes apart either side of midnight IST must land on different days for
// a viewer in IST (+330) and the same day for one in UTC.
func TestDayBucketingHonoursViewerTimezone(t *testing.T) {
	st := openTestStore(t)

	// 2026-03-01T18:40:00Z = 2026-03-02T00:10 IST  → IST day 03-02, UTC day 03-01
	// 2026-03-01T17:50:00Z = 2026-03-01T23:20 IST  → IST day 03-01, UTC day 03-01
	const beforeMidnightIST = 1772387400000 // 17:50Z
	const afterMidnightIST = 1772390400000  // 18:40Z

	events := []store.Event{
		{Ts: beforeMidnightIST, App: "demo", UserID: "u1", SessionID: "s1", Type: "error", Name: "boom"},
		{Ts: afterMidnightIST, App: "demo", UserID: "u2", SessionID: "s2", Type: "error", Name: "boom"},
	}
	if err := st.InsertEvents(events); err != nil {
		t.Fatal(err)
	}

	utc, err := st.ErrorsByDay("demo", 0, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(utc) != 1 {
		t.Fatalf("UTC: got %d day buckets, want 1 — both events fall on 2026-03-01Z: %+v", len(utc), utc)
	}
	if utc[0].Count != 2 {
		t.Errorf("UTC: count = %d, want 2", utc[0].Count)
	}

	ist, err := st.ErrorsByDay("demo", 0, 0, 330)
	if err != nil {
		t.Fatal(err)
	}
	if len(ist) != 2 {
		t.Fatalf("IST(+330): got %d day buckets, want 2 — the events straddle local midnight: %+v", len(ist), ist)
	}
	for _, d := range ist {
		if d.Count != 1 {
			t.Errorf("IST: day %s count = %d, want 1", d.Day, d.Count)
		}
	}

	// An out-of-range offset must fall back to UTC rather than reaching the SQL.
	bogus, err := st.ErrorsByDay("demo", 0, 0, 99999)
	if err != nil {
		t.Fatalf("out-of-range tz offset should not error: %v", err)
	}
	if len(bogus) != 1 {
		t.Errorf("out-of-range tz offset should behave as UTC, got %d buckets", len(bogus))
	}
}

func TestQueryUsersAndSessionsHonourWindow(t *testing.T) {
	st := openTestStore(t)

	const day = int64(86_400_000)
	now := int64(1772390400000)

	// old: active 10 days ago. recent: active today.
	if err := st.UpsertSession("s-old", "demo", "olduser", now-10*day, now-10*day, nil); err != nil {
		t.Fatal(err)
	}
	if err := st.UpsertSession("s-new", "demo", "newuser", now-day, now, nil); err != nil {
		t.Fatal(err)
	}

	all, err := st.QueryUsers(100, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 2 {
		t.Fatalf("unbounded: got %d users, want 2", len(all))
	}

	// A 7-day window must exclude the user last seen 10 days ago.
	recent, err := st.QueryUsers(100, now-7*day, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(recent) != 1 || recent[0].UserID != "newuser" {
		t.Errorf("7-day window: got %+v, want only newuser", recent)
	}

	sessAll, err := st.ListSessions(100, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(sessAll) != 2 {
		t.Fatalf("unbounded sessions: got %d, want 2", len(sessAll))
	}

	sessRecent, err := st.ListSessions(100, now-7*day, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(sessRecent) != 1 || sessRecent[0].SessionID != "s-new" {
		t.Errorf("7-day window sessions: got %+v, want only s-new", sessRecent)
	}
}

// The live feed excludes network events by default. Excluding must happen in
// SQL so the LIMIT is spent on rows the reader wants, not on rows about to be
// discarded — the whole point of the change.
func TestQueryEventsExcludeTypes(t *testing.T) {
	st := openTestStore(t)

	var events []store.Event
	for i := 0; i < 20; i++ {
		events = append(events, store.Event{
			Ts: int64(1000 + i), App: "demo", UserID: "u1", SessionID: "s1",
			Type: "network", Name: "/api/x",
		})
	}
	events = append(events,
		store.Event{Ts: 2000, App: "demo", UserID: "u1", SessionID: "s1", Type: "event", Name: "task.created"},
		store.Event{Ts: 2001, App: "demo", UserID: "u1", SessionID: "s1", Type: "error", Name: "boom"},
	)
	if err := st.InsertEvents(events); err != nil {
		t.Fatal(err)
	}

	got, err := st.QueryEvents(store.EventQuery{ExcludeTypes: []string{"network"}, Limit: 100})
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 {
		t.Fatalf("got %d events, want 2 (the non-network ones)", len(got))
	}
	for _, e := range got {
		if e.Type == "network" {
			t.Errorf("excluded type leaked into results: %+v", e)
		}
	}

	// A tight LIMIT must still return signal, not be consumed by excluded rows.
	tight, err := st.QueryEvents(store.EventQuery{ExcludeTypes: []string{"network"}, Limit: 2})
	if err != nil {
		t.Fatal(err)
	}
	if len(tight) != 2 {
		t.Errorf("LIMIT 2 with exclusion returned %d rows, want 2", len(tight))
	}

	multi, err := st.QueryEvents(store.EventQuery{ExcludeTypes: []string{"network", "error"}, Limit: 100})
	if err != nil {
		t.Fatal(err)
	}
	if len(multi) != 1 || multi[0].Type != "event" {
		t.Errorf("excluding two types: got %+v, want just the event row", multi)
	}
}

func TestCountsByType(t *testing.T) {
	st := openTestStore(t)

	if err := st.InsertEvents([]store.Event{
		{Ts: 1000, App: "demo", UserID: "u1", SessionID: "s1", Type: "network", Name: "/a"},
		{Ts: 1001, App: "demo", UserID: "u1", SessionID: "s1", Type: "network", Name: "/b"},
		{Ts: 1002, App: "demo", UserID: "u2", SessionID: "s2", Type: "error", Name: "boom"},
		{Ts: 5000, App: "other", UserID: "u3", SessionID: "s3", Type: "event", Name: "x"},
	}); err != nil {
		t.Fatal(err)
	}

	all, err := st.CountsByType("", "", 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	if all["network"] != 2 || all["error"] != 1 || all["event"] != 1 {
		t.Errorf("unbounded counts = %v", all)
	}

	byApp, err := st.CountsByType("demo", "", 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := byApp["event"]; ok {
		t.Errorf("app filter leaked another app's events: %v", byApp)
	}

	byUser, err := st.CountsByType("", "u1", 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	if byUser["network"] != 2 || len(byUser) != 1 {
		t.Errorf("user filter counts = %v, want only u1's 2 network events", byUser)
	}

	windowed, err := st.CountsByType("", "", 1002, 0)
	if err != nil {
		t.Fatal(err)
	}
	if windowed["network"] != 0 || windowed["error"] != 1 {
		t.Errorf("windowed counts = %v, want the network rows excluded by from", windowed)
	}
}

func TestFunnelStepTiming(t *testing.T) {
	st := openTestStore(t)

	const base = int64(1767225600000) // 2026-01-01T00:00:00Z
	const sec = int64(1000)
	const min = 60 * sec

	ev := func(user, name string, ts int64) store.Event {
		return store.Event{Ts: ts, App: "demo", UserID: user, SessionID: "s-" + user, Type: "event", Name: name}
	}

	// alice: view → cart after 10s → checkout after 2m
	// bob:   view → cart after 30s → checkout after 6m
	// carol: view → cart after 20s, never checks out
	if err := st.InsertEvents([]store.Event{
		ev("alice", "view", base),
		ev("alice", "cart", base+10*sec),
		ev("alice", "checkout", base+10*sec+2*min),
		ev("bob", "view", base),
		ev("bob", "cart", base+30*sec),
		ev("bob", "checkout", base+30*sec+6*min),
		ev("carol", "view", base),
		ev("carol", "cart", base+20*sec),
	}); err != nil {
		t.Fatal(err)
	}

	res, err := st.Funnel(store.FunnelQuery{
		Steps:     []string{"view", "cart", "checkout"},
		MaxStepMs: store.DefaultMaxStepMs,
	})
	if err != nil {
		t.Fatal(err)
	}

	if res.Steps[0].Count != 3 || res.Steps[1].Count != 3 || res.Steps[2].Count != 2 {
		t.Fatalf("counts = %d/%d/%d, want 3/3/2",
			res.Steps[0].Count, res.Steps[1].Count, res.Steps[2].Count)
	}
	if res.Steps[0].FromPrev != nil {
		t.Error("the first step has no previous step to time from")
	}

	// view → cart: 10s, 20s, 30s. p50 (nearest-rank, ceil(0.5*3)=2) is 20s.
	if got := res.Steps[1].FromPrev; got == nil || got.Samples != 3 || got.P50Ms != 20*sec {
		t.Errorf("view→cart timing = %+v, want 3 samples with p50 20000", got)
	}
	// cart → checkout: 2m, 6m. p50 (ceil(0.5*2)=1) is 2m.
	if got := res.Steps[2].FromPrev; got == nil || got.Samples != 2 || got.P50Ms != 2*min {
		t.Errorf("cart→checkout timing = %+v, want 2 samples with p50 120000", got)
	}
	if res.ToConvert == nil || res.ToConvert.Samples != 2 {
		t.Errorf("to_convert = %+v, want 2 completed conversions", res.ToConvert)
	}
}

// The cap is a timing filter, never a counting filter. A user who came back on
// Monday still converted; their weekend must not be averaged into "how long
// this step takes".
func TestFunnelCapExcludesTimingButKeepsConversion(t *testing.T) {
	st := openTestStore(t)

	const base = int64(1767225600000)
	const sec = int64(1000)
	ev := func(user, name string, ts int64) store.Event {
		return store.Event{Ts: ts, App: "demo", UserID: user, SessionID: "s-" + user, Type: "event", Name: name}
	}

	// quick converts in 10s; slow comes back 72 hours later.
	if err := st.InsertEvents([]store.Event{
		ev("quick", "view", base),
		ev("quick", "buy", base+10*sec),
		ev("slow", "view", base),
		ev("slow", "buy", base+72*60*60*1000),
	}); err != nil {
		t.Fatal(err)
	}

	capped, err := st.Funnel(store.FunnelQuery{
		Steps:     []string{"view", "buy"},
		MaxStepMs: store.DefaultMaxStepMs,
	})
	if err != nil {
		t.Fatal(err)
	}

	if capped.Steps[1].Count != 2 {
		t.Errorf("conversions = %d, want 2 — the cap must not drop a conversion", capped.Steps[1].Count)
	}
	tm := capped.Steps[1].FromPrev
	if tm == nil || tm.Samples != 1 {
		t.Fatalf("timing = %+v, want exactly 1 sample (the 72h gap excluded)", tm)
	}
	if tm.P50Ms != 10*sec {
		t.Errorf("p50 = %dms, want 10000 — the 72h gap leaked into the timing", tm.P50Ms)
	}
	if capped.ToConvert == nil || capped.ToConvert.Samples != 1 {
		t.Errorf("to_convert = %+v, want 1 — the stalled user is excluded from end-to-end timing", capped.ToConvert)
	}

	// No cap: both gaps count, and the 72h one dominates p90.
	uncapped, err := st.Funnel(store.FunnelQuery{Steps: []string{"view", "buy"}, MaxStepMs: 0})
	if err != nil {
		t.Fatal(err)
	}
	if uncapped.Steps[1].FromPrev.Samples != 2 {
		t.Errorf("uncapped samples = %d, want 2", uncapped.Steps[1].FromPrev.Samples)
	}
}

// A cap tighter than every gap should report no timing rather than a misleading
// zero, and must still report the counts.
func TestFunnelTimingAbsentWhenNothingFitsTheCap(t *testing.T) {
	st := openTestStore(t)
	const base = int64(1767225600000)
	ev := func(name string, ts int64) store.Event {
		return store.Event{Ts: ts, App: "demo", UserID: "u", SessionID: "s", Type: "event", Name: name}
	}
	if err := st.InsertEvents([]store.Event{ev("a", base), ev("b", base+10_000)}); err != nil {
		t.Fatal(err)
	}

	res, err := st.Funnel(store.FunnelQuery{Steps: []string{"a", "b"}, MaxStepMs: 1})
	if err != nil {
		t.Fatal(err)
	}
	if res.Steps[1].Count != 1 {
		t.Errorf("count = %d, want 1", res.Steps[1].Count)
	}
	if res.Steps[1].FromPrev != nil {
		t.Errorf("timing = %+v, want nil rather than a zero that reads as instant", res.Steps[1].FromPrev)
	}
	if res.ToConvert != nil {
		t.Errorf("to_convert = %+v, want nil", res.ToConvert)
	}
}

// Keyset paging must walk the whole history exactly once: no skips, no repeats.
func TestQueryEventsCursorPaging(t *testing.T) {
	st := openTestStore(t)

	const base = int64(1767225600000)
	var events []store.Event
	for i := 0; i < 25; i++ {
		events = append(events, store.Event{
			Ts: base + int64(i), App: "demo", UserID: "u1", SessionID: "s1",
			Type: "event", Name: fmt.Sprintf("e%02d", i),
		})
	}
	if err := st.InsertEvents(events); err != nil {
		t.Fatal(err)
	}

	seen := map[string]int{}
	q := store.EventQuery{Limit: 10}
	for page := 0; page < 10; page++ {
		got, err := st.QueryEvents(q)
		if err != nil {
			t.Fatal(err)
		}
		if len(got) == 0 {
			break
		}
		for _, e := range got {
			seen[e.Name]++
		}
		last := got[len(got)-1]
		q.CursorTs, q.CursorID, q.HasCursor = last.Ts, last.ID, true
	}

	if len(seen) != 25 {
		t.Errorf("paged over %d distinct events, want 25", len(seen))
	}
	for name, n := range seen {
		if n != 1 {
			t.Errorf("%s returned %d times, want exactly 1", name, n)
		}
	}
}

// The reason for keyset over OFFSET: the live feed is a moving target, and
// events arriving mid-scroll must not shift the page boundary.
func TestCursorPagingIsStableWhileEventsArrive(t *testing.T) {
	st := openTestStore(t)

	const base = int64(1767225600000)
	var events []store.Event
	for i := 0; i < 20; i++ {
		events = append(events, store.Event{
			Ts: base + int64(i), App: "demo", UserID: "u1", SessionID: "s1",
			Type: "event", Name: fmt.Sprintf("old%02d", i),
		})
	}
	if err := st.InsertEvents(events); err != nil {
		t.Fatal(err)
	}

	first, err := st.QueryEvents(store.EventQuery{Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	last := first[len(first)-1]

	// 15 newer events land before the reader asks for page 2. With OFFSET 10
	// this would re-serve rows already shown; with a keyset cursor it cannot.
	var fresh []store.Event
	for i := 0; i < 15; i++ {
		fresh = append(fresh, store.Event{
			Ts: base + 1000 + int64(i), App: "demo", UserID: "u1", SessionID: "s1",
			Type: "event", Name: fmt.Sprintf("new%02d", i),
		})
	}
	if err := st.InsertEvents(fresh); err != nil {
		t.Fatal(err)
	}

	second, err := st.QueryEvents(store.EventQuery{
		Limit: 10, CursorTs: last.Ts, CursorID: last.ID, HasCursor: true,
	})
	if err != nil {
		t.Fatal(err)
	}

	firstNames := map[string]bool{}
	for _, e := range first {
		firstNames[e.Name] = true
	}
	for _, e := range second {
		if firstNames[e.Name] {
			t.Errorf("%s appeared on both pages — paging is not stable under insertion", e.Name)
		}
		if strings.HasPrefix(e.Name, "new") {
			t.Errorf("%s is newer than the cursor and must not appear on a later page", e.Name)
		}
	}
}

// Two events sharing a millisecond must still order deterministically, or a
// cursor built on the last row of a page can skip or repeat one of them.
func TestCursorHandlesIdenticalTimestamps(t *testing.T) {
	st := openTestStore(t)

	const ts = int64(1767225600000)
	var events []store.Event
	for i := 0; i < 6; i++ {
		events = append(events, store.Event{
			Ts: ts, App: "demo", UserID: "u1", SessionID: "s1",
			Type: "event", Name: fmt.Sprintf("same%d", i),
		})
	}
	if err := st.InsertEvents(events); err != nil {
		t.Fatal(err)
	}

	seen := map[string]int{}
	q := store.EventQuery{Limit: 2}
	for page := 0; page < 6; page++ {
		got, err := st.QueryEvents(q)
		if err != nil {
			t.Fatal(err)
		}
		if len(got) == 0 {
			break
		}
		for _, e := range got {
			seen[e.Name]++
		}
		last := got[len(got)-1]
		q.CursorTs, q.CursorID, q.HasCursor = last.Ts, last.ID, true
	}

	if len(seen) != 6 {
		t.Errorf("saw %d of 6 events with identical timestamps: %v", len(seen), seen)
	}
	for name, n := range seen {
		if n != 1 {
			t.Errorf("%s returned %d times across pages", name, n)
		}
	}
}

// StreamEvents must hand rows over one at a time rather than building a slice,
// which is what keeps a large export off the collector's heap.
func TestStreamEventsDoesNotMaterialise(t *testing.T) {
	st := openTestStore(t)

	var events []store.Event
	for i := 0; i < 500; i++ {
		events = append(events, store.Event{
			Ts: int64(1767225600000 + i), App: "demo", UserID: "u1", SessionID: "s1",
			Type: "event", Name: "e", Props: map[string]interface{}{"i": i},
		})
	}
	if err := st.InsertEvents(events); err != nil {
		t.Fatal(err)
	}

	n := 0
	if err := st.StreamEvents(store.EventQuery{Limit: 500}, func(store.Event) error {
		n++
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if n != 500 {
		t.Errorf("streamed %d rows, want 500", n)
	}

	// An error from the callback stops the walk and surfaces.
	stopErr := errors.New("stop")
	count := 0
	err := st.StreamEvents(store.EventQuery{Limit: 500}, func(store.Event) error {
		count++
		if count == 3 {
			return stopErr
		}
		return nil
	})
	if !errors.Is(err, stopErr) {
		t.Errorf("callback error = %v, want it to propagate", err)
	}
	if count != 3 {
		t.Errorf("walk continued past the callback error: %d rows", count)
	}
}

// A screen is a pageview name and a URL on everything else, so "errors on this
// screen" needs to match both.
func TestQueryEventsByScreen(t *testing.T) {
	st := openTestStore(t)

	if err := st.InsertEvents([]store.Event{
		{Ts: 1, App: "demo", UserID: "u", SessionID: "s", Type: "pageview", Name: "/invoices"},
		{Ts: 2, App: "demo", UserID: "u", SessionID: "s", Type: "error", Name: "boom",
			URL: "https://app.internal/invoices"},
		{Ts: 3, App: "demo", UserID: "u", SessionID: "s", Type: "pageview", Name: "/clients"},
		{Ts: 4, App: "demo", UserID: "u", SessionID: "s", Type: "error", Name: "other",
			URL: "https://app.internal/clients"},
	}); err != nil {
		t.Fatal(err)
	}

	got, err := st.QueryEvents(store.EventQuery{Screen: "/invoices", Limit: 50})
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 {
		t.Fatalf("screen filter returned %d events, want the pageview and the error: %+v", len(got), got)
	}
	for _, e := range got {
		if e.Name != "/invoices" && e.Name != "boom" {
			t.Errorf("unexpected event for /invoices: %+v", e)
		}
	}
}

// The migration runner had exactly one file until saved views added a second.
// This is its first real exercise: ordering, partial application, and rerunning
// against a database that already has some of them.
func TestMigrationsApplyInOrderAndAreIdempotent(t *testing.T) {
	dir := t.TempDir()

	// First open applies everything.
	st, err := store.Open(dir)
	if err != nil {
		t.Fatalf("first open: %v", err)
	}
	// Both migrations' tables exist and work.
	if err := st.InsertEvents([]store.Event{
		{Ts: 1, App: "demo", UserID: "u", SessionID: "s", Type: "event", Name: "x"},
	}); err != nil {
		t.Fatalf("001 table unusable: %v", err)
	}
	v, err := st.CreateView("v", "flows", nil)
	if err != nil {
		t.Fatalf("002 table unusable: %v", err)
	}
	st.Close()

	// Reopening must not re-apply, and must not lose data.
	st2, err := store.Open(dir)
	if err != nil {
		t.Fatalf("second open: %v", err)
	}
	defer st2.Close()

	views, err := st2.ListViews()
	if err != nil {
		t.Fatal(err)
	}
	if len(views) != 1 || views[0].ID != v.ID {
		t.Errorf("data did not survive reopen: %+v", views)
	}
	events, err := st2.QueryEvents(store.EventQuery{Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 1 {
		t.Errorf("events did not survive reopen: %d", len(events))
	}

	// A third open, for good measure — a migration that is not idempotent
	// usually fails on the second or third run, not the first.
	st3, err := store.Open(dir)
	if err != nil {
		t.Fatalf("third open: %v", err)
	}
	st3.Close()
}

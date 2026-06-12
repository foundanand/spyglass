package store_test

import (
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

	users, err := st.QueryUsers(10)
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

func TestQueryEventsFilters(t *testing.T) {
	st := openTestStore(t)

	_ = st.InsertEvents([]store.Event{
		{Ts: 1000, App: "a1", UserID: "alice", SessionID: "s1", Type: "event", Name: "click"},
		{Ts: 2000, App: "a1", UserID: "bob", SessionID: "s2", Type: "pageview", Name: "/home"},
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

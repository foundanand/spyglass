package query_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/foundanand/spyglass/collector/query"
	"github.com/foundanand/spyglass/collector/store"
)

func openStore(t *testing.T) *store.Store {
	t.Helper()
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	t.Cleanup(func() { st.Close() })
	return st
}

func seedEvents(t *testing.T, st *store.Store) {
	t.Helper()
	events := []store.Event{
		{Ts: 1000, App: "a", UserID: "alice", SessionID: "s1", Type: "event", Name: "click"},
		{Ts: 2000, App: "a", UserID: "bob", SessionID: "s2", Type: "pageview", Name: "/home"},
		{Ts: 3000, App: "b", UserID: "alice", SessionID: "s3", Type: "error", Name: "boom"},
	}
	if err := st.InsertEvents(events); err != nil {
		t.Fatal(err)
	}
	_ = st.UpsertSession("s1", "a", "alice", 1000, 1000, nil)
	_ = st.UpsertSession("s2", "a", "bob", 2000, 2000, nil)
	_ = st.UpsertSession("s3", "b", "alice", 3000, 3000, nil)
}

func TestQueryEventsHandler(t *testing.T) {
	st := openStore(t)
	seedEvents(t, st)
	h := query.NewEventsHandler(st)

	tests := []struct {
		query  string
		wantN  int
	}{
		{"", 3},
		{"user=alice", 2},
		{"type=pageview", 1},
		{"app=b", 1},
		{"from=2000", 2},
		{"to=1000", 1},
	}

	for _, tc := range tests {
		t.Run(tc.query, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/v1/query/events?"+tc.query, nil)
			rr := httptest.NewRecorder()
			h.ServeHTTP(rr, req)
			if rr.Code != http.StatusOK {
				t.Fatalf("status %d", rr.Code)
			}
			var resp struct {
				Events []store.Event `json:"events"`
			}
			if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
				t.Fatal(err)
			}
			if len(resp.Events) != tc.wantN {
				t.Errorf("got %d events, want %d", len(resp.Events), tc.wantN)
			}
		})
	}
}

func TestQueryUsersHandler(t *testing.T) {
	st := openStore(t)
	seedEvents(t, st)
	h := query.NewUsersHandler(st)

	req := httptest.NewRequest(http.MethodGet, "/v1/query/users", nil)
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status %d", rr.Code)
	}
	var resp struct {
		Users []store.UserSummary `json:"users"`
	}
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatal(err)
	}
	// alice has sessions in apps a and b; bob has one in a → 3 rows
	if len(resp.Users) != 3 {
		t.Errorf("got %d users, want 3", len(resp.Users))
	}
}

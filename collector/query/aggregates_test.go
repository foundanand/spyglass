package query_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/foundanand/spyglass/collector/query"
	"github.com/foundanand/spyglass/collector/store"
)

// day1 and day2 are noon UTC on two consecutive days (unix ms).
const (
	day1 = 1_700_000_000_000 // 2023-11-14
	day2 = day1 + 86_400_000 // 2023-11-15
)

func seedAggregates(t *testing.T, st *store.Store) {
	t.Helper()
	events := []store.Event{
		// day1: alice + bob active; two "click" events, one pageview, one error
		{Ts: day1, App: "a", UserID: "alice", SessionID: "s1", Type: "event", Name: "click"},
		{Ts: day1 + 1, App: "a", UserID: "bob", SessionID: "s2", Type: "event", Name: "click"},
		{Ts: day1 + 2, App: "a", UserID: "alice", SessionID: "s1", Type: "pageview", Name: "/home"},
		{Ts: day1 + 3, App: "a", UserID: "alice", SessionID: "s1", Type: "error", Name: "boom"},
		// day2: only alice active; one "submit" event, one pageview
		{Ts: day2, App: "a", UserID: "alice", SessionID: "s3", Type: "event", Name: "submit"},
		{Ts: day2 + 1, App: "a", UserID: "alice", SessionID: "s3", Type: "pageview", Name: "/home"},
	}
	if err := st.InsertEvents(events); err != nil {
		t.Fatal(err)
	}
}

func TestAggregatesHandler(t *testing.T) {
	st := openStore(t)
	seedAggregates(t, st)
	h := query.NewAggregatesHandler(st)

	req := httptest.NewRequest(http.MethodGet, "/v1/query/aggregates", nil)
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status %d", rr.Code)
	}

	var resp struct {
		DAU         []store.DayCount  `json:"dau"`
		TopEvents   []store.NameCount `json:"top_events"`
		TopPages    []store.NameCount `json:"top_pages"`
		ErrorsByDay []store.DayCount  `json:"errors_by_day"`
	}
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatal(err)
	}

	if len(resp.DAU) != 2 {
		t.Fatalf("DAU: got %d days, want 2", len(resp.DAU))
	}
	if resp.DAU[0].Count != 2 { // day1: alice + bob
		t.Errorf("DAU day1: got %d, want 2", resp.DAU[0].Count)
	}
	if resp.DAU[1].Count != 1 { // day2: alice
		t.Errorf("DAU day2: got %d, want 1", resp.DAU[1].Count)
	}

	// top event is "click" (2), then "submit" (1)
	if len(resp.TopEvents) != 2 || resp.TopEvents[0].Name != "click" || resp.TopEvents[0].Count != 2 {
		t.Errorf("top events wrong: %+v", resp.TopEvents)
	}
	// pageview "/home" appears twice
	if len(resp.TopPages) != 1 || resp.TopPages[0].Name != "/home" || resp.TopPages[0].Count != 2 {
		t.Errorf("top pages wrong: %+v", resp.TopPages)
	}
	// one error, on day1
	if len(resp.ErrorsByDay) != 1 || resp.ErrorsByDay[0].Count != 1 {
		t.Errorf("errors by day wrong: %+v", resp.ErrorsByDay)
	}
}

func TestFunnelHandler(t *testing.T) {
	st := openStore(t)
	// alice: view → cart → checkout (completes all 3)
	// bob:   view → cart            (drops at checkout)
	// carol: view                   (drops at cart)
	events := []store.Event{
		{Ts: 100, App: "a", UserID: "alice", SessionID: "s1", Type: "event", Name: "view"},
		{Ts: 200, App: "a", UserID: "alice", SessionID: "s1", Type: "event", Name: "cart"},
		{Ts: 300, App: "a", UserID: "alice", SessionID: "s1", Type: "event", Name: "checkout"},
		{Ts: 110, App: "a", UserID: "bob", SessionID: "s2", Type: "event", Name: "view"},
		{Ts: 210, App: "a", UserID: "bob", SessionID: "s2", Type: "event", Name: "cart"},
		{Ts: 120, App: "a", UserID: "carol", SessionID: "s3", Type: "event", Name: "view"},
	}
	if err := st.InsertEvents(events); err != nil {
		t.Fatal(err)
	}

	h := query.NewFunnelHandler(st)

	t.Run("three step funnel", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/v1/query/funnel?steps=view,cart,checkout", nil)
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("status %d", rr.Code)
		}
		var resp struct {
			Steps []store.FunnelStep `json:"steps"`
		}
		if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
			t.Fatal(err)
		}
		want := []int{3, 2, 1} // view=3, cart=2, checkout=1
		if len(resp.Steps) != 3 {
			t.Fatalf("got %d steps, want 3", len(resp.Steps))
		}
		for i, w := range want {
			if resp.Steps[i].Count != w {
				t.Errorf("step %d (%s): got %d, want %d", i, resp.Steps[i].Name, resp.Steps[i].Count, w)
			}
		}
	})

	t.Run("rejects single step", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/v1/query/funnel?steps=view", nil)
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, req)
		if rr.Code != http.StatusBadRequest {
			t.Errorf("got %d, want 400", rr.Code)
		}
	})
}

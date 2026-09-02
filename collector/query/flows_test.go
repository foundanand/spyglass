package query_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/foundanand/spyglass/collector/query"
	"github.com/foundanand/spyglass/collector/store"
)

type flowsBody struct {
	Flows []store.FlowStat  `json:"flows"`
	Names []store.NameCount `json:"names"`
}

func seedFlowEvents(t *testing.T, st *store.Store) {
	t.Helper()
	const base = int64(1767225600000) // 2026-01-01T00:00:00Z
	mk := func(ts int64, user, name string, dur int, outcome string) store.Event {
		return store.Event{
			Ts: ts, App: "a", UserID: user, SessionID: "s-" + user,
			Type: "flow", Name: name,
			Props: map[string]interface{}{"duration_ms": dur, "outcome": outcome},
		}
	}
	if err := st.InsertEvents([]store.Event{
		mk(base+1, "alice", "task.create", 1000, "completed"),
		mk(base+2, "alice", "task.create", 3000, "completed"),
		mk(base+3, "bob", "task.create", 5000, "abandoned"),
		mk(base+4, "bob", "invoice.create", 8000, "completed"),
	}); err != nil {
		t.Fatal(err)
	}
}

// getFlows issues a GET and decodes the response.
func getFlows(t *testing.T, h http.Handler, qs string) flowsBody {
	t.Helper()
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/v1/query/flows?"+qs, nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body %q)", rec.Code, rec.Body.String())
	}
	var body flowsBody
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	return body
}

func TestFlowsHandler(t *testing.T) {
	st := openStore(t)
	seedFlowEvents(t, st)
	h := query.NewFlowsHandler(st)

	body := getFlows(t, h, "app=a")
	if len(body.Flows) != 2 {
		t.Fatalf("got %d flows, want 2: %+v", len(body.Flows), body.Flows)
	}
	if len(body.Names) != 2 {
		t.Errorf("names = %+v, want both flow names for the picker", body.Names)
	}

	tc := body.Flows[0]
	if tc.Name != "task.create" {
		t.Fatalf("busiest flow = %q, want task.create", tc.Name)
	}
	if tc.Completions != 2 || tc.Abandons != 1 {
		t.Errorf("task.create = %d completions %d abandons, want 2 / 1", tc.Completions, tc.Abandons)
	}
	if tc.P50 != 1000 {
		t.Errorf("p50 = %d, want 1000", tc.P50)
	}
}

func TestFlowsHandlerFilterByName(t *testing.T) {
	st := openStore(t)
	seedFlowEvents(t, st)
	h := query.NewFlowsHandler(st)

	body := getFlows(t, h, "app=a&name=invoice.create")
	if len(body.Flows) != 1 || body.Flows[0].Name != "invoice.create" {
		t.Fatalf("got %+v, want only invoice.create", body.Flows)
	}
	// The picker still lists every flow, so filtering never strands the UI.
	if len(body.Names) != 2 {
		t.Errorf("names = %+v, want every flow name even when filtered", body.Names)
	}
}

func TestFlowsHandlerGrouping(t *testing.T) {
	st := openStore(t)
	seedFlowEvents(t, st)
	h := query.NewFlowsHandler(st)

	for _, tc := range []struct {
		group     string
		wantRows  int
		wantGroup string
	}{
		{"user", 2, "alice"},
		{"day", 1, "2026-01-01"},
	} {
		body := getFlows(t, h, "app=a&name=task.create&group="+tc.group)
		if len(body.Flows) != tc.wantRows {
			t.Errorf("group=%s gave %d rows, want %d", tc.group, len(body.Flows), tc.wantRows)
			continue
		}
		if body.Flows[0].Group != tc.wantGroup {
			t.Errorf("group=%s first row = %q, want %q", tc.group, body.Flows[0].Group, tc.wantGroup)
		}
	}
}

func TestFlowsHandlerRejectsBadGroup(t *testing.T) {
	st := openStore(t)
	h := query.NewFlowsHandler(st)

	for _, group := range []string{"session", "prop:", "; drop"} {
		rec := httptest.NewRecorder()
		target := "/v1/query/flows?group=" + url.QueryEscape(group)
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, target, nil))
		if rec.Code != http.StatusBadRequest {
			t.Errorf("group=%q status = %d, want 400", group, rec.Code)
		}
	}
}

func TestFlowsHandlerEmptyStore(t *testing.T) {
	st := openStore(t)
	h := query.NewFlowsHandler(st)

	// Empty arrays, never null — a dashboard should not have to null-check.
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/v1/query/flows", nil))
	if got := rec.Body.String(); got != `{"flows":[],"names":[]}`+"\n" {
		t.Errorf("empty body = %q", got)
	}
}

func TestFlowsHandlerMethodNotAllowed(t *testing.T) {
	st := openStore(t)
	h := query.NewFlowsHandler(st)

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/v1/query/flows", nil))
	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("status = %d, want 405", rec.Code)
	}
}

package ingest_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/foundanand/spyglass/collector/ingest"
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

func makeHandler(t *testing.T) http.Handler {
	t.Helper()
	apps := map[string]ingest.AppCfg{
		"demo": {Key: "sg_live_abc", Origins: []string{"http://localhost:3000"}},
	}
	return ingest.NewEventsHandler(openStore(t), apps)
}

func postEvents(t *testing.T, h http.Handler, body interface{}, origin string) *httptest.ResponseRecorder {
	t.Helper()
	b, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, "/v1/events", bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	if origin != "" {
		req.Header.Set("Origin", origin)
	}
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	return rr
}

func TestEventsHappyPath(t *testing.T) {
	h := makeHandler(t)
	rr := postEvents(t, h, map[string]interface{}{
		"app": "demo", "key": "sg_live_abc",
		"events": []map[string]interface{}{
			{"ts": 1000, "user_id": "u1", "session_id": "s1", "type": "event", "name": "click"},
		},
	}, "http://localhost:3000")
	if rr.Code != http.StatusNoContent {
		t.Fatalf("status = %d, body = %s", rr.Code, rr.Body.String())
	}
}

func TestEventsBadKey(t *testing.T) {
	h := makeHandler(t)
	rr := postEvents(t, h, map[string]interface{}{
		"app": "demo", "key": "wrong",
		"events": []map[string]interface{}{},
	}, "")
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rr.Code)
	}
}

func TestEventsUnknownApp(t *testing.T) {
	h := makeHandler(t)
	rr := postEvents(t, h, map[string]interface{}{
		"app": "unknown", "key": "anything",
		"events": []map[string]interface{}{},
	}, "")
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rr.Code)
	}
}

func TestEventsOversizeBody(t *testing.T) {
	h := makeHandler(t)
	big := strings.Repeat("x", 1<<20+1)
	req := httptest.NewRequest(http.MethodPost, "/v1/events", strings.NewReader(big))
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("expected 413, got %d", rr.Code)
	}
}

func TestEventsDisallowedOrigin(t *testing.T) {
	h := makeHandler(t)
	rr := postEvents(t, h, map[string]interface{}{
		"app": "demo", "key": "sg_live_abc",
		"events": []map[string]interface{}{},
	}, "https://evil.example.com")
	if rr.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", rr.Code)
	}
}

func TestEventsPreflightAllowedOrigin(t *testing.T) {
	h := makeHandler(t)
	req := httptest.NewRequest(http.MethodOptions, "/v1/events", nil)
	req.Header.Set("Origin", "http://localhost:3000")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusNoContent {
		t.Fatalf("preflight: expected 204, got %d", rr.Code)
	}
	if rr.Header().Get("Access-Control-Allow-Origin") == "" {
		t.Error("expected CORS header on preflight")
	}
}

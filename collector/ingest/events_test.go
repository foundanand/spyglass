package ingest_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"time"

	"github.com/foundanand/spyglass/collector/ingest"
	"github.com/foundanand/spyglass/collector/notify"
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

// The acceptance criterion for todo-010: a slow or dead webhook must not delay
// or fail POST /v1/events. Ingest is the product; alerting is a courtesy.
func TestSlowWebhookDoesNotDelayIngest(t *testing.T) {
	release := make(chan struct{})
	hook := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		<-release
	}))
	defer hook.Close()
	defer close(release)

	dir := t.TempDir()
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()

	apps := map[string]ingest.AppCfg{"demo": {Key: "sg_test"}}
	h := ingest.NewEventsHandler(st, apps).WithNotifier(notify.New(notify.Config{
		OnBugReport: hook.URL,
		OnNewError:  hook.URL,
	}))

	body := `{"app":"demo","key":"sg_test","events":[
		{"ts":1000,"app":"demo","user_id":"u1","session_id":"s1","type":"bug_report","name":"broken","props":{"comment":"help"}},
		{"ts":1001,"app":"demo","user_id":"u1","session_id":"s1","type":"error","name":"boom","props":{"source":"app.js"}}
	]}`

	start := time.Now()
	req := httptest.NewRequest(http.MethodPost, "/v1/events", strings.NewReader(body))
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	elapsed := time.Since(start)

	if rr.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204 — a webhook must never fail ingest", rr.Code)
	}
	if elapsed > 500*time.Millisecond {
		t.Errorf("ingest took %v with a hanging webhook; it must not wait on delivery", elapsed)
	}

	// And the events are actually stored.
	events, err := st.QueryEvents(store.EventQuery{Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 2 {
		t.Errorf("stored %d events, want 2", len(events))
	}
}

// With no webhook configured there is no notifier at all, and ingest behaves
// exactly as before.
func TestIngestWithoutNotifier(t *testing.T) {
	dir := t.TempDir()
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()

	h := ingest.NewEventsHandler(st, map[string]ingest.AppCfg{"demo": {Key: "sg_test"}})
	body := `{"app":"demo","key":"sg_test","events":[
		{"ts":1000,"app":"demo","user_id":"u1","session_id":"s1","type":"bug_report","name":"broken"}
	]}`
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, httptest.NewRequest(http.MethodPost, "/v1/events", strings.NewReader(body)))
	if rr.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", rr.Code)
	}
}

// A server key is a real secret and may skip the origin check; the browser key
// is public and may not, or the allowlist is decorative.
func TestServerKeyBypassesOriginBrowserKeyDoesNot(t *testing.T) {
	st := openStore(t)
	apps := map[string]ingest.AppCfg{"demo": {
		Key:       "sg_browser",
		ServerKey: "sg_server_secret",
		Origins:   []string{"https://app.internal"},
	}}
	h := ingest.NewEventsHandler(st, apps)

	body := func(key string) string {
		return `{"app":"demo","key":"` + key + `","events":[
			{"ts":1000,"app":"demo","user_id":"worker","session_id":"","type":"event","name":"nightly.import"}
		]}`
	}

	// Server key, no Origin header at all — the curl/cron case.
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, httptest.NewRequest(http.MethodPost, "/v1/events", strings.NewReader(body("sg_server_secret"))))
	if rr.Code != http.StatusNoContent {
		t.Errorf("server key with no Origin: status = %d, want 204", rr.Code)
	}

	// Browser key from a disallowed origin must still be refused.
	req := httptest.NewRequest(http.MethodPost, "/v1/events", strings.NewReader(body("sg_browser")))
	req.Header.Set("Origin", "https://evil.example.com")
	rr = httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code == http.StatusNoContent {
		t.Error("browser key from a disallowed origin was accepted — the allowlist must still bite")
	}

	// And a wrong key is still unauthorized.
	rr = httptest.NewRecorder()
	h.ServeHTTP(rr, httptest.NewRequest(http.MethodPost, "/v1/events", strings.NewReader(body("sg_wrong"))))
	if rr.Code != http.StatusUnauthorized {
		t.Errorf("wrong key: status = %d, want 401", rr.Code)
	}
}

// With no server_key configured, only browsers can report — the default posture.
func TestServerIngestDisabledWithoutServerKey(t *testing.T) {
	st := openStore(t)
	h := ingest.NewEventsHandler(st, map[string]ingest.AppCfg{
		"demo": {Key: "sg_browser", Origins: []string{"https://app.internal"}},
	})

	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, httptest.NewRequest(http.MethodPost, "/v1/events", strings.NewReader(
		`{"app":"demo","key":"","events":[{"ts":1,"app":"demo","user_id":"u","session_id":"","type":"event","name":"x"}]}`)))
	if rr.Code != http.StatusUnauthorized {
		t.Errorf("empty key with no server_key configured: status = %d, want 401", rr.Code)
	}
}

// Sessionless events are stored; no phantom session row is invented for them.
func TestSessionlessServerEvents(t *testing.T) {
	st := openStore(t)
	h := ingest.NewEventsHandler(st, map[string]ingest.AppCfg{
		"demo": {Key: "sg_browser", ServerKey: "sg_server"},
	})

	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, httptest.NewRequest(http.MethodPost, "/v1/events", strings.NewReader(
		`{"app":"demo","key":"sg_server","events":[
			{"ts":1000,"app":"demo","user_id":"cron","session_id":"","type":"event","name":"nightly.import","props":{"duration_ms":1200}}
		]}`)))
	if rr.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", rr.Code)
	}

	events, err := st.QueryEvents(store.EventQuery{Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 1 || events[0].Name != "nightly.import" {
		t.Fatalf("stored events = %+v", events)
	}

	sessions, err := st.ListSessions(10, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(sessions) != 0 {
		t.Errorf("a sessionless event created %d session rows: %+v", len(sessions), sessions)
	}
}

// The version of server ingest actually worth having: a server event carrying
// the browser's session id lands on that session's timeline, so an incident can
// show both halves of a slow request.
func TestServerEventCorrelatesWithBrowserSession(t *testing.T) {
	st := openStore(t)
	h := ingest.NewEventsHandler(st, map[string]ingest.AppCfg{
		"demo": {Key: "sg_browser", ServerKey: "sg_server"},
	})

	// Browser half.
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, httptest.NewRequest(http.MethodPost, "/v1/events", strings.NewReader(
		`{"app":"demo","key":"sg_browser","events":[
			{"ts":1000,"app":"demo","user_id":"anand","session_id":"s-shared","type":"flow","name":"report.export","props":{"duration_ms":40000}}
		]}`)))
	if rr.Code != http.StatusNoContent {
		t.Fatalf("browser half: %d", rr.Code)
	}

	// Server half, same session.
	rr = httptest.NewRecorder()
	h.ServeHTTP(rr, httptest.NewRequest(http.MethodPost, "/v1/events", strings.NewReader(
		`{"app":"demo","key":"sg_server","events":[
			{"ts":1200,"app":"demo","user_id":"anand","session_id":"s-shared","type":"event","name":"xlsx.serialize","props":{"duration_ms":31000}}
		]}`)))
	if rr.Code != http.StatusNoContent {
		t.Fatalf("server half: %d", rr.Code)
	}

	events, err := st.QueryEvents(store.EventQuery{SessionID: "s-shared", Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 2 {
		t.Fatalf("session timeline has %d events, want both halves: %+v", len(events), events)
	}
}

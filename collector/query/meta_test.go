package query_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/foundanand/spyglass/collector/query"
	"github.com/foundanand/spyglass/collector/store"
	_ "modernc.org/sqlite"
)

func metaOf(t *testing.T, h http.Handler) map[string]interface{} {
	t.Helper()
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/v1/query/meta", nil))
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rr.Code)
	}
	var body map[string]interface{}
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	return body
}

// The panel needs to tell "nothing has ever arrived" (a setup problem) from
// "nothing in the window you picked" (normal).
func TestMetaReportsWhetherAnythingHasEverArrived(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()

	h := query.NewMetaHandler(st, "1.2.3", []string{"inventory", "billing"})

	body := metaOf(t, h)
	if body["has_any_events"] != false {
		t.Errorf("fresh collector: has_any_events = %v, want false", body["has_any_events"])
	}
	if body["version"] != "1.2.3" {
		t.Errorf("version = %v", body["version"])
	}
	apps, _ := body["apps"].([]interface{})
	if len(apps) != 2 || apps[0] != "billing" || apps[1] != "inventory" {
		t.Errorf("apps = %v, want sorted slugs", apps)
	}

	if err := st.InsertEvents([]store.Event{
		{Ts: 1, App: "inventory", UserID: "u", SessionID: "s", Type: "event", Name: "x"},
	}); err != nil {
		t.Fatal(err)
	}
	if metaOf(t, h)["has_any_events"] != true {
		t.Error("after one event: has_any_events should be true")
	}
}

// The dashboard password and the ingest keys are separate credentials. This
// endpoint is behind the former and must never leak the latter.
func TestMetaNeverExposesAppKeys(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()

	h := query.NewMetaHandler(st, "dev", []string{"inventory"})
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/v1/query/meta", nil))

	raw := rr.Body.String()
	for _, forbidden := range []string{"sg_live", "key", "server_key", "secret", "password"} {
		if strings.Contains(strings.ToLower(raw), forbidden) {
			t.Errorf("meta response contains %q: %s", forbidden, raw)
		}
	}
}

func TestMetaWithNoAppsConfigured(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()

	body := metaOf(t, query.NewMetaHandler(st, "dev", nil))
	apps, ok := body["apps"].([]interface{})
	if !ok || len(apps) != 0 {
		t.Errorf("apps = %v, want an empty array rather than null", body["apps"])
	}
}

package query_test

import (
	"encoding/csv"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"runtime"
	"strings"
	"testing"

	"github.com/foundanand/spyglass/collector/query"
	"github.com/foundanand/spyglass/collector/store"
	_ "modernc.org/sqlite"
)

func seedExportStore(t *testing.T, n int) *store.Store {
	t.Helper()
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })

	batch := make([]store.Event, 0, n)
	for i := 0; i < n; i++ {
		typ := "event"
		if i%3 == 0 {
			typ = "network"
		}
		batch = append(batch, store.Event{
			Ts: int64(1767225600000 + i), App: "demo", UserID: "u1", SessionID: "s1",
			Type: typ, Name: "thing", URL: "https://x/y?a=1,b",
			Props: map[string]interface{}{"note": `quoted,"comma"`, "i": i},
		})
	}
	if err := st.InsertEvents(batch); err != nil {
		t.Fatal(err)
	}
	return st
}

func TestEventsCSVExport(t *testing.T) {
	st := seedExportStore(t, 40)
	h := query.NewEventsHandler(st)

	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/v1/query/events?format=csv", nil))

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rr.Code)
	}
	if ct := rr.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/csv") {
		t.Errorf("content-type = %q", ct)
	}
	if cd := rr.Header().Get("Content-Disposition"); !strings.Contains(cd, "attachment") {
		t.Errorf("content-disposition = %q, want an attachment", cd)
	}

	recs, err := csv.NewReader(strings.NewReader(rr.Body.String())).ReadAll()
	if err != nil {
		t.Fatalf("export is not valid CSV: %v", err)
	}
	if len(recs) != 41 { // header + 40 rows
		t.Fatalf("got %d records, want 41 (header + 40)", len(recs))
	}
	if recs[0][0] != "id" || recs[0][len(recs[0])-1] != "props" {
		t.Errorf("header = %v", recs[0])
	}

	// Commas and quotes inside url/props must survive the round trip — this is
	// the whole reason to use encoding/csv rather than joining strings.
	var props map[string]interface{}
	if err := json.Unmarshal([]byte(recs[1][9]), &props); err != nil {
		t.Fatalf("props column is not valid JSON: %v (%q)", err, recs[1][9])
	}
	if props["note"] != `quoted,"comma"` {
		t.Errorf("props round trip = %v", props["note"])
	}
	if !strings.Contains(recs[1][8], "a=1,b") {
		t.Errorf("url with a comma did not survive: %q", recs[1][8])
	}
}

// An export must apply exactly the filters of the view it came from, or it is a
// second, subtly different query rather than "what I am looking at, as a file".
func TestCSVExportHonoursTheSameFilters(t *testing.T) {
	st := seedExportStore(t, 30)
	h := query.NewEventsHandler(st)

	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/v1/query/events?format=csv&exclude=network", nil))

	recs, err := csv.NewReader(strings.NewReader(rr.Body.String())).ReadAll()
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range recs[1:] {
		if r[6] == "network" {
			t.Fatalf("excluded type present in export: %v", r)
		}
	}
	if len(recs)-1 != 20 { // 30 rows, every third is network
		t.Errorf("exported %d rows, want 20", len(recs)-1)
	}
}

func TestEventsJSONPagination(t *testing.T) {
	st := seedExportStore(t, 25)
	h := query.NewEventsHandler(st)

	get := func(url string) (events []map[string]interface{}, next string) {
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, url, nil))
		if rr.Code != http.StatusOK {
			t.Fatalf("status = %d for %s", rr.Code, url)
		}
		var body struct {
			Events []map[string]interface{} `json:"events"`
			Next   string                   `json:"next"`
		}
		if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		return body.Events, body.Next
	}

	page1, next := get("/v1/query/events?limit=10")
	if len(page1) != 10 || next == "" {
		t.Fatalf("page 1: %d events, next=%q", len(page1), next)
	}

	page2, next2 := get("/v1/query/events?limit=10&cursor=" + next)
	if len(page2) != 10 || next2 == "" {
		t.Fatalf("page 2: %d events, next=%q", len(page2), next2)
	}

	page3, next3 := get("/v1/query/events?limit=10&cursor=" + next2)
	if len(page3) != 5 {
		t.Fatalf("page 3: %d events, want 5", len(page3))
	}
	// A short page is the end; handing back a cursor would invite a pointless
	// extra round trip.
	if next3 != "" {
		t.Errorf("next on a short page = %q, want empty", next3)
	}

	ids := map[interface{}]int{}
	for _, p := range [][]map[string]interface{}{page1, page2, page3} {
		for _, e := range p {
			ids[e["id"]]++
		}
	}
	if len(ids) != 25 {
		t.Errorf("paged over %d distinct ids, want 25", len(ids))
	}
}

// A garbled cursor restarts from the top rather than 400-ing mid-scroll.
func TestBadCursorIsIgnored(t *testing.T) {
	st := seedExportStore(t, 5)
	h := query.NewEventsHandler(st)

	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/v1/query/events?cursor=not-a-cursor", nil))
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rr.Code)
	}
	var body struct {
		Events []map[string]interface{} `json:"events"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Events) != 5 {
		t.Errorf("got %d events, want all 5", len(body.Events))
	}
}

// The acceptance criterion: a large export must not materially raise collector
// memory. Streaming keeps the row cost constant regardless of window size.
func TestLargeExportDoesNotBalloonMemory(t *testing.T) {
	const n = 50_000
	st := seedExportStore(t, n)

	var before, after runtime.MemStats
	runtime.GC()
	runtime.ReadMemStats(&before)

	rows := 0
	if err := st.StreamEvents(store.EventQuery{Limit: n}, func(store.Event) error {
		rows++
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	runtime.ReadMemStats(&after)

	if rows != n {
		t.Fatalf("streamed %d rows, want %d", rows, n)
	}

	// Materialising 50k events with props costs tens of MB; streaming should
	// stay far under that. 16MB is a generous ceiling that still fails loudly
	// if someone reintroduces a slice.
	const ceiling = 16 << 20
	growth := int64(after.HeapAlloc) - int64(before.HeapAlloc)
	if growth > ceiling {
		t.Errorf("heap grew %d bytes streaming %d rows, want under %d", growth, n, ceiling)
	}
	t.Logf("heap growth streaming %d rows: %d bytes", n, growth)
}

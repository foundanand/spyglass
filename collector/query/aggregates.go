package query

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/foundanand/spyglass/collector/store"
)

// AggregatesHandler serves GET /v1/query/aggregates[?app=&from=&to=&limit=].
// It returns DAU, top events, top pages, and error counts by day in one payload
// so the dashboard's aggregates view needs a single round trip.
type AggregatesHandler struct {
	store *store.Store
}

// NewAggregatesHandler creates a new AggregatesHandler.
func NewAggregatesHandler(st *store.Store) *AggregatesHandler {
	return &AggregatesHandler{store: st}
}

type aggregatesResp struct {
	DAU         []store.DayCount  `json:"dau"`
	TopEvents   []store.NameCount `json:"top_events"`
	TopPages    []store.NameCount `json:"top_pages"`
	ErrorsByDay []store.DayCount  `json:"errors_by_day"`
}

func (h *AggregatesHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	q := r.URL.Query()
	app := q.Get("app")
	var from, to int64
	if s := q.Get("from"); s != "" {
		from, _ = strconv.ParseInt(s, 10, 64)
	}
	if s := q.Get("to"); s != "" {
		to, _ = strconv.ParseInt(s, 10, 64)
	}
	limit := 10
	if s := q.Get("limit"); s != "" {
		if n, err := strconv.Atoi(s); err == nil {
			limit = n
		}
	}

	var resp aggregatesResp
	var err error
	if resp.DAU, err = h.store.DAU(app, from, to); err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	if resp.TopEvents, err = h.store.TopEvents(app, from, to, limit); err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	if resp.TopPages, err = h.store.TopPages(app, from, to, limit); err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	if resp.ErrorsByDay, err = h.store.ErrorsByDay(app, from, to); err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	// Normalize nils to empty slices for a stable JSON shape.
	if resp.DAU == nil {
		resp.DAU = []store.DayCount{}
	}
	if resp.TopEvents == nil {
		resp.TopEvents = []store.NameCount{}
	}
	if resp.TopPages == nil {
		resp.TopPages = []store.NameCount{}
	}
	if resp.ErrorsByDay == nil {
		resp.ErrorsByDay = []store.DayCount{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp) //nolint:errcheck
}

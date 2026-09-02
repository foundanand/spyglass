package query

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/foundanand/spyglass/collector/store"
)

// FlowDetailHandler serves GET /v1/query/flow-detail?name=…
//
// Everything the flow page needs in one round trip: the individual slowest runs
// with their session ids, and the duration distribution. The aggregate endpoint
// answers "how slow is this"; this answers "show me the slow ones" and "what
// does the spread actually look like".
type FlowDetailHandler struct {
	store *store.Store
}

// NewFlowDetailHandler creates a new FlowDetailHandler.
func NewFlowDetailHandler(st *store.Store) *FlowDetailHandler {
	return &FlowDetailHandler{store: st}
}

func (h *FlowDetailHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	q := r.URL.Query()
	name := q.Get("name")
	if name == "" {
		http.Error(w, "name is required", http.StatusBadRequest)
		return
	}
	from, to := timeWindow(r)

	sq := store.FlowSessionQuery{
		Name:    name,
		App:     q.Get("app"),
		From:    from,
		To:      to,
		Outcome: q.Get("outcome"),
	}
	if v := q.Get("min_ms"); v != "" {
		sq.MinDurationMs, _ = strconv.ParseInt(v, 10, 64)
	}
	if v := q.Get("limit"); v != "" {
		sq.Limit, _ = strconv.Atoi(v)
	}

	sessions, err := h.store.FlowSessions(sq)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	if sessions == nil {
		sessions = []store.FlowSession{}
	}

	hist, err := h.store.FlowHistogram(name, q.Get("app"), from, to)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	if hist == nil {
		hist = []store.HistogramBucket{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{ //nolint:errcheck
		"sessions":  sessions,
		"histogram": hist,
	})
}

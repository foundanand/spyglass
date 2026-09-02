package query

import (
	"encoding/json"
	"net/http"

	"github.com/foundanand/spyglass/collector/store"
)

// CountsHandler serves GET /v1/query/counts[?app=&user=&from=&to=].
//
// It returns the number of events of each type in the window. The live feed
// uses it to label its type chips: network events are excluded by default
// because they are the overwhelming majority of a real session, and a chip
// reading "network 254" is what stops someone concluding the data was never
// captured.
type CountsHandler struct {
	store *store.Store
}

// NewCountsHandler creates a new CountsHandler.
func NewCountsHandler(st *store.Store) *CountsHandler {
	return &CountsHandler{store: st}
}

func (h *CountsHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	q := r.URL.Query()
	from, to := timeWindow(r)

	counts, err := h.store.CountsByType(q.Get("app"), q.Get("user"), from, to)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	if counts == nil {
		counts = map[string]int{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"counts": counts}) //nolint:errcheck
}

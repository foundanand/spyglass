package query

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/foundanand/spyglass/collector/store"
)

// FunnelHandler serves GET /v1/query/funnel?steps=a,b,c[&app=&from=&to=&max_step_ms=].
type FunnelHandler struct {
	store *store.Store
}

// NewFunnelHandler creates a new FunnelHandler.
func NewFunnelHandler(st *store.Store) *FunnelHandler {
	return &FunnelHandler{store: st}
}

func (h *FunnelHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	q := r.URL.Query()
	var steps []string
	for _, s := range strings.Split(q.Get("steps"), ",") {
		if s = strings.TrimSpace(s); s != "" {
			steps = append(steps, s)
		}
	}
	if len(steps) < 2 {
		http.Error(w, "funnel needs at least 2 steps", http.StatusBadRequest)
		return
	}

	from, to := timeWindow(r)

	// max_step_ms caps how long a transition may take and still be *timed*; the
	// conversion is counted regardless. Explicit 0 means no cap, for funnels
	// that legitimately span days.
	maxStep := store.DefaultMaxStepMs
	if v := q.Get("max_step_ms"); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil && n >= 0 {
			maxStep = n
		}
	}

	res, err := h.store.Funnel(store.FunnelQuery{
		Steps:     steps,
		App:       q.Get("app"),
		From:      from,
		To:        to,
		MaxStepMs: maxStep,
	})
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{ //nolint:errcheck
		"steps":      res.Steps,
		"to_convert": res.ToConvert,
	})
}

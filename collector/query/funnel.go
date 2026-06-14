package query

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/foundanand/spyglass/collector/store"
)

// FunnelHandler serves GET /v1/query/funnel?steps=a,b,c[&app=&from=&to=].
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

	var from, to int64
	if s := q.Get("from"); s != "" {
		from, _ = strconv.ParseInt(s, 10, 64)
	}
	if s := q.Get("to"); s != "" {
		to, _ = strconv.ParseInt(s, 10, 64)
	}

	res, err := h.store.Funnel(steps, q.Get("app"), from, to)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"steps": res}) //nolint:errcheck
}

package query

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/foundanand/spyglass/collector/store"
)

// SessionsHandler handles GET /v1/query/sessions.
type SessionsHandler struct {
	st *store.Store
}

// NewSessionsHandler creates a SessionsHandler.
func NewSessionsHandler(st *store.Store) *SessionsHandler {
	return &SessionsHandler{st: st}
}

func (h *SessionsHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	limit := 100
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			limit = n
		}
	}

	sessions, err := h.st.ListSessions(limit)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if sessions == nil {
		sessions = []store.Session{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{ //nolint:errcheck
		"sessions": sessions,
	})
}

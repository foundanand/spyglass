package query

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/foundanand/spyglass/collector/store"
)

// UsersHandler serves GET /v1/query/users[?limit=&from=&to=].
type UsersHandler struct {
	store *store.Store
}

// NewUsersHandler creates a new UsersHandler.
func NewUsersHandler(st *store.Store) *UsersHandler {
	return &UsersHandler{store: st}
}

func (h *UsersHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	limit := 100
	if s := r.URL.Query().Get("limit"); s != "" {
		if n, err := strconv.Atoi(s); err == nil {
			limit = n
		}
	}

	from, to := timeWindow(r)

	users, err := h.store.QueryUsers(limit, from, to)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	if users == nil {
		users = []store.UserSummary{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"users": users})
}

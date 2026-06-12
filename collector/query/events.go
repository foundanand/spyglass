package query

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/foundanand/spyglass/collector/store"
)

// EventsHandler serves GET /v1/query/events.
type EventsHandler struct {
	store *store.Store
}

// NewEventsHandler creates a new EventsHandler.
func NewEventsHandler(st *store.Store) *EventsHandler {
	return &EventsHandler{store: st}
}

func (h *EventsHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	q := r.URL.Query()
	eq := store.EventQuery{
		UserID:    q.Get("user"),
		EventType: q.Get("type"),
		App:       q.Get("app"),
	}
	if s := q.Get("from"); s != "" {
		eq.From, _ = strconv.ParseInt(s, 10, 64)
	}
	if s := q.Get("to"); s != "" {
		eq.To, _ = strconv.ParseInt(s, 10, 64)
	}
	if s := q.Get("limit"); s != "" {
		eq.Limit, _ = strconv.Atoi(s)
	}

	events, err := h.store.QueryEvents(eq)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	if events == nil {
		events = []store.Event{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"events": events})
}

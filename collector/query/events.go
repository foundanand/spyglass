package query

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/foundanand/spyglass/collector/store"
)

// EventsHandler serves GET /v1/query/events[?user=&type=&exclude=&app=&session=&screen=&from=&to=&limit=&cursor=&format=csv].
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
		SessionID: q.Get("session"),
		Screen:    q.Get("screen"),
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
	// exclude=network,pageview — the live feed's default is "everything a person
	// did", which is most cheaply expressed as a negation.
	if s := q.Get("exclude"); s != "" {
		for _, t := range strings.Split(s, ",") {
			if t = strings.TrimSpace(t); t != "" {
				eq.ExcludeTypes = append(eq.ExcludeTypes, t)
			}
		}
	}

	if ts, id, ok := decodeCursor(q.Get("cursor")); ok {
		eq.CursorTs, eq.CursorID, eq.HasCursor = ts, id, true
	}

	// CSV takes the same filters, so an export is exactly the view it came from.
	// It streams, and is allowed past the browsing page cap.
	if q.Get("format") == "csv" {
		if eq.Limit <= 0 {
			eq.Limit = store.MaxExportRows
		}
		writeEventsCSV(w, h.store, eq, "spyglass-events.csv")
		return
	}

	if eq.Limit <= 0 || eq.Limit > 500 {
		eq.Limit = 100
	}

	events, err := h.store.QueryEvents(eq)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	if events == nil {
		events = []store.Event{}
	}

	// A full page implies there may be more; a short one is the end. Handing
	// back a cursor on a short page would invite an extra round trip for nothing.
	next := ""
	if len(events) == eq.Limit && len(events) > 0 {
		last := events[len(events)-1]
		next = encodeCursor(last.Ts, last.ID)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{ //nolint:errcheck
		"events": events,
		"next":   next,
	})
}

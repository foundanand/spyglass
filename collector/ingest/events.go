package ingest

import (
	"encoding/json"
	"io"
	"net/http"
	"sync"
	"time"

	"github.com/foundanand/spyglass/collector/store"
)

const (
	maxBodyBytes      = 1 << 20 // 1 MB
	rateLimit         = 10_000  // events per minute per app
	rateWindowSeconds = 60
)

// AppCfg is the subset of config the events handler needs.
type AppCfg struct {
	Key     string
	Origins []string
}

// ingestRequest is the wire format the SDK sends to POST /v1/events.
type ingestRequest struct {
	App    string        `json:"app"`
	Key    string        `json:"key"`
	Events []store.Event `json:"events"`
}

// EventsHandler handles POST /v1/events.
type EventsHandler struct {
	store *store.Store
	apps  map[string]AppCfg
	rl    *rateLimiter
}

// NewEventsHandler creates a new EventsHandler.
func NewEventsHandler(st *store.Store, apps map[string]AppCfg) *EventsHandler {
	return &EventsHandler{store: st, apps: apps, rl: newRateLimiter()}
}

func (h *EventsHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Handle CORS preflight: for OPTIONS we check origin against all apps.
	if r.Method == http.MethodOptions {
		writePreflight(w, r, h.apps)
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Enforce body size limit before reading.
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "request body too large", http.StatusRequestEntityTooLarge)
		return
	}

	var req ingestRequest
	if err := json.Unmarshal(body, &req); err != nil {
		http.Error(w, "invalid JSON", http.StatusBadRequest)
		return
	}

	// Validate app + key.
	appCfg, ok := h.apps[req.App]
	if !ok || appCfg.Key != req.Key {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	// CORS origin check for actual requests.
	if !allowOrigin(w, r.Header.Get("Origin"), appCfg.Origins) {
		return
	}

	// Rate limit by app.
	if !h.rl.Allow(req.App) {
		http.Error(w, "rate limit exceeded", http.StatusTooManyRequests)
		return
	}

	if len(req.Events) == 0 {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	// Stamp app on every event from the authenticated app name, not what the client says.
	now := time.Now().UnixMilli()
	for i := range req.Events {
		req.Events[i].App = req.App
		if req.Events[i].Ts == 0 {
			req.Events[i].Ts = now
		}
	}

	if err := h.store.InsertEvents(req.Events); err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	// Upsert session for each unique session in the batch.
	sessions := make(map[string]*store.Event)
	for i := range req.Events {
		e := &req.Events[i]
		if existing, ok := sessions[e.SessionID]; !ok || e.Ts > existing.Ts {
			sessions[e.SessionID] = e
		}
	}
	for sid, e := range sessions {
		_ = h.store.UpsertSession(sid, e.App, e.UserID, e.Ts, e.Ts, nil)
	}

	w.WriteHeader(http.StatusNoContent)
}

func originAllowed(allowed []string, origin string) bool {
	if len(allowed) == 0 {
		return true // no restriction configured
	}
	for _, o := range allowed {
		if o == origin {
			return true
		}
	}
	return false
}

// rateLimiter is a simple fixed-window counter per key.
type rateLimiter struct {
	mu       sync.Mutex
	counters map[string]*rateWindow
}

type rateWindow struct {
	count    int
	windowMs int64
}

func newRateLimiter() *rateLimiter {
	return &rateLimiter{counters: make(map[string]*rateWindow)}
}

func (rl *rateLimiter) Allow(key string) bool {
	now := time.Now().UnixMilli()
	windowMs := now - (now % (rateWindowSeconds * 1000))

	rl.mu.Lock()
	defer rl.mu.Unlock()

	w, ok := rl.counters[key]
	if !ok || w.windowMs != windowMs {
		rl.counters[key] = &rateWindow{count: 1, windowMs: windowMs}
		return true
	}
	w.count++
	return w.count <= rateLimit
}

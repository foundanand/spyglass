package ingest

import (
	"crypto/subtle"
	"encoding/json"
	"io"
	"net/http"
	"sync"
	"time"

	"github.com/foundanand/spyglass/collector/notify"
	"github.com/foundanand/spyglass/collector/store"
)

const (
	maxBodyBytes      = 1 << 20 // 1 MB
	rateLimit         = 10_000  // events per minute per app
	rateWindowSeconds = 60
)

// AppCfg is the subset of config the events handler needs.
type AppCfg struct {
	// Key is the public browser key, paired with the origin allowlist.
	Key string
	// ServerKey authenticates non-browser callers. Empty disables server-side
	// ingest for this app, which is the default.
	ServerKey string
	Origins   []string
}

// ingestRequest is the wire format the SDK sends to POST /v1/events.
type ingestRequest struct {
	App    string        `json:"app"`
	Key    string        `json:"key"`
	Events []store.Event `json:"events"`
	// Meta is coarse session context — viewport, screen, UA, language, timezone,
	// referrer. Sent on the first batch of a session rather than on every event,
	// because it describes the session, not the event. Optional: an SDK with
	// context disabled, or an older SDK, simply omits it.
	Meta map[string]interface{} `json:"meta,omitempty"`
}

// EventsHandler handles POST /v1/events.
type EventsHandler struct {
	store *store.Store
	apps  map[string]AppCfg
	rl    *rateLimiter
	// notifier is nil unless a webhook is configured, and its methods are safe
	// on nil — so the unconfigured collector has no egress path at all.
	notifier *notify.Notifier
}

// NewEventsHandler creates a new EventsHandler.
func NewEventsHandler(st *store.Store, apps map[string]AppCfg) *EventsHandler {
	return &EventsHandler{store: st, apps: apps, rl: newRateLimiter()}
}

// WithNotifier attaches an optional webhook notifier.
func (h *EventsHandler) WithNotifier(n *notify.Notifier) *EventsHandler {
	h.notifier = n
	return h
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

	// Validate app + key, and note which class of key was used.
	//
	// The two are not interchangeable: the browser key is public (it ships to
	// the client) and is only meaningful alongside the origin allowlist, while
	// the server key is a real secret held by a worker or cron job. Only the
	// latter may skip the origin check — a browser key that could skip it would
	// make the allowlist decorative.
	appCfg, ok := h.apps[req.App]
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	serverKeyed := appCfg.ServerKey != "" && subtle.ConstantTimeCompare([]byte(req.Key), []byte(appCfg.ServerKey)) == 1
	browserKeyed := subtle.ConstantTimeCompare([]byte(req.Key), []byte(appCfg.Key)) == 1
	if !serverKeyed && !browserKeyed {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	// CORS origin check for actual requests. A server has no meaningful Origin
	// to present, so server-keyed callers are exempt.
	if !serverKeyed {
		if !allowOrigin(w, r.Header.Get("Origin"), appCfg.Origins) {
			return
		}
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
	//
	// The SDK collects context for the session of the batch's first event, so
	// that is the session the meta describes.
	contextSession := ""
	if len(req.Events) > 0 {
		contextSession = req.Events[0].SessionID
	}
	sessions := make(map[string]*store.Event)
	for i := range req.Events {
		e := &req.Events[i]
		if existing, ok := sessions[e.SessionID]; !ok || e.Ts > existing.Ts {
			sessions[e.SessionID] = e
		}
	}
	for sid, e := range sessions {
		// Server-side events may carry no session at all — a nightly job has no
		// sitting to belong to. Empty is more honest than a synthetic id, and
		// there is no session row to create for one.
		//
		// A server event that *does* carry the browser's session_id is the
		// version of this worth having: it lands on that session's timeline, so
		// the incident view can show both halves of a slow request.
		if sid == "" {
			continue
		}
		// Meta belongs to the session the batch came from. A batch spanning two
		// sessions is possible in principle (a flush straddling the 30-minute
		// idle boundary), so only the session the context was collected for
		// gets it — which is the one every event in the batch shares in
		// practice, since the SDK reads the id per event.
		var meta map[string]interface{}
		if len(req.Meta) > 0 && sid == contextSession {
			meta = req.Meta
		}
		_ = h.store.UpsertSession(sid, e.App, e.UserID, e.Ts, e.Ts, meta)
	}

	// Alerting happens after the write is committed and never blocks the
	// response: Notify hands off to a goroutine, and a nil notifier is a no-op.
	h.notify(req.Events)

	w.WriteHeader(http.StatusNoContent)
}

// notify fires webhook alerts for anything in the batch worth waking someone
// for. Nothing here can fail the ingest — the events are already stored.
func (h *EventsHandler) notify(events []store.Event) {
	if !h.notifier.Enabled() {
		return
	}
	for i := range events {
		e := &events[i]
		if e.Type != "bug_report" && e.Type != "error" {
			continue
		}
		n := notify.Event{
			Type:      e.Type,
			Name:      e.Name,
			App:       e.App,
			UserID:    e.UserID,
			SessionID: e.SessionID,
			URL:       e.URL,
		}
		if e.Props != nil {
			if c, ok := e.Props["comment"].(string); ok {
				n.Comment = c
			}
			if src, ok := e.Props["source"].(string); ok {
				n.Source = src
			}
		}
		// The incident link needs the row id, which the insert assigned.
		if id, err := h.store.LatestEventID(e.SessionID, e.Ts, e.Type, e.Name); err == nil {
			n.ID = id
		}
		h.notifier.Notify(n)
	}
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

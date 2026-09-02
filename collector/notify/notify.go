// Package notify delivers a single outbound webhook when something happens that
// somebody should know about — a bug report arriving, or an error type showing
// up for the first time.
//
// # Why this exists
//
// spyglass is entirely pull. A bug report filed at 2am sits in SQLite until
// somebody opens the dashboard. For a 20–200 user internal tool the realistic
// failure mode is not a monitoring gap, it is that nobody opens the dashboard
// for a fortnight. The incident view is the product's best feature and it is
// only worth anything if something makes a person go and look.
//
// # The air-gap exception
//
// This is the ONLY code in the collector that originates a network connection,
// and it exists under a deliberate exception to the guarantee enforced by
// collector/airgap_test.go. Three rules keep that honest:
//
//  1. The one outbound call carries an `airgap:allow` marker, so the exception
//     is reviewed rather than accidental.
//  2. It is structurally impossible when unconfigured. New returns nil, and a
//     nil *Notifier's methods do nothing. There is no "enabled" flag to
//     fat-finger: with no webhook URL there is no notifier, and with no
//     notifier there is no code path that can dial out.
//  3. Point it at an in-enclave receiver and the air gap is intact. That is the
//     intended deployment, and the README says so.
//
// Delivery is fire-and-forget with a short timeout and no retry queue. A
// collector that stalls because Slack is slow is a worse outcome than a missed
// notification, and ingest must never wait on it.
package notify

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"
)

const (
	// deliverTimeout bounds one attempt. Short: this is a courtesy message, not
	// a durable queue.
	deliverTimeout = 5 * time.Second
	// dedupWindow collapses repeats of the same signature. A burst of one error
	// across every session must produce one message, not one per event.
	dedupWindow = 15 * time.Minute
	// maxSeen bounds the dedup map so a long-running collector with many
	// distinct signatures cannot grow it without limit.
	maxSeen = 5_000
)

// Config is the resolved webhook configuration.
type Config struct {
	OnBugReport string
	OnNewError  string
	// DashboardURL is the base used to build the incident deep link. Without it
	// the message still goes, just without a clickable link.
	DashboardURL string
}

// Notifier delivers webhook messages. A nil *Notifier is valid and inert —
// that is how "unconfigured means no egress is possible" is expressed.
type Notifier struct {
	cfg    Config
	client *http.Client

	mu   sync.Mutex
	seen map[string]time.Time
}

// New returns a Notifier, or nil when no webhook is configured.
//
// Returning nil rather than a disabled instance is the point: with no URL there
// is no client, and no call site that could dial out.
func New(cfg Config) *Notifier {
	if cfg.OnBugReport == "" && cfg.OnNewError == "" {
		return nil
	}
	return &Notifier{
		cfg:    cfg,
		client: &http.Client{Timeout: deliverTimeout}, // airgap:allow opt-in webhook alerts (notify.Config); nil when unconfigured
		seen:   make(map[string]time.Time),
	}
}

// Enabled reports whether any webhook is configured.
func (n *Notifier) Enabled() bool { return n != nil }

// Event is the minimum a notification needs about what happened.
type Event struct {
	ID        int64
	Type      string // "bug_report" or "error"
	Name      string
	App       string
	UserID    string
	SessionID string
	URL       string
	Comment   string
	Source    string
}

// payload is the JSON body delivered to the webhook. Slack renders `text`, and
// anything else can read the structured fields beside it.
type payload struct {
	Text      string `json:"text"`
	Kind      string `json:"kind"`
	App       string `json:"app"`
	User      string `json:"user"`
	Name      string `json:"name"`
	URL       string `json:"url,omitempty"`
	Incident  string `json:"incident_url,omitempty"`
	SessionID string `json:"session_id,omitempty"`
}

// Notify delivers a message for e, if one is warranted. Safe on a nil receiver
// and safe to call from a request path: it never blocks the caller.
func (n *Notifier) Notify(e Event) {
	if n == nil {
		return
	}

	var url, kind string
	switch e.Type {
	case "bug_report":
		url, kind = n.cfg.OnBugReport, "bug report"
	case "error":
		url, kind = n.cfg.OnNewError, "new error"
	default:
		return
	}
	if url == "" {
		return
	}
	if !n.firstInWindow(e.signature()) {
		return
	}

	body, err := json.Marshal(n.build(e, kind))
	if err != nil {
		return
	}

	// Fire and forget. Ingest has already committed; a webhook is a courtesy.
	go n.deliver(url, body)
}

func (n *Notifier) build(e Event, kind string) payload {
	p := payload{
		Kind:      kind,
		App:       e.App,
		User:      e.UserID,
		Name:      e.Name,
		URL:       e.URL,
		SessionID: e.SessionID,
	}
	if n.cfg.DashboardURL != "" && e.ID > 0 {
		p.Incident = fmt.Sprintf("%s/#/incident/%d", n.cfg.DashboardURL, e.ID)
	}

	detail := e.Name
	if e.Comment != "" {
		detail = e.Comment
	}
	p.Text = fmt.Sprintf("spyglass · %s in %s · %s · %s", kind, e.App, e.UserID, detail)
	if p.Incident != "" {
		p.Text += "\n" + p.Incident
	}
	return p
}

// signature identifies "the same thing happening again".
//
// Message plus source, matching the SDK's own client-side dedup key. Deliberately
// not the stack: minified builds produce frames that differ run to run, which
// would defeat the dedup exactly when it is most needed.
func (e Event) signature() string {
	return e.Type + "\x00" + e.App + "\x00" + e.Name + "\x00" + e.Source
}

// firstInWindow reports whether sig has not been seen recently, and records it.
func (n *Notifier) firstInWindow(sig string) bool {
	now := time.Now()

	n.mu.Lock()
	defer n.mu.Unlock()

	if last, ok := n.seen[sig]; ok && now.Sub(last) < dedupWindow {
		return false
	}
	if len(n.seen) >= maxSeen {
		for k, t := range n.seen {
			if now.Sub(t) >= dedupWindow {
				delete(n.seen, k)
			}
		}
		// Still full of live entries: drop the map rather than grow forever.
		if len(n.seen) >= maxSeen {
			n.seen = make(map[string]time.Time)
		}
	}
	n.seen[sig] = now
	return true
}

func (n *Notifier) deliver(url string, body []byte) {
	ctx, cancel := context.WithTimeout(context.Background(), deliverTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body)) // airgap:allow opt-in webhook alerts, unreachable unless a webhook URL is configured
	if err != nil {
		log.Printf("notify: build request: %v", err)
		return
	}
	req.Header.Set("Content-Type", "application/json")

	res, err := n.client.Do(req)
	if err != nil {
		// No retry queue on purpose: a missed notification beats a collector
		// that accumulates work because a receiver is down.
		log.Printf("notify: deliver: %v", err)
		return
	}
	defer res.Body.Close()
	if res.StatusCode >= 400 {
		log.Printf("notify: webhook returned %d", res.StatusCode)
	}
}

package notify

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// Unconfigured must mean "no notifier exists", not "a notifier that declines".
// That is what makes egress structurally impossible rather than a flag away.
func TestUnconfiguredReturnsNilNotifier(t *testing.T) {
	if n := New(Config{}); n != nil {
		t.Fatalf("New with no webhooks = %v, want nil", n)
	}
	var n *Notifier
	if n.Enabled() {
		t.Error("nil notifier reports enabled")
	}
	// Must not panic.
	n.Notify(Event{Type: "bug_report", Name: "x"})
}

func TestBugReportDelivers(t *testing.T) {
	var got atomic.Value
	hits := make(chan struct{}, 4)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var p payload
		_ = json.NewDecoder(r.Body).Decode(&p)
		got.Store(p)
		hits <- struct{}{}
	}))
	defer srv.Close()

	n := New(Config{OnBugReport: srv.URL, DashboardURL: "https://sg.internal"})
	if !n.Enabled() {
		t.Fatal("notifier should be enabled")
	}

	n.Notify(Event{
		ID: 42, Type: "bug_report", Name: "Export does nothing",
		App: "inventory", UserID: "anand", SessionID: "s1",
		Comment: "Clicked export, spinner forever.",
	})

	select {
	case <-hits:
	case <-time.After(3 * time.Second):
		t.Fatal("no webhook delivered")
	}

	p := got.Load().(payload)
	if p.Kind != "bug report" || p.User != "anand" || p.App != "inventory" {
		t.Errorf("payload = %+v", p)
	}
	if p.Incident != "https://sg.internal/#/incident/42" {
		t.Errorf("incident link = %q", p.Incident)
	}
	if !strings.Contains(p.Text, "Clicked export") {
		t.Errorf("text should carry the comment: %q", p.Text)
	}
}

// A burst of the same error across every session must produce one message.
func TestBurstOfOneErrorSendsOneMessage(t *testing.T) {
	var count int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&count, 1)
	}))
	defer srv.Close()

	n := New(Config{OnNewError: srv.URL})
	for i := 0; i < 50; i++ {
		n.Notify(Event{
			Type: "error", Name: "TypeError: x is not a function",
			App: "inventory", UserID: "u", Source: "app.js",
		})
	}
	time.Sleep(400 * time.Millisecond)

	if got := atomic.LoadInt32(&count); got != 1 {
		t.Errorf("delivered %d messages for a 50-event burst, want 1", got)
	}

	// A genuinely different error still gets through.
	n.Notify(Event{Type: "error", Name: "Failed to fetch", App: "inventory", Source: "api.js"})
	time.Sleep(400 * time.Millisecond)
	if got := atomic.LoadInt32(&count); got != 2 {
		t.Errorf("a distinct error should notify: count = %d, want 2", got)
	}
}

func TestOnlyConfiguredKindsFire(t *testing.T) {
	var count int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&count, 1)
	}))
	defer srv.Close()

	// Bug reports only.
	n := New(Config{OnBugReport: srv.URL})
	n.Notify(Event{Type: "error", Name: "boom", App: "a", Source: "s"})
	n.Notify(Event{Type: "pageview", Name: "/x", App: "a"})
	time.Sleep(300 * time.Millisecond)
	if got := atomic.LoadInt32(&count); got != 0 {
		t.Errorf("unconfigured kinds delivered %d messages, want 0", got)
	}

	n.Notify(Event{Type: "bug_report", Name: "r", App: "a"})
	time.Sleep(400 * time.Millisecond)
	if got := atomic.LoadInt32(&count); got != 1 {
		t.Errorf("configured kind delivered %d, want 1", got)
	}
}

// Notify must hand off rather than wait: a dead receiver cannot be allowed to
// hold up the ingest request that triggered it.
func TestSlowReceiverDoesNotBlockTheCaller(t *testing.T) {
	release := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		<-release
	}))
	defer srv.Close()
	defer close(release)

	n := New(Config{OnBugReport: srv.URL})

	start := time.Now()
	for i := 0; i < 5; i++ {
		n.Notify(Event{Type: "bug_report", Name: "r", App: "a", UserID: "u", SessionID: "s"})
	}
	elapsed := time.Since(start)

	if elapsed > 250*time.Millisecond {
		t.Errorf("Notify blocked for %v against a hanging receiver; it must fire and forget", elapsed)
	}
}

func TestDeadReceiverIsSurvivable(t *testing.T) {
	// Nothing listening on this port.
	n := New(Config{OnBugReport: "http://127.0.0.1:1/hook"})
	n.Notify(Event{Type: "bug_report", Name: "r", App: "a"})
	time.Sleep(300 * time.Millisecond) // logs an error, does not panic
}

func TestSignatureIgnoresVolatileFields(t *testing.T) {
	a := Event{Type: "error", App: "x", Name: "boom", Source: "app.js", UserID: "u1", SessionID: "s1"}
	b := Event{Type: "error", App: "x", Name: "boom", Source: "app.js", UserID: "u2", SessionID: "s2"}
	if a.signature() != b.signature() {
		t.Error("the same error from two users should share a signature")
	}
	c := Event{Type: "error", App: "x", Name: "boom", Source: "other.js"}
	if a.signature() == c.signature() {
		t.Error("a different source should be a different signature")
	}
}

package query

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func setupReplayDir(t *testing.T) (string, string) {
	t.Helper()
	dataDir := t.TempDir()
	sessionID := "test-session-1"
	dir := filepath.Join(dataDir, "replays", sessionID)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}

	// Write two fake chunks.
	for seq := 1; seq <= 2; seq++ {
		name := filepath.Join(dir, fmt.Sprintf("%06d.json.gz", seq))
		if err := os.WriteFile(name, []byte("fake-gz"), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	// Write meta.json.
	meta := `{"chunks":[{"seq":1,"ts":1000},{"seq":2,"ts":11000}]}`
	if err := os.WriteFile(filepath.Join(dir, "meta.json"), []byte(meta), 0o644); err != nil {
		t.Fatal(err)
	}

	return dataDir, sessionID
}

func TestReplayManifest(t *testing.T) {
	dataDir, sessionID := setupReplayDir(t)
	h := NewReplayHandler(dataDir)

	r := httptest.NewRequest(http.MethodGet, "/v1/sessions/"+sessionID+"/replay", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}

	var resp manifestResp
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("parse body: %v", err)
	}
	if resp.SessionID != sessionID {
		t.Errorf("session_id = %q, want %q", resp.SessionID, sessionID)
	}
	if len(resp.Chunks) != 2 {
		t.Errorf("chunks = %d, want 2", len(resp.Chunks))
	}
	if resp.Chunks[0].Ts != 1000 || resp.Chunks[1].Ts != 11000 {
		t.Errorf("chunk timestamps wrong: %+v", resp.Chunks)
	}
}

func TestReplayChunk(t *testing.T) {
	dataDir, sessionID := setupReplayDir(t)
	h := NewReplayHandler(dataDir)

	r := httptest.NewRequest(http.MethodGet, "/v1/sessions/"+sessionID+"/replay/1", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}
	if ct := w.Header().Get("Content-Encoding"); ct != "gzip" {
		t.Errorf("Content-Encoding = %q, want gzip", ct)
	}
	if w.Body.String() != "fake-gz" {
		t.Errorf("body = %q, want 'fake-gz'", w.Body.String())
	}
}

func TestReplayChunk_NotFound(t *testing.T) {
	dataDir, sessionID := setupReplayDir(t)
	h := NewReplayHandler(dataDir)

	r := httptest.NewRequest(http.MethodGet, "/v1/sessions/"+sessionID+"/replay/99", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)

	if w.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404", w.Code)
	}
}

func TestReplayManifest_UnknownSession(t *testing.T) {
	dataDir := t.TempDir()
	h := NewReplayHandler(dataDir)

	r := httptest.NewRequest(http.MethodGet, "/v1/sessions/no-such/replay", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)

	if w.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404 (got %d)", http.StatusNotFound, w.Code)
	}
}

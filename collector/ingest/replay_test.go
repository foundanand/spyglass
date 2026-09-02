package ingest

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/foundanand/spyglass/collector/store"
	_ "modernc.org/sqlite"
)

func TestReplayHandler(t *testing.T) {
	dir := t.TempDir()
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()

	// Pre-create a session so BumpChunkCount has a row to update.
	if err := st.UpsertSession("sess1", "demo", "u1", 1000, 1000, nil); err != nil {
		t.Fatal(err)
	}

	apps := map[string]AppCfg{
		"demo": {Key: "sg_test"},
	}
	h := NewReplayHandler(st, apps, dir)

	fakeGzip := []byte{0x1f, 0x8b, 0x00} // minimal gzip-like bytes for the test

	tests := []struct {
		name       string
		method     string
		query      string
		key        string
		body       []byte
		wantStatus int
	}{
		{
			name:       "valid first chunk",
			method:     http.MethodPost,
			query:      "app=demo&session=sess1&seq=1&ts=1000",
			key:        "sg_test",
			body:       fakeGzip,
			wantStatus: http.StatusNoContent,
		},
		{
			name:       "valid second chunk",
			method:     http.MethodPost,
			query:      "app=demo&session=sess1&seq=2&ts=11000",
			key:        "sg_test",
			body:       fakeGzip,
			wantStatus: http.StatusNoContent,
		},
		{
			name:       "wrong key",
			method:     http.MethodPost,
			query:      "app=demo&session=sess1&seq=3&ts=21000",
			key:        "wrong",
			body:       fakeGzip,
			wantStatus: http.StatusUnauthorized,
		},
		{
			name:       "missing session",
			method:     http.MethodPost,
			query:      "app=demo&seq=1&ts=1000",
			key:        "sg_test",
			body:       fakeGzip,
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "invalid seq",
			method:     http.MethodPost,
			query:      "app=demo&session=sess1&seq=0&ts=1000",
			key:        "sg_test",
			body:       fakeGzip,
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "wrong method",
			method:     http.MethodGet,
			query:      "app=demo&session=sess1&seq=1",
			key:        "sg_test",
			body:       nil,
			wantStatus: http.StatusMethodNotAllowed,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			body := bytes.NewReader(tc.body)
			r := httptest.NewRequest(tc.method, "/v1/replay?"+tc.query, body)
			r.Header.Set("X-Spyglass-Key", tc.key)
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)

			if w.Code != tc.wantStatus {
				t.Errorf("status = %d, want %d", w.Code, tc.wantStatus)
			}
		})
	}

	// Verify chunk files were written on disk.
	chunk1 := filepath.Join(dir, "replays", "sess1", "000001.json.gz")
	if _, err := os.Stat(chunk1); err != nil {
		t.Errorf("chunk 1 not written: %v", err)
	}
	chunk2 := filepath.Join(dir, "replays", "sess1", "000002.json.gz")
	if _, err := os.Stat(chunk2); err != nil {
		t.Errorf("chunk 2 not written: %v", err)
	}

	// Verify meta.json has two entries.
	metaPath := filepath.Join(dir, "replays", "sess1", "meta.json")
	raw, err := os.ReadFile(metaPath)
	if err != nil {
		t.Fatalf("meta.json not written: %v", err)
	}
	var meta replayMeta
	if err := json.Unmarshal(raw, &meta); err != nil {
		t.Fatalf("meta.json parse: %v", err)
	}
	if len(meta.Chunks) != 2 {
		t.Errorf("meta.json has %d chunks, want 2", len(meta.Chunks))
	}
}

func TestSanitizeID(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"abc123", "abc123"},
		{"abc-123_XYZ", "abc-123_XYZ"},
		{"../etc/passwd", "etcpasswd"},
		{"hello/world", "helloworld"},
		{"", ""},
	}
	for _, tc := range tests {
		if got := sanitizeID(tc.input); got != tc.want {
			t.Errorf("sanitizeID(%q) = %q, want %q", tc.input, got, tc.want)
		}
	}
}

func TestReplayPreflightAllowedOrigin(t *testing.T) {
	apps := map[string]AppCfg{
		"demo": {Key: "sg_test", Origins: []string{"http://localhost:3000"}},
	}
	h := NewReplayHandler(nil, apps, t.TempDir())

	req := httptest.NewRequest(http.MethodOptions, "/v1/replay", nil)
	req.Header.Set("Origin", "http://localhost:3000")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)

	if rr.Code != http.StatusNoContent {
		t.Fatalf("preflight: expected 204, got %d", rr.Code)
	}
	if rr.Header().Get("Access-Control-Allow-Origin") != "http://localhost:3000" {
		t.Error("expected Allow-Origin header on preflight")
	}
	if h := rr.Header().Get("Access-Control-Allow-Headers"); h != corsAllowHeaders {
		t.Errorf("expected Allow-Headers %q, got %q", corsAllowHeaders, h)
	}
}

func TestReplayPreflightDisallowedOrigin(t *testing.T) {
	apps := map[string]AppCfg{
		"demo": {Key: "sg_test", Origins: []string{"http://localhost:3000"}},
	}
	h := NewReplayHandler(nil, apps, t.TempDir())

	req := httptest.NewRequest(http.MethodOptions, "/v1/replay", nil)
	req.Header.Set("Origin", "https://evil.example.com")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Fatalf("preflight: expected 403 for disallowed origin, got %d", rr.Code)
	}
}

func TestReplayPostSetsCORSHeader(t *testing.T) {
	dir := t.TempDir()
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	if err := st.UpsertSession("sessCORS", "demo", "u1", 1000, 1000, nil); err != nil {
		t.Fatal(err)
	}

	apps := map[string]AppCfg{
		"demo": {Key: "sg_test", Origins: []string{"http://localhost:3000"}},
	}
	h := NewReplayHandler(st, apps, dir)

	req := httptest.NewRequest(http.MethodPost, "/v1/replay?app=demo&session=sessCORS&seq=1&ts=1000",
		bytes.NewReader([]byte{0x1f, 0x8b, 0x00}))
	req.Header.Set("X-Spyglass-Key", "sg_test")
	req.Header.Set("Origin", "http://localhost:3000")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)

	if rr.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d", rr.Code)
	}
	if rr.Header().Get("Access-Control-Allow-Origin") != "http://localhost:3000" {
		t.Error("expected Allow-Origin header on actual replay POST")
	}
}

// A duplicate seq must never truncate the chunk already on disk.
//
// The pre-fix SDK restarted its counter on every full page load, so a session
// that reloaded sent seq=1 a second time and os.WriteFile silently replaced the
// original. The collector now refuses: the existing file is authoritative and
// the duplicate is rejected with 409.
func TestReplayDuplicateSeqDoesNotTruncate(t *testing.T) {
	dir := t.TempDir()
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()

	if err := st.UpsertSession("sessDup", "demo", "u1", 1000, 1000, nil); err != nil {
		t.Fatal(err)
	}

	apps := map[string]AppCfg{"demo": {Key: "sg_test"}}
	h := NewReplayHandler(st, apps, dir)

	original := []byte{0x1f, 0x8b, 0x01, 0x02, 0x03, 0x04, 0x05}
	replacement := []byte{0x1f, 0x8b, 0xff} // shorter, so a truncate is visible

	post := func(body []byte, ts string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodPost,
			"/v1/replay?app=demo&session=sessDup&seq=1&ts="+ts, bytes.NewReader(body))
		r.Header.Set("X-Spyglass-Key", "sg_test")
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}

	if w := post(original, "1000"); w.Code != http.StatusNoContent {
		t.Fatalf("first chunk: status = %d, want 204", w.Code)
	}
	if w := post(replacement, "99000"); w.Code != http.StatusConflict {
		t.Fatalf("duplicate seq: status = %d, want 409", w.Code)
	}

	chunkPath := filepath.Join(dir, "replays", "sessDup", "000001.json.gz")
	got, err := os.ReadFile(chunkPath)
	if err != nil {
		t.Fatalf("chunk missing after duplicate: %v", err)
	}
	if !bytes.Equal(got, original) {
		t.Errorf("chunk was modified by a duplicate seq: got %v, want %v", got, original)
	}

	// The manifest must still describe the surviving chunk, not the rejected one.
	raw, err := os.ReadFile(filepath.Join(dir, "replays", "sessDup", "meta.json"))
	if err != nil {
		t.Fatalf("meta.json: %v", err)
	}
	var meta replayMeta
	if err := json.Unmarshal(raw, &meta); err != nil {
		t.Fatal(err)
	}
	if len(meta.Chunks) != 1 {
		t.Fatalf("meta has %d chunks, want 1", len(meta.Chunks))
	}
	if meta.Chunks[0].Ts != 1000 {
		t.Errorf("meta ts = %d, want 1000 (the rejected chunk must not update it)", meta.Chunks[0].Ts)
	}

	// chunk_count counts accepted writes, so it must agree with the files on disk.
	sessions, err := st.ListSessions(50, 0, 0)
	if err != nil {
		t.Fatalf("list sessions: %v", err)
	}
	var count int
	found := false
	for _, s := range sessions {
		if s.SessionID == "sessDup" {
			count, found = s.ChunkCount, true
			break
		}
	}
	if !found {
		t.Fatal("session sessDup not found")
	}
	if count != 1 {
		t.Errorf("chunk_count = %d, want 1 (must match the one file on disk)", count)
	}
}

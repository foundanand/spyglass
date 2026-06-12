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

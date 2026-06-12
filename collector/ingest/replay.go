package ingest

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"

	"github.com/foundanand/spyglass/collector/store"
)

const maxChunkBytes = 8 << 20 // 8 MB per compressed chunk

// ReplayHandler handles POST /v1/replay?session=&seq=&ts=&app=
type ReplayHandler struct {
	st      *store.Store
	apps    map[string]AppCfg
	dataDir string
	mu      sync.Mutex // serializes meta.json writes per process
}

// NewReplayHandler creates a ReplayHandler.
func NewReplayHandler(st *store.Store, apps map[string]AppCfg, dataDir string) *ReplayHandler {
	return &ReplayHandler{st: st, apps: apps, dataDir: dataDir}
}

func (h *ReplayHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	q := r.URL.Query()

	// Auth via x-spyglass-key header; app name in query param.
	appName := q.Get("app")
	key := r.Header.Get("X-Spyglass-Key")
	appCfg, ok := h.apps[appName]
	if !ok || appCfg.Key != key {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	sessionID := sanitizeID(q.Get("session"))
	if sessionID == "" {
		http.Error(w, "missing or invalid session", http.StatusBadRequest)
		return
	}

	seqStr := q.Get("seq")
	seq, err := strconv.Atoi(seqStr)
	if err != nil || seq < 1 {
		http.Error(w, "invalid seq", http.StatusBadRequest)
		return
	}

	var firstTs int64
	if ts := q.Get("ts"); ts != "" {
		firstTs, _ = strconv.ParseInt(ts, 10, 64)
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxChunkBytes)
	data, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "read error", http.StatusBadRequest)
		return
	}

	dir := filepath.Join(h.dataDir, "replays", sessionID)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		log.Printf("replay ingest: mkdir %s: %v", dir, err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	chunkPath := filepath.Join(dir, fmt.Sprintf("%06d.json.gz", seq))
	if err := os.WriteFile(chunkPath, data, 0o644); err != nil {
		log.Printf("replay ingest: write chunk %s: %v", chunkPath, err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	if firstTs > 0 {
		h.mu.Lock()
		if err := updateMeta(dir, seq, firstTs); err != nil {
			log.Printf("replay ingest: update meta %s: %v", dir, err)
		}
		h.mu.Unlock()
	}

	if err := h.st.BumpChunkCount(sessionID); err != nil {
		log.Printf("replay ingest: bump chunk_count %s: %v", sessionID, err)
	}

	w.WriteHeader(http.StatusNoContent)
}

// ---------------------------------------------------------------------------
// meta.json — timestamp seek index
// ---------------------------------------------------------------------------

type replayMeta struct {
	Chunks []chunkIndex `json:"chunks"`
}

type chunkIndex struct {
	Seq int   `json:"seq"`
	Ts  int64 `json:"ts"`
}

func updateMeta(dir string, seq int, ts int64) error {
	metaPath := filepath.Join(dir, "meta.json")

	var meta replayMeta
	if raw, err := os.ReadFile(metaPath); err == nil {
		_ = json.Unmarshal(raw, &meta)
	}

	updated := false
	for i := range meta.Chunks {
		if meta.Chunks[i].Seq == seq {
			meta.Chunks[i].Ts = ts
			updated = true
			break
		}
	}
	if !updated {
		meta.Chunks = append(meta.Chunks, chunkIndex{Seq: seq, Ts: ts})
	}

	b, err := json.Marshal(meta)
	if err != nil {
		return err
	}
	return os.WriteFile(metaPath, b, 0o644)
}

// sanitizeID strips any character that could allow path traversal.
// Allows alphanumeric, hyphen, and underscore only.
func sanitizeID(id string) string {
	var b strings.Builder
	for _, r := range id {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' {
			b.WriteRune(r)
		}
	}
	return b.String()
}

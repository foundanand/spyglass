package query

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

// ReplayHandler serves GET /v1/sessions/{id}/replay         → manifest
//
//	GET /v1/sessions/{id}/replay/{seq} → raw gzipped chunk
type ReplayHandler struct {
	dataDir string
}

// NewReplayHandler creates a ReplayHandler.
func NewReplayHandler(dataDir string) *ReplayHandler {
	return &ReplayHandler{dataDir: dataDir}
}

func (h *ReplayHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Path: /v1/sessions/{id}/replay[/{seq}]
	// The mux strips nothing for prefix matches — parse from the full path.
	tail := strings.TrimPrefix(r.URL.Path, "/v1/sessions/")
	parts := strings.SplitN(tail, "/", 3)
	// parts[0]=sessionID  parts[1]="replay"  parts[2?]=seq

	if len(parts) < 2 || parts[1] != "replay" {
		http.NotFound(w, r)
		return
	}

	sessionID := sanitizeSessionID(parts[0])
	if sessionID == "" {
		http.Error(w, "invalid session id", http.StatusBadRequest)
		return
	}

	if len(parts) == 2 || parts[2] == "" {
		h.serveManifest(w, sessionID)
		return
	}

	seq, err := strconv.Atoi(parts[2])
	if err != nil || seq < 1 {
		http.Error(w, "invalid seq", http.StatusBadRequest)
		return
	}
	h.serveChunk(w, sessionID, seq)
}

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

type manifestResp struct {
	SessionID string      `json:"session_id"`
	Chunks    []chunkInfo `json:"chunks"`
}

type chunkInfo struct {
	Seq  int    `json:"seq"`
	Ts   int64  `json:"ts,omitempty"`
	Path string `json:"path"`
}

type metaFile struct {
	Chunks []struct {
		Seq int   `json:"seq"`
		Ts  int64 `json:"ts"`
	} `json:"chunks"`
}

func (h *ReplayHandler) serveManifest(w http.ResponseWriter, sessionID string) {
	dir := filepath.Join(h.dataDir, "replays", sessionID)

	// Build ts lookup from meta.json.
	tsMap := map[int]int64{}
	if raw, err := os.ReadFile(filepath.Join(dir, "meta.json")); err == nil {
		var meta metaFile
		if json.Unmarshal(raw, &meta) == nil {
			for _, c := range meta.Chunks {
				tsMap[c.Seq] = c.Ts
			}
		}
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		http.Error(w, "session not found", http.StatusNotFound)
		return
	}

	var chunks []chunkInfo
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".json.gz") {
			continue
		}
		base := strings.TrimSuffix(e.Name(), ".json.gz")
		seq, err := strconv.Atoi(base)
		if err != nil {
			continue
		}
		chunks = append(chunks, chunkInfo{
			Seq:  seq,
			Ts:   tsMap[seq],
			Path: fmt.Sprintf("/v1/sessions/%s/replay/%d", sessionID, seq),
		})
	}
	sort.Slice(chunks, func(i, j int) bool { return chunks[i].Seq < chunks[j].Seq })

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(manifestResp{SessionID: sessionID, Chunks: chunks}) //nolint:errcheck
}

// ---------------------------------------------------------------------------
// Chunk
// ---------------------------------------------------------------------------

func (h *ReplayHandler) serveChunk(w http.ResponseWriter, sessionID string, seq int) {
	chunkPath := filepath.Join(h.dataDir, "replays", sessionID, fmt.Sprintf("%06d.json.gz", seq))
	data, err := os.ReadFile(chunkPath)
	if err != nil {
		http.Error(w, "chunk not found", http.StatusNotFound)
		return
	}
	// Content-Encoding: gzip makes the browser/fetch decompress transparently.
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Content-Encoding", "gzip")
	w.WriteHeader(http.StatusOK)
	w.Write(data) //nolint:errcheck
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func sanitizeSessionID(id string) string {
	var b strings.Builder
	for _, r := range id {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' {
			b.WriteRune(r)
		}
	}
	return b.String()
}

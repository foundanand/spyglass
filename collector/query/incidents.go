package query

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"github.com/foundanand/spyglass/collector/store"
)

// IncidentHandler serves GET /v1/incidents/{event_id}.
// The event must be type 'error' or 'bug_report'.
// Returns the event, breadcrumbs (events ±60s/+10s in same session), and a replay cue.
type IncidentHandler struct {
	st      *store.Store
	dataDir string
}

// NewIncidentHandler creates an IncidentHandler.
func NewIncidentHandler(st *store.Store, dataDir string) *IncidentHandler {
	return &IncidentHandler{st: st, dataDir: dataDir}
}

type incidentResp struct {
	Event       *store.Event  `json:"event"`
	Breadcrumbs []store.Event `json:"breadcrumbs"`
	IncidentTs  int64         `json:"incident_ts"`
	SessionID   string        `json:"session_id"`
	// ReplayCue is the list of replay chunk sequences covering the window,
	// for client-side pre-fetching. Client seeks to incident_ts itself.
	ReplayCue *replayCue `json:"replay_cue,omitempty"`
}

type replayCue struct {
	Chunks []replayCueChunk `json:"chunks"`
}

type replayCueChunk struct {
	Seq  int    `json:"seq"`
	Ts   int64  `json:"ts,omitempty"`
	Path string `json:"path"`
}

func (h *IncidentHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Path: /v1/incidents/{event_id}
	tail := strings.TrimPrefix(r.URL.Path, "/v1/incidents/")
	tail = strings.TrimSuffix(tail, "/")
	eventID, err := strconv.ParseInt(tail, 10, 64)
	if err != nil || eventID <= 0 {
		http.Error(w, "invalid event id", http.StatusBadRequest)
		return
	}

	ev, err := h.st.GetEventByID(eventID)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	if ev == nil {
		http.NotFound(w, r)
		return
	}
	if ev.Type != "error" && ev.Type != "bug_report" {
		http.Error(w, "event is not an error or bug_report", http.StatusBadRequest)
		return
	}

	from := ev.Ts - 60_000  // 60s before
	to := ev.Ts + 10_000    // 10s after

	breadcrumbs, err := h.st.QueryEventsBySessionWindow(ev.SessionID, from, to)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	cue := h.buildReplayCue(ev.SessionID, from, to)

	resp := incidentResp{
		Event:       ev,
		Breadcrumbs: breadcrumbs,
		IncidentTs:  ev.Ts,
		SessionID:   ev.SessionID,
		ReplayCue:   cue,
	}
	if resp.Breadcrumbs == nil {
		resp.Breadcrumbs = []store.Event{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp) //nolint:errcheck
}

// buildReplayCue returns the replay chunks that overlap the [from, to] window.
// Chunk N covers [chunks[N-1].ts, chunks[N].ts). We include any chunk whose
// start ts is <= to and whose end ts (next chunk's ts or ∞) is >= from.
func (h *IncidentHandler) buildReplayCue(sessionID string, from, to int64) *replayCue {
	dir := filepath.Join(h.dataDir, "replays", sanitizeSessionID(sessionID))

	// Load meta.json for timestamps.
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
		return nil
	}

	type chunkEntry struct {
		seq int
		ts  int64
	}
	var all []chunkEntry
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".json.gz") {
			continue
		}
		base := strings.TrimSuffix(e.Name(), ".json.gz")
		seq, err := strconv.Atoi(base)
		if err != nil {
			continue
		}
		all = append(all, chunkEntry{seq: seq, ts: tsMap[seq]})
	}
	sort.Slice(all, func(i, j int) bool { return all[i].seq < all[j].seq })

	// Determine which chunks overlap [from, to].
	// Chunk i starts at all[i].ts and ends just before all[i+1].ts (or ∞).
	var selected []replayCueChunk
	for i, c := range all {
		chunkStart := c.ts
		var chunkEnd int64
		if i+1 < len(all) {
			chunkEnd = all[i+1].ts
		}

		// Include if: chunkStart <= to AND (chunkEnd == 0 OR chunkEnd >= from).
		overlaps := chunkStart <= to && (chunkEnd == 0 || chunkEnd >= from)
		if c.ts == 0 {
			// No timestamp info — include all chunks for safety.
			overlaps = true
		}
		if overlaps {
			selected = append(selected, replayCueChunk{
				Seq:  c.seq,
				Ts:   c.ts,
				Path: "/v1/sessions/" + sessionID + "/replay/" + strconv.Itoa(c.seq),
			})
		}
	}

	if len(selected) == 0 {
		return nil
	}
	return &replayCue{Chunks: selected}
}

package query

import (
	"encoding/base64"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/foundanand/spyglass/collector/store"
)

// ---------------------------------------------------------------------------
// Keyset cursor
// ---------------------------------------------------------------------------

// encodeCursor packs the (ts, id) position of the last returned row.
//
// Opaque on purpose: callers should page by echoing it back, not by doing
// arithmetic on it, so the ordering key can change without breaking clients.
func encodeCursor(ts, id int64) string {
	return base64.RawURLEncoding.EncodeToString([]byte(fmt.Sprintf("%d:%d", ts, id)))
}

// decodeCursor unpacks a cursor. A malformed cursor is ignored rather than
// rejected: the worst case is a caller starting from the top again, which is
// far friendlier than a 400 in the middle of a scroll.
func decodeCursor(raw string) (ts, id int64, ok bool) {
	if raw == "" {
		return 0, 0, false
	}
	b, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil {
		return 0, 0, false
	}
	parts := strings.SplitN(string(b), ":", 2)
	if len(parts) != 2 {
		return 0, 0, false
	}
	ts, err1 := strconv.ParseInt(parts[0], 10, 64)
	id, err2 := strconv.ParseInt(parts[1], 10, 64)
	if err1 != nil || err2 != nil {
		return 0, 0, false
	}
	return ts, id, true
}

// ---------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------

var eventCSVHeader = []string{
	"id", "ts", "iso_ts", "app", "user_id", "session_id", "type", "name", "url", "props",
}

// writeEventsCSV streams matching events straight to the response.
//
// Streamed, not buffered: the filters are the same ones the JSON path uses, so
// an export is always "what I am looking at, as a file" rather than a second,
// subtly different query — and a wide window costs one row of memory at a time.
//
// props is emitted as a single JSON column. A column per discovered key would be
// prettier for uniform data and wrong for everything else: the whole point of
// props is that different events carry different shapes, and a union of every
// key across a mixed export is mostly empty cells.
func writeEventsCSV(w http.ResponseWriter, st *store.Store, q store.EventQuery, filename string) {
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="`+filename+`"`)
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)

	cw := csv.NewWriter(w)
	defer cw.Flush()

	if err := cw.Write(eventCSVHeader); err != nil {
		return
	}

	flusher, _ := w.(http.Flusher)
	n := 0
	_ = st.StreamEvents(q, func(e store.Event) error {
		props := ""
		if len(e.Props) > 0 {
			if b, err := json.Marshal(e.Props); err == nil {
				props = string(b)
			}
		}
		rec := []string{
			strconv.FormatInt(e.ID, 10),
			strconv.FormatInt(e.Ts, 10),
			time.UnixMilli(e.Ts).UTC().Format(time.RFC3339),
			e.App, e.UserID, e.SessionID, e.Type, e.Name, e.URL, props,
		}
		if err := cw.Write(rec); err != nil {
			return err
		}
		// Push bytes to the client periodically so a long export streams rather
		// than sitting in buffers until it finishes.
		n++
		if n%1000 == 0 {
			cw.Flush()
			if flusher != nil {
				flusher.Flush()
			}
		}
		return nil
	})
}

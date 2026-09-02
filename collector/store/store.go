package store

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"path/filepath"
	"sort"
	"strings"
)

// Store wraps a WAL-mode SQLite database.
type Store struct {
	db *sql.DB
}

// Event is one row in the events table.
type Event struct {
	ID        int64                  `json:"id,omitempty"`
	Ts        int64                  `json:"ts"`
	App       string                 `json:"app"`
	UserID    string                 `json:"user_id"`
	SessionID string                 `json:"session_id"`
	Type      string                 `json:"type"`
	Name      string                 `json:"name"`
	URL       string                 `json:"url,omitempty"`
	Props     map[string]interface{} `json:"props,omitempty"`
}

// UserSummary is returned by QueryUsers.
type UserSummary struct {
	UserID       string `json:"user_id"`
	App          string `json:"app"`
	LastSeen     int64  `json:"last_seen"`
	SessionCount int    `json:"session_count"`
}

// EventQuery holds filter parameters for QueryEvents.
type EventQuery struct {
	UserID    string
	EventType string
	App       string
	SessionID string
	From      int64
	To        int64
	Limit     int
	// Cursor pages backwards through history. Keyset, not offset: rows are
	// ordered by (ts DESC, id DESC), so the next page is everything strictly
	// "before" the last row of the previous one.
	//
	// Offset paging would skip and repeat rows constantly here — the live feed
	// is a moving target, and every event that arrives mid-scroll shifts every
	// offset by one. A keyset cursor is stable under insertion because it names
	// a position in the data rather than a distance from the top.
	CursorTs  int64
	CursorID  int64
	HasCursor bool
	// Screen narrows to one page/route.
	//
	// A screen has two representations in the data: a pageview carries the path
	// as its `name`, while an error or network row carries a full URL. Matching
	// either is what makes "errors on this screen" answerable at all — it was
	// previously impossible without reading URLs by hand.
	Screen string
	// ExcludeTypes drops the named event types from the result.
	//
	// The live feed needs this because network rows are ~89% of a real session
	// and were burying the handful of things a person actually did. Excluding in
	// SQL rather than in the browser means the row budget is spent on signal:
	// the same LIMIT covers far more elapsed time.
	ExcludeTypes []string
}

// Open opens (or creates) the spyglass.db in dataDir in WAL mode and runs migrations.
func Open(dataDir string) (*Store, error) {
	dbPath := filepath.Join(dataDir, "spyglass.db")
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, fmt.Errorf("open db: %w", err)
	}

	// Single writer connection avoids "database is locked" under WAL.
	db.SetMaxOpenConns(1)

	for _, pragma := range []string{
		"PRAGMA journal_mode=WAL",
		"PRAGMA busy_timeout=5000",
		"PRAGMA synchronous=NORMAL",
		"PRAGMA foreign_keys=ON",
	} {
		if _, err := db.Exec(pragma); err != nil {
			db.Close()
			return nil, fmt.Errorf("pragma %q: %w", pragma, err)
		}
	}

	if err := migrate(db); err != nil {
		db.Close()
		return nil, fmt.Errorf("migrate: %w", err)
	}

	return &Store{db: db}, nil
}

// Close closes the underlying database.
func (s *Store) Close() error { return s.db.Close() }

// InsertEvents inserts a batch of events in a single transaction.
func (s *Store) InsertEvents(events []Event) error {
	if len(events) == 0 {
		return nil
	}
	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback()

	stmt, err := tx.Prepare(`INSERT INTO events (ts, app, user_id, session_id, type, name, url, props) VALUES (?,?,?,?,?,?,?,?)`)
	if err != nil {
		return fmt.Errorf("prepare insert: %w", err)
	}
	defer stmt.Close()

	for i := range events {
		e := &events[i]
		var propsJSON sql.NullString
		if e.Props != nil {
			b, err := json.Marshal(e.Props)
			if err != nil {
				return fmt.Errorf("marshal props: %w", err)
			}
			propsJSON = sql.NullString{String: string(b), Valid: true}
		}
		var urlVal sql.NullString
		if e.URL != "" {
			urlVal = sql.NullString{String: e.URL, Valid: true}
		}
		if _, err := stmt.Exec(e.Ts, e.App, e.UserID, e.SessionID, e.Type, e.Name, urlVal, propsJSON); err != nil {
			return fmt.Errorf("insert event: %w", err)
		}
	}
	return tx.Commit()
}

// UpsertSession creates or updates a session, updating last_seen on conflict.
func (s *Store) UpsertSession(sessionID, app, userID string, startedAt, lastSeen int64, meta map[string]interface{}) error {
	var metaJSON sql.NullString
	if meta != nil {
		b, err := json.Marshal(meta)
		if err != nil {
			return fmt.Errorf("marshal meta: %w", err)
		}
		metaJSON = sql.NullString{String: string(b), Valid: true}
	}
	_, err := s.db.Exec(`
		INSERT INTO sessions (session_id, app, user_id, started_at, last_seen, meta)
		VALUES (?,?,?,?,?,?)
		ON CONFLICT(session_id) DO UPDATE SET
			last_seen = excluded.last_seen,
			meta      = COALESCE(excluded.meta, meta)
	`, sessionID, app, userID, startedAt, lastSeen, metaJSON)
	return err
}

// StreamEvents calls fn for each matching event, newest first, without
// materialising the whole result. Export uses it so a large window costs the
// collector one row at a time rather than the whole set in memory — the RAM
// target is under 50MB and an unbounded export is the obvious way to blow it.
func (s *Store) StreamEvents(q EventQuery, fn func(Event) error) error {
	var conds []string
	var args []interface{}

	if q.UserID != "" {
		conds = append(conds, "user_id = ?")
		args = append(args, q.UserID)
	}
	if q.EventType != "" {
		conds = append(conds, "type = ?")
		args = append(args, q.EventType)
	}
	if q.App != "" {
		conds = append(conds, "app = ?")
		args = append(args, q.App)
	}
	if q.SessionID != "" {
		conds = append(conds, "session_id = ?")
		args = append(args, q.SessionID)
	}
	if q.From > 0 {
		conds = append(conds, "ts >= ?")
		args = append(args, q.From)
	}
	if q.To > 0 {
		conds = append(conds, "ts <= ?")
		args = append(args, q.To)
	}
	if len(q.ExcludeTypes) > 0 {
		placeholders := make([]string, len(q.ExcludeTypes))
		for i, t := range q.ExcludeTypes {
			placeholders[i] = "?"
			args = append(args, t)
		}
		conds = append(conds, "type NOT IN ("+strings.Join(placeholders, ",")+")")
	}
	if q.Screen != "" {
		conds = append(conds, "((type = 'pageview' AND name = ?) OR url = ? OR url LIKE ?)")
		args = append(args, q.Screen, q.Screen, "%"+q.Screen)
	}
	if q.HasCursor {
		conds = append(conds, "(ts < ? OR (ts = ? AND id < ?))")
		args = append(args, q.CursorTs, q.CursorTs, q.CursorID)
	}

	where := ""
	if len(conds) > 0 {
		where = "WHERE " + strings.Join(conds, " AND ")
	}

	limit := q.Limit
	if limit <= 0 {
		limit = 100
	}
	// Exports stream and may legitimately want far more than a page; the JSON
	// path clamps to 500 before it gets here.
	if limit > MaxExportRows {
		limit = MaxExportRows
	}
	args = append(args, limit)

	// id DESC breaks ts ties deterministically. Without it, two events sharing a
	// millisecond could order differently between two queries, and a keyset
	// cursor built on the last row would skip or repeat.
	query := fmt.Sprintf(
		`SELECT id, ts, app, user_id, session_id, type, name, url, props FROM events %s ORDER BY ts DESC, id DESC LIMIT ?`,
		where,
	)

	rows, err := s.db.Query(query, args...)
	if err != nil {
		return fmt.Errorf("query events: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var e Event
		var url, props sql.NullString
		if err := rows.Scan(&e.ID, &e.Ts, &e.App, &e.UserID, &e.SessionID, &e.Type, &e.Name, &url, &props); err != nil {
			return err
		}
		if url.Valid {
			e.URL = url.String
		}
		if props.Valid && props.String != "" {
			if err := json.Unmarshal([]byte(props.String), &e.Props); err != nil {
				return fmt.Errorf("parse props: %w", err)
			}
		}
		if err := fn(e); err != nil {
			return err
		}
	}
	return rows.Err()
}

// MaxExportRows bounds a single streamed export. Generous enough that no
// realistic window hits it, finite so one request cannot run unbounded.
const MaxExportRows = 500_000

// QueryEvents returns events matching q, newest first.
func (s *Store) QueryEvents(q EventQuery) ([]Event, error) {
	var out []Event
	err := s.StreamEvents(q, func(e Event) error {
		out = append(out, e)
		return nil
	})
	return out, err
}

// QueryUsers returns active users with last_seen and session count.
//
// from/to bound the window by session activity, so "who was active this week"
// is answerable rather than only "who has ever used this". Zero means unbounded
// on that side.
func (s *Store) QueryUsers(limit int, from, to int64) ([]UserSummary, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	var conds []string
	var args []interface{}
	if from > 0 {
		conds = append(conds, "last_seen >= ?")
		args = append(args, from)
	}
	if to > 0 {
		conds = append(conds, "started_at <= ?")
		args = append(args, to)
	}
	where := ""
	if len(conds) > 0 {
		where = "WHERE " + strings.Join(conds, " AND ")
	}
	args = append(args, limit)
	rows, err := s.db.Query(`
		SELECT user_id, app, MAX(last_seen) AS last_seen, COUNT(*) AS session_count
		FROM sessions `+where+`
		GROUP BY user_id, app
		ORDER BY last_seen DESC
		LIMIT ?
	`, args...)
	if err != nil {
		return nil, fmt.Errorf("query users: %w", err)
	}
	defer rows.Close()

	var out []UserSummary
	for rows.Next() {
		var u UserSummary
		if err := rows.Scan(&u.UserID, &u.App, &u.LastSeen, &u.SessionCount); err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

// CountsByType returns the number of events of each type in the window.
//
// The live feed hides network events by default; without a count the user
// cannot tell whether network capture is off or merely filtered. The chip
// reads "network 254", which advertises the data and explains its absence.
func (s *Store) CountsByType(app, userID string, from, to int64) (map[string]int, error) {
	var conds []string
	var args []interface{}
	if app != "" {
		conds = append(conds, "app = ?")
		args = append(args, app)
	}
	if userID != "" {
		conds = append(conds, "user_id = ?")
		args = append(args, userID)
	}
	if from > 0 {
		conds = append(conds, "ts >= ?")
		args = append(args, from)
	}
	if to > 0 {
		conds = append(conds, "ts <= ?")
		args = append(args, to)
	}
	where := ""
	if len(conds) > 0 {
		where = "WHERE " + strings.Join(conds, " AND ")
	}
	rows, err := s.db.Query(`SELECT type, COUNT(*) FROM events `+where+` GROUP BY type`, args...)
	if err != nil {
		return nil, fmt.Errorf("counts by type: %w", err)
	}
	defer rows.Close()

	out := map[string]int{}
	for rows.Next() {
		var t string
		var n int
		if err := rows.Scan(&t, &n); err != nil {
			return nil, err
		}
		out[t] = n
	}
	return out, rows.Err()
}

// BumpChunkCount increments chunk_count for a session (replay ingest).
func (s *Store) BumpChunkCount(sessionID string) error {
	_, err := s.db.Exec(`UPDATE sessions SET chunk_count = chunk_count + 1 WHERE session_id = ?`, sessionID)
	return err
}

// Session is one row in the sessions table.
type Session struct {
	SessionID  string                 `json:"session_id"`
	App        string                 `json:"app"`
	UserID     string                 `json:"user_id"`
	StartedAt  int64                  `json:"started_at"`
	LastSeen   int64                  `json:"last_seen"`
	ChunkCount int                    `json:"chunk_count"`
	EventCount int                    `json:"event_count"`
	ErrorCount int                    `json:"error_count"`
	Meta       map[string]interface{} `json:"meta,omitempty"`
}

// GetEventByID returns a single event by primary key, or nil if not found.
func (s *Store) GetEventByID(id int64) (*Event, error) {
	row := s.db.QueryRow(
		`SELECT id, ts, app, user_id, session_id, type, name, url, props FROM events WHERE id = ?`, id,
	)
	var e Event
	var url, props sql.NullString
	if err := row.Scan(&e.ID, &e.Ts, &e.App, &e.UserID, &e.SessionID, &e.Type, &e.Name, &url, &props); err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	if url.Valid {
		e.URL = url.String
	}
	if props.Valid && props.String != "" {
		if err := json.Unmarshal([]byte(props.String), &e.Props); err != nil {
			return nil, fmt.Errorf("parse props: %w", err)
		}
	}
	return &e, nil
}

// QueryEventsBySessionWindow returns all events for a session in [from, to] ordered by ts asc.
func (s *Store) QueryEventsBySessionWindow(sessionID string, from, to int64) ([]Event, error) {
	rows, err := s.db.Query(
		`SELECT id, ts, app, user_id, session_id, type, name, url, props
		 FROM events
		 WHERE session_id = ? AND ts >= ? AND ts <= ?
		 ORDER BY ts ASC`,
		sessionID, from, to,
	)
	if err != nil {
		return nil, fmt.Errorf("query session window: %w", err)
	}
	defer rows.Close()

	var out []Event
	for rows.Next() {
		var e Event
		var url, props sql.NullString
		if err := rows.Scan(&e.ID, &e.Ts, &e.App, &e.UserID, &e.SessionID, &e.Type, &e.Name, &url, &props); err != nil {
			return nil, err
		}
		if url.Valid {
			e.URL = url.String
		}
		if props.Valid && props.String != "" {
			if err := json.Unmarshal([]byte(props.String), &e.Props); err != nil {
				return nil, fmt.Errorf("parse props: %w", err)
			}
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// StepTiming describes how long a transition took, over the users who made it.
//
// No mean is reported, deliberately. An inferred gap between two events has no
// upper bound — someone who starts on Friday and finishes on Monday contributes
// 72 hours — and a mean is exactly the statistic that ruins. p50 and p90 are
// robust to that; Samples says how much to trust them.
type StepTiming struct {
	P50Ms   int64 `json:"p50_ms"`
	P90Ms   int64 `json:"p90_ms"`
	Samples int   `json:"samples"`
}

// FunnelStep is one step of a funnel with the count of users who reached it.
type FunnelStep struct {
	Name  string `json:"name"`
	Count int    `json:"count"`
	// FromPrev is how long users took to get here from the previous step.
	// Nil on the first step, and on any step where no conversion fell within
	// the cap.
	FromPrev *StepTiming `json:"from_prev,omitempty"`
}

// FunnelResult is a funnel's steps plus the end-to-end conversion time.
type FunnelResult struct {
	Steps []FunnelStep `json:"steps"`
	// ToConvert is first step → last step for users who completed the whole
	// funnel without any single transition exceeding the cap.
	ToConvert *StepTiming `json:"to_convert,omitempty"`
}

// FunnelQuery parameterises Funnel.
type FunnelQuery struct {
	Steps []string
	App   string
	From  int64
	To    int64
	// MaxStepMs excludes a transition longer than this from the *timing*, while
	// still counting it as a conversion. Zero means no cap.
	//
	// A cap is needed because the gap between two events includes lunch, the
	// weekend, and the tab left open overnight. It is a timing filter only:
	// dropping the conversion as well would silently understate the funnel.
	MaxStepMs int64
}

// DefaultMaxStepMs matches the SDK's flow timeout and the 30-minute session
// idle window: past this, the two events are not really one sitting.
//
// A funnel that legitimately spans days (sign-up → first invoice) should pass a
// larger cap explicitly. The Samples field makes an over-tight cap visible
// rather than silent.
const DefaultMaxStepMs int64 = 30 * 60 * 1000

// Funnel computes a simple sequential funnel over event names. For each user it
// walks their events (within the optional app/time window) in time order and
// advances through the step list whenever the next step's name is seen; the
// count for step i is the number of users who reached at least step i.
// "Good enough" funnel semantics — no fan-out, no per-step time limits.
func (s *Store) Funnel(q FunnelQuery) (FunnelResult, error) {
	steps, app, from, to := q.Steps, q.App, q.From, q.To

	out := make([]FunnelStep, len(steps))
	for i, name := range steps {
		out[i] = FunnelStep{Name: name}
	}
	if len(steps) == 0 {
		return FunnelResult{Steps: out}, nil
	}

	conds := []string{"name IN (" + placeholders(len(steps)) + ")"}
	args := make([]interface{}, 0, len(steps)+3)
	for _, s := range steps {
		args = append(args, s)
	}
	if app != "" {
		conds = append(conds, "app = ?")
		args = append(args, app)
	}
	if from > 0 {
		conds = append(conds, "ts >= ?")
		args = append(args, from)
	}
	if to > 0 {
		conds = append(conds, "ts <= ?")
		args = append(args, to)
	}

	// ts joins the projection: counts localise a problem to a step, durations
	// explain it, and the timestamps are already in the rows being walked.
	query := `SELECT user_id, name, ts FROM events WHERE ` +
		strings.Join(conds, " AND ") + ` ORDER BY user_id, ts ASC`

	rows, err := s.db.Query(query, args...)
	if err != nil {
		return FunnelResult{}, fmt.Errorf("funnel query: %w", err)
	}
	defer rows.Close()

	stepIndex := make(map[string]int, len(steps))
	for i, name := range steps {
		// First occurrence wins so repeated step names map to the earliest step.
		if _, ok := stepIndex[name]; !ok {
			stepIndex[name] = i
		}
	}

	// gaps[i] holds the durations from step i-1 to step i, over users who made
	// that transition inside the cap. gaps[0] is unused.
	gaps := make([][]int64, len(steps))
	var overall []int64

	var curUser string
	progress := 0    // next step index this user must hit
	var prevTs int64 // timestamp of the step this user last reached
	var firstTs int64
	withinCap := true // every transition so far was inside the cap

	flush := func() {
		// User reached steps [0, progress); bump those counts.
		for i := 0; i < progress; i++ {
			out[i].Count++
		}
		if progress == len(steps) && withinCap && len(steps) > 1 {
			overall = append(overall, prevTs-firstTs)
		}
	}

	for rows.Next() {
		var user, name string
		var ts int64
		if err := rows.Scan(&user, &name, &ts); err != nil {
			return FunnelResult{}, err
		}
		if user != curUser {
			if curUser != "" {
				flush()
			}
			curUser = user
			progress = 0
			prevTs = 0
			firstTs = 0
			withinCap = true
		}
		// Advance only when this event matches the very next expected step.
		if progress < len(steps) && steps[progress] == name {
			if progress == 0 {
				firstTs = ts
			} else {
				gap := ts - prevTs
				// Count the conversion either way; time it only if it is
				// plausibly one sitting.
				if q.MaxStepMs <= 0 || gap <= q.MaxStepMs {
					gaps[progress] = append(gaps[progress], gap)
				} else {
					withinCap = false
				}
			}
			prevTs = ts
			progress++
		}
	}
	if curUser != "" {
		flush()
	}
	if err := rows.Err(); err != nil {
		return FunnelResult{}, err
	}

	for i := 1; i < len(steps); i++ {
		out[i].FromPrev = summariseTiming(gaps[i])
	}
	return FunnelResult{Steps: out, ToConvert: summariseTiming(overall)}, nil
}

// summariseTiming reduces raw durations to p50/p90, or nil when there are none.
func summariseTiming(durations []int64) *StepTiming {
	if len(durations) == 0 {
		return nil
	}
	sort.Slice(durations, func(i, j int) bool { return durations[i] < durations[j] })
	return &StepTiming{
		P50Ms:   percentile(durations, 0.50),
		P90Ms:   percentile(durations, 0.90),
		Samples: len(durations),
	}
}

// DayCount is a per-day aggregate (day in YYYY-MM-DD, UTC).
type DayCount struct {
	Day   string `json:"day"`
	Count int    `json:"count"`
}

// NameCount is a name → count aggregate.
type NameCount struct {
	Name  string `json:"name"`
	Count int    `json:"count"`
}

// aggWhere builds a WHERE clause for the common app/time-window filters.
func aggWhere(app string, from, to int64, extra ...string) (string, []interface{}) {
	conds := append([]string{}, extra...)
	var args []interface{}
	if app != "" {
		conds = append(conds, "app = ?")
		args = append(args, app)
	}
	if from > 0 {
		conds = append(conds, "ts >= ?")
		args = append(args, from)
	}
	if to > 0 {
		conds = append(conds, "ts <= ?")
		args = append(args, to)
	}
	if len(conds) == 0 {
		return "", args
	}
	return "WHERE " + strings.Join(conds, " AND "), args
}

// dayExpr builds the SQL expression that buckets an event into a calendar day.
//
// Days are bucketed in the *viewer's* timezone, not UTC. A range picker makes
// the difference visible: an operator in IST reading "errors by day" over a UTC
// bucket sees their days split at 05:30, so Tuesday's spike lands half in
// Monday. The dashboard sends its own offset (minutes east of UTC, as
// -Date.getTimezoneOffset()), which is correct for whoever is looking without
// adding a config key nobody would remember to set.
//
// Offset is clamped to ±14h, the real-world maximum, so a malformed parameter
// cannot inject into the modifier string.
func dayExpr(tzOffsetMin int) string {
	if tzOffsetMin < -840 || tzOffsetMin > 840 {
		tzOffsetMin = 0
	}
	if tzOffsetMin == 0 {
		return "date(ts/1000, 'unixepoch')"
	}
	return fmt.Sprintf("date(ts/1000, 'unixepoch', '%+d minutes')", tzOffsetMin)
}

func (s *Store) dayCounts(where string, args []interface{}, tzOffsetMin int) ([]DayCount, error) {
	q := `SELECT ` + dayExpr(tzOffsetMin) + ` AS day, COUNT(DISTINCT user_id) AS c
	      FROM events ` + where + ` GROUP BY day ORDER BY day ASC`
	rows, err := s.db.Query(q, args...)
	if err != nil {
		return nil, fmt.Errorf("day counts: %w", err)
	}
	defer rows.Close()
	var out []DayCount
	for rows.Next() {
		var d DayCount
		if err := rows.Scan(&d.Day, &d.Count); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// DAU returns daily active (distinct) user counts in the window, bucketed by
// calendar day in the viewer's timezone (see dayExpr).
func (s *Store) DAU(app string, from, to int64, tzOffsetMin int) ([]DayCount, error) {
	where, args := aggWhere(app, from, to)
	return s.dayCounts(where, args, tzOffsetMin)
}

// ErrorsByDay returns the per-day count of error events in the window.
func (s *Store) ErrorsByDay(app string, from, to int64, tzOffsetMin int) ([]DayCount, error) {
	where, args := aggWhere(app, from, to, "type = 'error'")
	q := `SELECT ` + dayExpr(tzOffsetMin) + ` AS day, COUNT(*) AS c
	      FROM events ` + where + ` GROUP BY day ORDER BY day ASC`
	rows, err := s.db.Query(q, args...)
	if err != nil {
		return nil, fmt.Errorf("errors by day: %w", err)
	}
	defer rows.Close()
	var out []DayCount
	for rows.Next() {
		var d DayCount
		if err := rows.Scan(&d.Day, &d.Count); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// topByType returns the top event names of a given type, by count.
func (s *Store) topByType(typ, app string, from, to int64, limit int) ([]NameCount, error) {
	if limit <= 0 || limit > 100 {
		limit = 10
	}
	where, args := aggWhere(app, from, to, "type = ?")
	// Prepend the type arg so it lines up with the first '?' in the WHERE clause.
	args = append([]interface{}{typ}, args...)
	q := `SELECT name, COUNT(*) AS c FROM events ` + where +
		` GROUP BY name ORDER BY c DESC LIMIT ?`
	args = append(args, limit)
	rows, err := s.db.Query(q, args...)
	if err != nil {
		return nil, fmt.Errorf("top %s: %w", typ, err)
	}
	defer rows.Close()
	var out []NameCount
	for rows.Next() {
		var n NameCount
		if err := rows.Scan(&n.Name, &n.Count); err != nil {
			return nil, err
		}
		out = append(out, n)
	}
	return out, rows.Err()
}

// TopEvents returns the most frequent captured event names.
func (s *Store) TopEvents(app string, from, to int64, limit int) ([]NameCount, error) {
	return s.topByType("event", app, from, to, limit)
}

// TopPages returns the most frequent pageview paths.
func (s *Store) TopPages(app string, from, to int64, limit int) ([]NameCount, error) {
	return s.topByType("pageview", app, from, to, limit)
}

// DeleteEventsBefore removes events with ts < cutoffMs and returns the count.
func (s *Store) DeleteEventsBefore(cutoffMs int64) (int64, error) {
	res, err := s.db.Exec(`DELETE FROM events WHERE ts < ?`, cutoffMs)
	if err != nil {
		return 0, fmt.Errorf("delete old events: %w", err)
	}
	return res.RowsAffected()
}

// placeholders returns "?,?,?" with n marks.
func placeholders(n int) string {
	if n <= 0 {
		return ""
	}
	return strings.Repeat("?,", n-1) + "?"
}

// ListSessions returns sessions ordered by last_seen desc.
// ListSessions returns recent sessions, most recently active first. from/to
// bound the window by session activity; zero means unbounded on that side.
func (s *Store) ListSessions(limit int, from, to int64) ([]Session, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	var conds []string
	var args []interface{}
	if from > 0 {
		conds = append(conds, "s.last_seen >= ?")
		args = append(args, from)
	}
	if to > 0 {
		conds = append(conds, "s.started_at <= ?")
		args = append(args, to)
	}
	where := ""
	if len(conds) > 0 {
		where = "WHERE " + strings.Join(conds, " AND ")
	}
	args = append(args, limit)
	rows, err := s.db.Query(`
		SELECT s.session_id, s.app, s.user_id, s.started_at, s.last_seen, s.chunk_count, s.meta,
		       (SELECT COUNT(*) FROM events e WHERE e.session_id = s.session_id) AS event_count,
		       (SELECT COUNT(*) FROM events e WHERE e.session_id = s.session_id AND e.type = 'error') AS error_count
		FROM sessions s `+where+`
		ORDER BY s.last_seen DESC
		LIMIT ?
	`, args...)
	if err != nil {
		return nil, fmt.Errorf("list sessions: %w", err)
	}
	defer rows.Close()

	var out []Session
	for rows.Next() {
		var sess Session
		var meta sql.NullString
		if err := rows.Scan(&sess.SessionID, &sess.App, &sess.UserID, &sess.StartedAt, &sess.LastSeen, &sess.ChunkCount, &meta, &sess.EventCount, &sess.ErrorCount); err != nil {
			return nil, err
		}
		if meta.Valid && meta.String != "" {
			_ = json.Unmarshal([]byte(meta.String), &sess.Meta)
		}
		out = append(out, sess)
	}
	return out, rows.Err()
}

// LatestEventID finds the id of a just-inserted event, so a notification can
// deep-link to its incident view.
//
// InsertEvents writes a batch through one prepared statement and does not hand
// back ids; rather than reshape that hot path for an optional feature, the
// notifier looks the row up by its natural key afterwards.
func (s *Store) LatestEventID(sessionID string, ts int64, typ, name string) (int64, error) {
	var id int64
	err := s.db.QueryRow(
		`SELECT id FROM events
		 WHERE session_id = ? AND ts = ? AND type = ? AND name = ?
		 ORDER BY id DESC LIMIT 1`,
		sessionID, ts, typ, name,
	).Scan(&id)
	return id, err
}

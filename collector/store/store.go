package store

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"path/filepath"
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
	From      int64
	To        int64
	Limit     int
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

// QueryEvents returns events matching q, newest first.
func (s *Store) QueryEvents(q EventQuery) ([]Event, error) {
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
	if q.From > 0 {
		conds = append(conds, "ts >= ?")
		args = append(args, q.From)
	}
	if q.To > 0 {
		conds = append(conds, "ts <= ?")
		args = append(args, q.To)
	}

	where := ""
	if len(conds) > 0 {
		where = "WHERE " + strings.Join(conds, " AND ")
	}

	limit := q.Limit
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	args = append(args, limit)

	query := fmt.Sprintf(
		`SELECT id, ts, app, user_id, session_id, type, name, url, props FROM events %s ORDER BY ts DESC LIMIT ?`,
		where,
	)

	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("query events: %w", err)
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

// QueryUsers returns active users with last_seen and session count.
func (s *Store) QueryUsers(limit int) ([]UserSummary, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	rows, err := s.db.Query(`
		SELECT user_id, app, MAX(last_seen) AS last_seen, COUNT(*) AS session_count
		FROM sessions
		GROUP BY user_id, app
		ORDER BY last_seen DESC
		LIMIT ?
	`, limit)
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

// ListSessions returns sessions ordered by last_seen desc.
func (s *Store) ListSessions(limit int) ([]Session, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	rows, err := s.db.Query(`
		SELECT session_id, app, user_id, started_at, last_seen, chunk_count, meta
		FROM sessions
		ORDER BY last_seen DESC
		LIMIT ?
	`, limit)
	if err != nil {
		return nil, fmt.Errorf("list sessions: %w", err)
	}
	defer rows.Close()

	var out []Session
	for rows.Next() {
		var sess Session
		var meta sql.NullString
		if err := rows.Scan(&sess.SessionID, &sess.App, &sess.UserID, &sess.StartedAt, &sess.LastSeen, &sess.ChunkCount, &meta); err != nil {
			return nil, err
		}
		if meta.Valid && meta.String != "" {
			_ = json.Unmarshal([]byte(meta.String), &sess.Meta)
		}
		out = append(out, sess)
	}
	return out, rows.Err()
}

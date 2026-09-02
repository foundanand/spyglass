package store

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// ViewKind is one of the query shapes a saved view can wrap.
//
// Deliberately a closed set matching the endpoints that already exist: a saved
// view is a name attached to a parameter set, not a query language.
type ViewKind string

const (
	ViewFlows      ViewKind = "flows"
	ViewFunnel     ViewKind = "funnel"
	ViewAggregates ViewKind = "aggregates"
	ViewEvents     ViewKind = "events"
)

// ValidViewKind reports whether kind is one of the supported query shapes.
func ValidViewKind(kind string) bool {
	switch ViewKind(kind) {
	case ViewFlows, ViewFunnel, ViewAggregates, ViewEvents:
		return true
	}
	return false
}

// View is a named, saved query configuration.
type View struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
	Kind string `json:"kind"`
	// Params is passed to the matching query endpoint verbatim.
	Params    map[string]interface{} `json:"params"`
	CreatedAt int64                  `json:"created_at"`
	UpdatedAt int64                  `json:"updated_at"`
}

// Board is a named, ordered collection of saved views.
type Board struct {
	ID        int64  `json:"id"`
	Name      string `json:"name"`
	CreatedAt int64  `json:"created_at"`
	Views     []View `json:"views"`
}

const maxViewNameLen = 120

func validateView(name, kind string) error {
	if strings.TrimSpace(name) == "" {
		return fmt.Errorf("view: name is required")
	}
	if len(name) > maxViewNameLen {
		return fmt.Errorf("view: name is longer than %d characters", maxViewNameLen)
	}
	if !ValidViewKind(kind) {
		return fmt.Errorf("view: kind must be one of flows, funnel, aggregates, events")
	}
	return nil
}

// CreateView saves a named query configuration.
func (s *Store) CreateView(name, kind string, params map[string]interface{}) (*View, error) {
	if err := validateView(name, kind); err != nil {
		return nil, err
	}
	if params == nil {
		params = map[string]interface{}{}
	}
	blob, err := json.Marshal(params)
	if err != nil {
		return nil, fmt.Errorf("view: marshal params: %w", err)
	}

	now := time.Now().UnixMilli()
	res, err := s.db.Exec(
		`INSERT INTO views (name, kind, params, created_at, updated_at) VALUES (?,?,?,?,?)`,
		strings.TrimSpace(name), kind, string(blob), now, now,
	)
	if err != nil {
		return nil, fmt.Errorf("create view: %w", err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		return nil, err
	}
	return &View{ID: id, Name: strings.TrimSpace(name), Kind: kind, Params: params, CreatedAt: now, UpdatedAt: now}, nil
}

// UpdateView replaces a saved view's name and parameters.
func (s *Store) UpdateView(id int64, name, kind string, params map[string]interface{}) (*View, error) {
	if err := validateView(name, kind); err != nil {
		return nil, err
	}
	if params == nil {
		params = map[string]interface{}{}
	}
	blob, err := json.Marshal(params)
	if err != nil {
		return nil, fmt.Errorf("view: marshal params: %w", err)
	}

	now := time.Now().UnixMilli()
	res, err := s.db.Exec(
		`UPDATE views SET name = ?, kind = ?, params = ?, updated_at = ? WHERE id = ?`,
		strings.TrimSpace(name), kind, string(blob), now, id,
	)
	if err != nil {
		return nil, fmt.Errorf("update view: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return nil, nil
	}
	return s.GetView(id)
}

func scanView(rowScan func(...interface{}) error) (*View, error) {
	var v View
	var params string
	if err := rowScan(&v.ID, &v.Name, &v.Kind, &params, &v.CreatedAt, &v.UpdatedAt); err != nil {
		return nil, err
	}
	if params != "" {
		if err := json.Unmarshal([]byte(params), &v.Params); err != nil {
			return nil, fmt.Errorf("view %d: parse params: %w", v.ID, err)
		}
	}
	if v.Params == nil {
		v.Params = map[string]interface{}{}
	}
	return &v, nil
}

// GetView returns one saved view, or nil if it does not exist.
func (s *Store) GetView(id int64) (*View, error) {
	row := s.db.QueryRow(
		`SELECT id, name, kind, params, created_at, updated_at FROM views WHERE id = ?`, id)
	v, err := scanView(row.Scan)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return v, err
}

// ListViews returns every saved view, newest first.
func (s *Store) ListViews() ([]View, error) {
	rows, err := s.db.Query(
		`SELECT id, name, kind, params, created_at, updated_at FROM views ORDER BY created_at DESC, id DESC`)
	if err != nil {
		return nil, fmt.Errorf("list views: %w", err)
	}
	defer rows.Close()

	var out []View
	for rows.Next() {
		v, err := scanView(rows.Scan)
		if err != nil {
			return nil, err
		}
		out = append(out, *v)
	}
	return out, rows.Err()
}

// DeleteView removes a saved view. Boards referencing it drop the panel (the
// join rows cascade) rather than breaking.
func (s *Store) DeleteView(id int64) (bool, error) {
	res, err := s.db.Exec(`DELETE FROM views WHERE id = ?`, id)
	if err != nil {
		return false, fmt.Errorf("delete view: %w", err)
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

// ---------------------------------------------------------------------------
// Boards
// ---------------------------------------------------------------------------

// CreateBoard creates a named board holding viewIDs in the given order.
func (s *Store) CreateBoard(name string, viewIDs []int64) (*Board, error) {
	if strings.TrimSpace(name) == "" {
		return nil, fmt.Errorf("board: name is required")
	}
	if len(name) > maxViewNameLen {
		return nil, fmt.Errorf("board: name is longer than %d characters", maxViewNameLen)
	}

	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	now := time.Now().UnixMilli()
	res, err := tx.Exec(`INSERT INTO boards (name, created_at) VALUES (?,?)`, strings.TrimSpace(name), now)
	if err != nil {
		return nil, fmt.Errorf("create board: %w", err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		return nil, err
	}
	if err := setBoardViews(tx, id, viewIDs); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return s.GetBoard(id)
}

// SetBoardViews replaces a board's panels and their order.
func (s *Store) SetBoardViews(boardID int64, viewIDs []int64) (*Board, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var exists int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM boards WHERE id = ?`, boardID).Scan(&exists); err != nil {
		return nil, err
	}
	if exists == 0 {
		return nil, nil
	}
	if _, err := tx.Exec(`DELETE FROM board_views WHERE board_id = ?`, boardID); err != nil {
		return nil, err
	}
	if err := setBoardViews(tx, boardID, viewIDs); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return s.GetBoard(boardID)
}

func setBoardViews(tx *sql.Tx, boardID int64, viewIDs []int64) error {
	seen := make(map[int64]bool, len(viewIDs))
	pos := 0
	for _, vid := range viewIDs {
		// A board holding the same panel twice is a mistake, not a feature, and
		// the primary key would reject it anyway.
		if seen[vid] {
			continue
		}
		seen[vid] = true
		if _, err := tx.Exec(
			`INSERT INTO board_views (board_id, view_id, position) VALUES (?,?,?)`,
			boardID, vid, pos,
		); err != nil {
			return fmt.Errorf("board: add view %d: %w", vid, err)
		}
		pos++
	}
	return nil
}

// GetBoard returns a board with its views in order, or nil if absent.
func (s *Store) GetBoard(id int64) (*Board, error) {
	var b Board
	err := s.db.QueryRow(`SELECT id, name, created_at FROM boards WHERE id = ?`, id).
		Scan(&b.ID, &b.Name, &b.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	rows, err := s.db.Query(`
		SELECT v.id, v.name, v.kind, v.params, v.created_at, v.updated_at
		FROM board_views bv JOIN views v ON v.id = bv.view_id
		WHERE bv.board_id = ?
		ORDER BY bv.position ASC`, id)
	if err != nil {
		return nil, fmt.Errorf("board views: %w", err)
	}
	defer rows.Close()

	b.Views = []View{}
	for rows.Next() {
		v, err := scanView(rows.Scan)
		if err != nil {
			return nil, err
		}
		b.Views = append(b.Views, *v)
	}
	return &b, rows.Err()
}

// ListBoards returns every board with its views.
func (s *Store) ListBoards() ([]Board, error) {
	rows, err := s.db.Query(`SELECT id FROM boards ORDER BY created_at ASC, id ASC`)
	if err != nil {
		return nil, fmt.Errorf("list boards: %w", err)
	}
	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return nil, err
		}
		ids = append(ids, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	out := make([]Board, 0, len(ids))
	for _, id := range ids {
		b, err := s.GetBoard(id)
		if err != nil {
			return nil, err
		}
		if b != nil {
			out = append(out, *b)
		}
	}
	return out, nil
}

// DeleteBoard removes a board. Its saved views survive — they are independent
// objects that may appear on other boards.
func (s *Store) DeleteBoard(id int64) (bool, error) {
	res, err := s.db.Exec(`DELETE FROM boards WHERE id = ?`, id)
	if err != nil {
		return false, fmt.Errorf("delete board: %w", err)
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

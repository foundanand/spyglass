package store

import (
	"database/sql"
	"fmt"
	"math"
	"sort"
	"strings"
)

// Flow aggregation — the read side of the SDK's flow timing (see sdk/src/flow.ts).
//
// Every `flow` event carries the whole measurement in its props:
//
//	{"duration_ms": 12000, "outcome": "completed", ...app-specific context}
//
// so aggregating is a matter of pulling those numbers and summarising them.
// Percentiles are computed in Go rather than SQL: SQLite has no percentile
// aggregate, the emulations (window functions over ordered rows) are slow and
// unreadable, and spyglass exists for the 20–200-user case where a window's
// worth of durations is thousands of rows, not billions.

// maxFlowSamples caps how many durations one aggregate will pull into memory.
// Well past anything a small closed-loop app produces, and a hard ceiling on
// what a crafted time window can make the collector allocate.
const maxFlowSamples = 200_000

// FlowStat summarises one flow (optionally within one group — see FlowQuery.GroupBy).
type FlowStat struct {
	Name string `json:"name"`
	// Group is the value this row is bucketed by: a user id, a YYYY-MM-DD day,
	// or a prop value. Empty when the query is ungrouped.
	Group string `json:"group,omitempty"`

	// Completions is the number of times the flow finished successfully; the
	// duration statistics below describe those runs only. A run that was
	// abandoned halfway tells you nothing about how long the action takes.
	Completions int `json:"completions"`
	Abandons    int `json:"abandons"`
	Failures    int `json:"failures"`

	// AbandonRate is abandons / (completions + abandons + failures), rounded to
	// four decimals. Reported next to the durations because they mislead
	// without it: a fast median often just means the slow attempts gave up.
	AbandonRate float64 `json:"abandon_rate"`

	// Durations in milliseconds over completed runs. Zero when Completions is 0.
	P50  int64 `json:"p50_ms"`
	P90  int64 `json:"p90_ms"`
	P95  int64 `json:"p95_ms"`
	Mean int64 `json:"mean_ms"`
	Min  int64 `json:"min_ms"`
	Max  int64 `json:"max_ms"`
	// Total time users spent on this flow, completed runs only. What "we could
	// give the team back an hour a week" is computed from.
	TotalMs int64 `json:"total_ms"`
}

// FlowGroupBy selects how flow rows are bucketed.
type FlowGroupBy struct {
	// Kind is "", "user", "day", "prop", "session", or "trait".
	Kind string
	// PropKey is the key to bucket by: an event props key when Kind == "prop",
	// a session meta key (viewport_bucket, ua, tz, …) when Kind == "session",
	// or a user trait (role, team, plan) when Kind == "trait".
	PropKey string
}

// needsSessionJoin reports whether the grouping reads from the sessions table.
func (g FlowGroupBy) needsSessionJoin() bool {
	return g.Kind == "session" || g.Kind == "trait"
}

// FlowQuery filters and groups a flow aggregate.
type FlowQuery struct {
	App     string
	Name    string // single flow; empty means every flow
	From    int64
	To      int64
	GroupBy FlowGroupBy
	// Traits narrows to sessions whose user carried these trait values —
	// "flows for Employees only" is as useful a question as "flows per role".
	// Keys are bound as JSON paths, never interpolated.
	Traits map[string]string
	// Limit caps the number of returned rows (most-run flows/groups first).
	Limit int
}

// flowRow is one raw sample read out of SQLite.
type flowRow struct {
	name     string
	group    string
	duration int64
	outcome  string
}

// groupExpr returns the SQL expression that produces a row's group value.
func (g FlowGroupBy) groupExpr() (string, []interface{}) {
	switch g.Kind {
	case "user":
		return "e.user_id", nil
	case "day":
		return "date(e.ts/1000, 'unixepoch')", nil
	case "prop":
		// json_extract with a bound path: the key never reaches the SQL text,
		// so a prop name cannot alter the statement.
		return "COALESCE(CAST(json_extract(e.props, ?) AS TEXT), '')", []interface{}{"$." + g.PropKey}
	case "session":
		// Session context (viewport, browser, timezone) lives on the session
		// row, so this is the axis that turns "task.create takes 52s" into "on
		// mobile it takes 2m10s". Same bound-path safety as prop.
		return "COALESCE(CAST(json_extract(s.meta, ?) AS TEXT), '')", []interface{}{"$." + g.PropKey}
	case "trait":
		// User cohort attributes, stored in the same session meta blob under
		// "traits". Grouping by role or team is what turns a 200-row per-user
		// table into a finding — and keeps it a statement about the software
		// rather than about a named person.
		return "COALESCE(CAST(json_extract(s.meta, ?) AS TEXT), '')", []interface{}{"$.traits." + g.PropKey}
	default:
		return "''", nil
	}
}

// Flows aggregates flow durations, optionally grouped.
//
// Rows whose props carry no numeric duration_ms are ignored: they are not flow
// measurements, whatever else they may be.
func (s *Store) Flows(q FlowQuery) ([]FlowStat, error) {
	if q.GroupBy.Kind == "prop" && q.GroupBy.PropKey == "" {
		return nil, fmt.Errorf("flows: group by prop needs a prop key")
	}
	if q.GroupBy.Kind == "session" && q.GroupBy.PropKey == "" {
		return nil, fmt.Errorf("flows: group by session needs a meta key")
	}
	if q.GroupBy.Kind == "trait" && q.GroupBy.PropKey == "" {
		return nil, fmt.Errorf("flows: group by trait needs a trait key")
	}

	groupSQL, groupArgs := q.GroupBy.groupExpr()

	// Selected columns first, then filters — argument order has to match.
	args := append([]interface{}{}, groupArgs...)

	conds := []string{"e.type = 'flow'", "json_extract(e.props, '$.duration_ms') IS NOT NULL"}
	if q.App != "" {
		conds = append(conds, "e.app = ?")
		args = append(args, q.App)
	}
	if q.Name != "" {
		conds = append(conds, "e.name = ?")
		args = append(args, q.Name)
	}
	if q.From > 0 {
		conds = append(conds, "e.ts >= ?")
		args = append(args, q.From)
	}
	if q.To > 0 {
		conds = append(conds, "e.ts <= ?")
		args = append(args, q.To)
	}

	// Filtering by trait requires the same join as grouping by one. Sorted keys
	// so the argument order is deterministic and the query plan is cacheable.
	traitKeys := make([]string, 0, len(q.Traits))
	for k := range q.Traits {
		traitKeys = append(traitKeys, k)
	}
	sort.Strings(traitKeys)
	for _, k := range traitKeys {
		conds = append(conds, "CAST(json_extract(s.meta, ?) AS TEXT) = ?")
		args = append(args, "$.traits."+k, q.Traits[k])
	}

	// LEFT JOIN, and only when grouping or filtering needs it: a flow from a
	// session with no context row must still be counted, bucketed under ""
	// (rendered as "unknown") rather than dropped from the aggregate entirely.
	join := ""
	if q.GroupBy.needsSessionJoin() || len(q.Traits) > 0 {
		join = " LEFT JOIN sessions s ON s.session_id = e.session_id"
	}

	sqlText := fmt.Sprintf(`
		SELECT e.name,
		       %s AS grp,
		       CAST(json_extract(e.props, '$.duration_ms') AS INTEGER) AS duration,
		       COALESCE(json_extract(e.props, '$.outcome'), 'completed') AS outcome
		FROM events e%s
		WHERE %s
		LIMIT %d`, groupSQL, join, strings.Join(conds, " AND "), maxFlowSamples)

	rows, err := s.db.Query(sqlText, args...)
	if err != nil {
		return nil, fmt.Errorf("flows query: %w", err)
	}
	defer rows.Close()

	// Bucket key → durations of completed runs, plus the outcome tallies.
	type bucket struct {
		name      string
		group     string
		durations []int64
		completed int
		abandoned int
		failed    int
	}
	buckets := map[string]*bucket{}
	var order []string

	for rows.Next() {
		var r flowRow
		var grp sql.NullString
		if err := rows.Scan(&r.name, &grp, &r.duration, &r.outcome); err != nil {
			return nil, err
		}
		if grp.Valid {
			r.group = grp.String
		}

		key := r.name + "\x00" + r.group
		b, ok := buckets[key]
		if !ok {
			b = &bucket{name: r.name, group: r.group}
			buckets[key] = b
			order = append(order, key)
		}
		switch r.outcome {
		case "abandoned":
			b.abandoned++
		case "failed":
			b.failed++
		default:
			// Durations describe completed runs only, so only those are kept.
			b.completed++
			b.durations = append(b.durations, r.duration)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	out := make([]FlowStat, 0, len(order))
	for _, key := range order {
		b := buckets[key]
		out = append(out, summarise(b.name, b.group, b.durations, b.completed, b.abandoned, b.failed))
	}

	// Busiest first, then alphabetically so equal-volume rows have a stable order.
	sort.Slice(out, func(i, j int) bool {
		ai := out[i].Completions + out[i].Abandons + out[i].Failures
		aj := out[j].Completions + out[j].Abandons + out[j].Failures
		if ai != aj {
			return ai > aj
		}
		if out[i].Name != out[j].Name {
			return out[i].Name < out[j].Name
		}
		return out[i].Group < out[j].Group
	})

	if q.Limit > 0 && len(out) > q.Limit {
		out = out[:q.Limit]
	}
	return out, nil
}

// summarise turns raw durations into a FlowStat.
func summarise(name, group string, durations []int64, completed, abandoned, failed int) FlowStat {
	st := FlowStat{
		Name:        name,
		Group:       group,
		Completions: completed,
		Abandons:    abandoned,
		Failures:    failed,
	}

	if total := completed + abandoned + failed; total > 0 {
		st.AbandonRate = math.Round(float64(abandoned)/float64(total)*10000) / 10000
	}
	if len(durations) == 0 {
		return st
	}

	sort.Slice(durations, func(i, j int) bool { return durations[i] < durations[j] })

	var sum int64
	for _, d := range durations {
		sum += d
	}
	st.TotalMs = sum
	st.Mean = sum / int64(len(durations))
	st.Min = durations[0]
	st.Max = durations[len(durations)-1]
	st.P50 = percentile(durations, 0.50)
	st.P90 = percentile(durations, 0.90)
	st.P95 = percentile(durations, 0.95)
	return st
}

// percentile returns the p-th percentile of a sorted slice using nearest-rank,
// which always returns an observed value — a "p90 of 4.2s" that no run actually
// took invites arguments that interpolation does not settle.
func percentile(sorted []int64, p float64) int64 {
	if len(sorted) == 0 {
		return 0
	}
	rank := int(math.Ceil(p * float64(len(sorted))))
	if rank < 1 {
		rank = 1
	}
	if rank > len(sorted) {
		rank = len(sorted)
	}
	return sorted[rank-1]
}

// FlowNames lists the distinct flow names seen in the window, busiest first.
// The dashboard uses it to populate a picker without hard-coding an app's flows.
func (s *Store) FlowNames(app string, from, to int64, limit int) ([]NameCount, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	where, args := aggWhere(app, from, to, "type = 'flow'")
	q := `SELECT name, COUNT(*) AS c FROM events ` + where +
		` GROUP BY name ORDER BY c DESC LIMIT ?`
	args = append(args, limit)

	rows, err := s.db.Query(q, args...)
	if err != nil {
		return nil, fmt.Errorf("flow names: %w", err)
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

// ---------------------------------------------------------------------------
// Session-level flow data — the drill-down from an aggregate to a recording
// ---------------------------------------------------------------------------

// FlowSession is one run of a flow, with the session it happened in.
//
// This is what makes "every number has a watchable session behind it" true
// rather than aspirational: the aggregate throws session ids away, so a p90 of
// 96 seconds could not be traced to the sessions that produced it.
type FlowSession struct {
	SessionID  string `json:"session_id"`
	UserID     string `json:"user_id"`
	Ts         int64  `json:"ts"`
	DurationMs int64  `json:"duration_ms"`
	Outcome    string `json:"outcome"`
}

// FlowSessionQuery selects individual runs of one flow.
type FlowSessionQuery struct {
	Name    string
	App     string
	From    int64
	To      int64
	Outcome string // "", or completed | abandoned | failed
	// MinDurationMs keeps only runs at least this slow — how "sessions above
	// p90" is expressed once the caller knows what p90 is.
	MinDurationMs int64
	Limit         int
}

// FlowSessions returns individual runs of a flow, slowest first.
//
// Deliberately not a grouping on the aggregate: one row per run, ordered by the
// thing the reader cares about, with a hard limit. The aggregate answers "how
// slow is this"; this answers "show me the slow ones".
func (s *Store) FlowSessions(q FlowSessionQuery) ([]FlowSession, error) {
	if q.Name == "" {
		return nil, fmt.Errorf("flow sessions: name is required")
	}
	limit := q.Limit
	if limit <= 0 || limit > 200 {
		limit = 25
	}

	conds := []string{
		"type = 'flow'",
		"name = ?",
		"json_extract(props, '$.duration_ms') IS NOT NULL",
		"session_id != ''",
	}
	args := []interface{}{q.Name}
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
	if q.Outcome != "" {
		conds = append(conds, "COALESCE(json_extract(props, '$.outcome'), 'completed') = ?")
		args = append(args, q.Outcome)
	}
	if q.MinDurationMs > 0 {
		conds = append(conds, "CAST(json_extract(props, '$.duration_ms') AS INTEGER) >= ?")
		args = append(args, q.MinDurationMs)
	}
	args = append(args, limit)

	rows, err := s.db.Query(`
		SELECT session_id, user_id, ts,
		       CAST(json_extract(props, '$.duration_ms') AS INTEGER) AS duration,
		       COALESCE(json_extract(props, '$.outcome'), 'completed') AS outcome
		FROM events
		WHERE `+strings.Join(conds, " AND ")+`
		ORDER BY duration DESC
		LIMIT ?`, args...)
	if err != nil {
		return nil, fmt.Errorf("flow sessions: %w", err)
	}
	defer rows.Close()

	var out []FlowSession
	for rows.Next() {
		var fs FlowSession
		if err := rows.Scan(&fs.SessionID, &fs.UserID, &fs.Ts, &fs.DurationMs, &fs.Outcome); err != nil {
			return nil, err
		}
		out = append(out, fs)
	}
	return out, rows.Err()
}

// ---------------------------------------------------------------------------
// Duration distribution
// ---------------------------------------------------------------------------

// HistogramBucket is one bar of a duration distribution.
type HistogramBucket struct {
	// MinMs and MaxMs bound the bucket, inclusive of Min and exclusive of Max.
	MinMs int64  `json:"min_ms"`
	MaxMs int64  `json:"max_ms"`
	Label string `json:"label"`
	Count int    `json:"count"`
}

// histogramEdges are log-ish buckets from 100ms to 30 minutes.
//
// Fixed-width buckets are simple and useless here: flow durations span four
// orders of magnitude, so a linear axis puts every real value in the first bar.
// These edges are round numbers a person can read, which matters more than
// mathematical elegance on an axis label.
var histogramEdges = []int64{
	0, 100, 250, 500,
	1_000, 2_000, 5_000,
	10_000, 30_000, 60_000,
	120_000, 300_000, 600_000, 1_800_000,
}

func humanMs(ms int64) string {
	switch {
	case ms < 1000:
		return fmt.Sprintf("%dms", ms)
	case ms < 60_000:
		return fmt.Sprintf("%gs", float64(ms)/1000)
	default:
		return fmt.Sprintf("%gm", float64(ms)/60_000)
	}
}

// FlowHistogram buckets completed durations of one flow.
//
// A p50 and a p90 describe a distribution badly when it is bimodal — "half of
// these finish in 2s and half take two minutes" is invisible in percentiles and
// obvious in a histogram.
func (s *Store) FlowHistogram(name, app string, from, to int64) ([]HistogramBucket, error) {
	if name == "" {
		return nil, fmt.Errorf("flow histogram: name is required")
	}

	conds := []string{
		"type = 'flow'",
		"name = ?",
		"json_extract(props, '$.duration_ms') IS NOT NULL",
		"COALESCE(json_extract(props, '$.outcome'), 'completed') = 'completed'",
	}
	args := []interface{}{name}
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

	rows, err := s.db.Query(`
		SELECT CAST(json_extract(props, '$.duration_ms') AS INTEGER)
		FROM events WHERE `+strings.Join(conds, " AND ")+`
		LIMIT ?`, append(args, maxFlowSamples)...)
	if err != nil {
		return nil, fmt.Errorf("flow histogram: %w", err)
	}
	defer rows.Close()

	buckets := make([]HistogramBucket, 0, len(histogramEdges))
	for i := 0; i < len(histogramEdges); i++ {
		lo := histogramEdges[i]
		var hi int64 = -1 // open-ended final bucket
		if i+1 < len(histogramEdges) {
			hi = histogramEdges[i+1]
		}
		label := humanMs(lo) + "–" + humanMs(hi)
		if hi < 0 {
			label = humanMs(lo) + "+"
		}
		buckets = append(buckets, HistogramBucket{MinMs: lo, MaxMs: hi, Label: label})
	}

	for rows.Next() {
		var d int64
		if err := rows.Scan(&d); err != nil {
			return nil, err
		}
		idx := len(buckets) - 1
		for i := range buckets {
			if buckets[i].MaxMs >= 0 && d < buckets[i].MaxMs {
				idx = i
				break
			}
		}
		buckets[idx].Count++
	}
	return buckets, rows.Err()
}

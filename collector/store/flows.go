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
	// Kind is "", "user", "day", or "prop".
	Kind string
	// PropKey is the props key to bucket by when Kind == "prop".
	PropKey string
}

// FlowQuery filters and groups a flow aggregate.
type FlowQuery struct {
	App     string
	Name    string // single flow; empty means every flow
	From    int64
	To      int64
	GroupBy FlowGroupBy
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
		return "user_id", nil
	case "day":
		return "date(ts/1000, 'unixepoch')", nil
	case "prop":
		// json_extract with a bound path: the key never reaches the SQL text,
		// so a prop name cannot alter the statement.
		return "COALESCE(CAST(json_extract(props, ?) AS TEXT), '')", []interface{}{"$." + g.PropKey}
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

	groupSQL, groupArgs := q.GroupBy.groupExpr()

	// Selected columns first, then filters — argument order has to match.
	args := append([]interface{}{}, groupArgs...)

	conds := []string{"type = 'flow'", "json_extract(props, '$.duration_ms') IS NOT NULL"}
	if q.App != "" {
		conds = append(conds, "app = ?")
		args = append(args, q.App)
	}
	if q.Name != "" {
		conds = append(conds, "name = ?")
		args = append(args, q.Name)
	}
	if q.From > 0 {
		conds = append(conds, "ts >= ?")
		args = append(args, q.From)
	}
	if q.To > 0 {
		conds = append(conds, "ts <= ?")
		args = append(args, q.To)
	}

	sqlText := fmt.Sprintf(`
		SELECT name,
		       %s AS grp,
		       CAST(json_extract(props, '$.duration_ms') AS INTEGER) AS duration,
		       COALESCE(json_extract(props, '$.outcome'), 'completed') AS outcome
		FROM events
		WHERE %s
		LIMIT %d`, groupSQL, strings.Join(conds, " AND "), maxFlowSamples)

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

package query

import (
	"net/http"
	"strconv"
)

// timeWindow reads the from/to query parameters shared by every read handler.
// Both are unix milliseconds; zero means unbounded on that side.
func timeWindow(r *http.Request) (from, to int64) {
	q := r.URL.Query()
	if s := q.Get("from"); s != "" {
		from, _ = strconv.ParseInt(s, 10, 64)
	}
	if s := q.Get("to"); s != "" {
		to, _ = strconv.ParseInt(s, 10, 64)
	}
	return from, to
}

// tzOffsetMin reads the viewer's timezone offset in minutes east of UTC, as the
// dashboard sends it (-Date.prototype.getTimezoneOffset()). Absent or malformed
// means UTC. Day-bucketed aggregates use this so calendar days line up with the
// days the person reading them actually lived through; see store.dayExpr.
func tzOffsetMin(r *http.Request) int {
	s := r.URL.Query().Get("tz")
	if s == "" {
		return 0
	}
	n, err := strconv.Atoi(s)
	if err != nil || n < -840 || n > 840 {
		return 0
	}
	return n
}

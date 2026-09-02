package query

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/foundanand/spyglass/collector/store"
)

// FlowsHandler serves GET /v1/query/flows.
//
//	?app=      restrict to one app
//	?name=     restrict to one flow (omit for every flow, one row each)
//	?from=&to= unix-ms window
//	?group=    "" | user | day | prop:<key> | session:<key> | trait:<key>
//	?trait=    key:value, repeatable — narrows to sessions matching every one
//	?limit=    max rows (default 50)
//
// The grouping parameter is what makes this a dashboard primitive rather than
// one fixed report: "how long does task.create take" (no group), "…per person"
// (group=user), "…is it getting slower" (group=day), and "…does it depend on
// how many clients were selected" (group=prop:clients) are the same query.
type FlowsHandler struct {
	store *store.Store
}

// NewFlowsHandler creates a new FlowsHandler.
func NewFlowsHandler(st *store.Store) *FlowsHandler {
	return &FlowsHandler{store: st}
}

type flowsResp struct {
	Flows []store.FlowStat  `json:"flows"`
	Names []store.NameCount `json:"names"`
}

// parseGroup turns the `group` parameter into a FlowGroupBy.
func parseGroup(raw string) (store.FlowGroupBy, bool) {
	switch {
	case raw == "":
		return store.FlowGroupBy{}, true
	case raw == "user" || raw == "day":
		return store.FlowGroupBy{Kind: raw}, true
	case strings.HasPrefix(raw, "prop:"):
		key := strings.TrimPrefix(raw, "prop:")
		if key == "" {
			return store.FlowGroupBy{}, false
		}
		return store.FlowGroupBy{Kind: "prop", PropKey: key}, true
	case strings.HasPrefix(raw, "trait:"):
		// User cohort attributes — role, team, plan. Same storage as session
		// context, namespaced under "traits".
		key := strings.TrimPrefix(raw, "trait:")
		if key == "" {
			return store.FlowGroupBy{}, false
		}
		return store.FlowGroupBy{Kind: "trait", PropKey: key}, true
	case strings.HasPrefix(raw, "session:"):
		// Session context — viewport_bucket, ua, tz, connection, language.
		// This is the axis that answers "is it slower on mobile".
		key := strings.TrimPrefix(raw, "session:")
		if key == "" {
			return store.FlowGroupBy{}, false
		}
		return store.FlowGroupBy{Kind: "session", PropKey: key}, true
	default:
		return store.FlowGroupBy{}, false
	}
}

func (h *FlowsHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	q := r.URL.Query()

	group, ok := parseGroup(q.Get("group"))
	if !ok {
		http.Error(w, `group must be "", "user", "day", "prop:<key>", "session:<key>", or "trait:<key>"`, http.StatusBadRequest)
		return
	}

	// ?trait=role:Partner&trait=admin:true — every one must match.
	var traits map[string]string
	for _, raw := range q["trait"] {
		k, v, found := strings.Cut(raw, ":")
		if !found || k == "" {
			http.Error(w, `trait must be "key:value"`, http.StatusBadRequest)
			return
		}
		if traits == nil {
			traits = map[string]string{}
		}
		traits[k] = v
	}

	fq := store.FlowQuery{
		App:     q.Get("app"),
		Name:    q.Get("name"),
		Traits:  traits,
		GroupBy: group,
		Limit:   50,
	}
	if s := q.Get("from"); s != "" {
		fq.From, _ = strconv.ParseInt(s, 10, 64)
	}
	if s := q.Get("to"); s != "" {
		fq.To, _ = strconv.ParseInt(s, 10, 64)
	}
	if s := q.Get("limit"); s != "" {
		if n, err := strconv.Atoi(s); err == nil && n > 0 {
			fq.Limit = n
		}
	}

	flows, err := h.store.Flows(fq)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	// The name list travels with the results so a dashboard can populate its
	// flow picker without a second round trip, and without knowing in advance
	// which flows the app it is watching happens to emit.
	names, err := h.store.FlowNames(fq.App, fq.From, fq.To, 0)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	resp := flowsResp{Flows: flows, Names: names}
	if resp.Flows == nil {
		resp.Flows = []store.FlowStat{}
	}
	if resp.Names == nil {
		resp.Names = []store.NameCount{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp) //nolint:errcheck
}

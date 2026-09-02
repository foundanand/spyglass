package query

import (
	"encoding/json"
	"net/http"
	"sort"

	"github.com/foundanand/spyglass/collector/store"
)

// MetaHandler serves GET /v1/query/meta.
//
// It exists for one screen: the first-run setup panel. A freshly started
// collector shows "no activity yet" on every view, which is indistinguishable
// from a broken install — and first-run is where a self-hosted tool gets
// abandoned, because the operator has already done the hard part and the payoff
// screen looks like failure.
//
// To turn that empty state into the last step of setup, the dashboard needs to
// know what the collector is actually configured for. That is all this returns.
type MetaHandler struct {
	store   *store.Store
	version string
	apps    []string
}

// NewMetaHandler creates a MetaHandler. appSlugs must be slugs only.
func NewMetaHandler(st *store.Store, version string, appSlugs []string) *MetaHandler {
	sorted := append([]string{}, appSlugs...)
	sort.Strings(sorted)
	return &MetaHandler{store: st, version: version, apps: sorted}
}

type metaResp struct {
	Version string `json:"version"`
	// Apps carries slugs and nothing else. The ingest keys are a separate
	// credential from the dashboard password on purpose, and this endpoint sits
	// behind the latter — handing out the former here would collapse that
	// distinction for anyone who can read the dashboard.
	Apps []string `json:"apps"`
	// HasAnyEvents distinguishes "nothing has ever arrived", which is a setup
	// problem worth explaining, from "nothing in the window you picked", which
	// is a normal state. Showing setup instructions to somebody with three
	// months of data would be worse than saying nothing.
	HasAnyEvents bool `json:"has_any_events"`
}

func (h *MetaHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	events, err := h.store.QueryEvents(store.EventQuery{Limit: 1})
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	apps := h.apps
	if apps == nil {
		apps = []string{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(metaResp{ //nolint:errcheck
		Version:      h.version,
		Apps:         apps,
		HasAnyEvents: len(events) > 0,
	})
}

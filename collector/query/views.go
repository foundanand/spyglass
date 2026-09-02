package query

import (
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/foundanand/spyglass/collector/store"
)

// maxViewBody bounds a saved-view payload. Params is a small parameter set, not
// a document store.
const maxViewBody = 64 << 10

// ViewsHandler serves /v1/views and /v1/boards.
//
// Saved views are the only *write* path on the dashboard side of the collector,
// and they sit behind the dashboard password like every other non-ingest route.
// Deliberately not reachable with an app key: that key ships to browsers and is
// scoped to ingest, and letting it write here would widen it into a general
// read-write credential.
//
// There is no new query capability here. A view is a name attached to a
// parameter set that the existing endpoints already accept, which is what keeps
// this from turning into a query language.
type ViewsHandler struct {
	store *store.Store
}

// NewViewsHandler creates a new ViewsHandler.
func NewViewsHandler(st *store.Store) *ViewsHandler { return &ViewsHandler{store: st} }

type viewPayload struct {
	Name   string                 `json:"name"`
	Kind   string                 `json:"kind"`
	Params map[string]interface{} `json:"params"`
}

type boardPayload struct {
	Name  string  `json:"name"`
	Views []int64 `json:"views"`
}

func writeJSON(w http.ResponseWriter, status int, body interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(body) //nolint:errcheck
}

func decode(w http.ResponseWriter, r *http.Request, into interface{}) bool {
	r.Body = http.MaxBytesReader(w, r.Body, maxViewBody)
	data, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "request body too large", http.StatusRequestEntityTooLarge)
		return false
	}
	if err := json.Unmarshal(data, into); err != nil {
		http.Error(w, "invalid JSON", http.StatusBadRequest)
		return false
	}
	return true
}

// idFromPath pulls a trailing numeric id off the URL, e.g. /v1/views/12.
func idFromPath(path, prefix string) (int64, bool) {
	rest := strings.Trim(strings.TrimPrefix(path, prefix), "/")
	if rest == "" {
		return 0, false
	}
	id, err := strconv.ParseInt(rest, 10, 64)
	if err != nil {
		return 0, false
	}
	return id, true
}

func (h *ViewsHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if strings.HasPrefix(r.URL.Path, "/v1/boards") {
		h.serveBoards(w, r)
		return
	}
	h.serveViews(w, r)
}

func (h *ViewsHandler) serveViews(w http.ResponseWriter, r *http.Request) {
	id, hasID := idFromPath(r.URL.Path, "/v1/views")

	switch r.Method {
	case http.MethodGet:
		if hasID {
			v, err := h.store.GetView(id)
			if err != nil {
				http.Error(w, "internal error", http.StatusInternalServerError)
				return
			}
			if v == nil {
				http.Error(w, "not found", http.StatusNotFound)
				return
			}
			writeJSON(w, http.StatusOK, v)
			return
		}
		views, err := h.store.ListViews()
		if err != nil {
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		if views == nil {
			views = []store.View{}
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{"views": views})

	case http.MethodPost:
		var p viewPayload
		if !decode(w, r, &p) {
			return
		}
		v, err := h.store.CreateView(p.Name, p.Kind, p.Params)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		writeJSON(w, http.StatusCreated, v)

	case http.MethodPut:
		if !hasID {
			http.Error(w, "view id required", http.StatusBadRequest)
			return
		}
		var p viewPayload
		if !decode(w, r, &p) {
			return
		}
		v, err := h.store.UpdateView(id, p.Name, p.Kind, p.Params)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if v == nil {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		writeJSON(w, http.StatusOK, v)

	case http.MethodDelete:
		if !hasID {
			http.Error(w, "view id required", http.StatusBadRequest)
			return
		}
		ok, err := h.store.DeleteView(id)
		if err != nil {
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		if !ok {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		w.WriteHeader(http.StatusNoContent)

	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (h *ViewsHandler) serveBoards(w http.ResponseWriter, r *http.Request) {
	id, hasID := idFromPath(r.URL.Path, "/v1/boards")

	switch r.Method {
	case http.MethodGet:
		if hasID {
			b, err := h.store.GetBoard(id)
			if err != nil {
				http.Error(w, "internal error", http.StatusInternalServerError)
				return
			}
			if b == nil {
				http.Error(w, "not found", http.StatusNotFound)
				return
			}
			writeJSON(w, http.StatusOK, b)
			return
		}
		boards, err := h.store.ListBoards()
		if err != nil {
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		if boards == nil {
			boards = []store.Board{}
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{"boards": boards})

	case http.MethodPost:
		var p boardPayload
		if !decode(w, r, &p) {
			return
		}
		b, err := h.store.CreateBoard(p.Name, p.Views)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		writeJSON(w, http.StatusCreated, b)

	case http.MethodPut:
		if !hasID {
			http.Error(w, "board id required", http.StatusBadRequest)
			return
		}
		var p boardPayload
		if !decode(w, r, &p) {
			return
		}
		b, err := h.store.SetBoardViews(id, p.Views)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if b == nil {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		writeJSON(w, http.StatusOK, b)

	case http.MethodDelete:
		if !hasID {
			http.Error(w, "board id required", http.StatusBadRequest)
			return
		}
		ok, err := h.store.DeleteBoard(id)
		if err != nil {
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		if !ok {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		w.WriteHeader(http.StatusNoContent)

	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

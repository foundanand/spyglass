package query_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/foundanand/spyglass/collector/query"
	"github.com/foundanand/spyglass/collector/store"
	_ "modernc.org/sqlite"
)

func viewsHandler(t *testing.T) (*query.ViewsHandler, *store.Store) {
	t.Helper()
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	return query.NewViewsHandler(st), st
}

func do(t *testing.T, h http.Handler, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	var r *http.Request
	if body == "" {
		r = httptest.NewRequest(method, path, nil)
	} else {
		r = httptest.NewRequest(method, path, strings.NewReader(body))
	}
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, r)
	return rr
}

func TestViewsHTTPRoundTrip(t *testing.T) {
	h, _ := viewsHandler(t)

	rr := do(t, h, http.MethodPost, "/v1/views",
		`{"name":"Monday","kind":"flows","params":{"name":"task.create","group":"day"}}`)
	if rr.Code != http.StatusCreated {
		t.Fatalf("create: status = %d, body = %s", rr.Code, rr.Body.String())
	}
	var created store.View
	if err := json.Unmarshal(rr.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if created.ID == 0 || created.Params["group"] != "day" {
		t.Fatalf("created = %+v", created)
	}

	rr = do(t, h, http.MethodGet, "/v1/views", "")
	if rr.Code != http.StatusOK || !strings.Contains(rr.Body.String(), "Monday") {
		t.Fatalf("list: %d %s", rr.Code, rr.Body.String())
	}

	rr = do(t, h, http.MethodPut, "/v1/views/1",
		`{"name":"Monday v2","kind":"flows","params":{"name":"report.export"}}`)
	if rr.Code != http.StatusOK || !strings.Contains(rr.Body.String(), "Monday v2") {
		t.Fatalf("update: %d %s", rr.Code, rr.Body.String())
	}

	if rr = do(t, h, http.MethodDelete, "/v1/views/1", ""); rr.Code != http.StatusNoContent {
		t.Fatalf("delete: %d", rr.Code)
	}
	if rr = do(t, h, http.MethodGet, "/v1/views/1", ""); rr.Code != http.StatusNotFound {
		t.Fatalf("get after delete: %d, want 404", rr.Code)
	}
}

func TestViewsHTTPRejectsBadInput(t *testing.T) {
	h, _ := viewsHandler(t)

	cases := []struct {
		name, method, path, body string
		want                     int
	}{
		{"no name", http.MethodPost, "/v1/views", `{"kind":"flows"}`, http.StatusBadRequest},
		{"unknown kind", http.MethodPost, "/v1/views", `{"name":"x","kind":"sql"}`, http.StatusBadRequest},
		{"malformed json", http.MethodPost, "/v1/views", `{`, http.StatusBadRequest},
		{"update without id", http.MethodPut, "/v1/views", `{"name":"x","kind":"flows"}`, http.StatusBadRequest},
		{"delete without id", http.MethodDelete, "/v1/views", "", http.StatusBadRequest},
		{"update missing row", http.MethodPut, "/v1/views/42", `{"name":"x","kind":"flows"}`, http.StatusNotFound},
		{"delete missing row", http.MethodDelete, "/v1/views/42", "", http.StatusNotFound},
		{"bad method", http.MethodPatch, "/v1/views", "", http.StatusMethodNotAllowed},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if rr := do(t, h, tc.method, tc.path, tc.body); rr.Code != tc.want {
				t.Errorf("status = %d, want %d (%s)", rr.Code, tc.want, rr.Body.String())
			}
		})
	}
}

func TestBoardsHTTPRoundTrip(t *testing.T) {
	h, st := viewsHandler(t)

	a, _ := st.CreateView("a", "flows", nil)
	b, _ := st.CreateView("b", "funnel", nil)

	rr := do(t, h, http.MethodPost, "/v1/boards",
		`{"name":"Monday board","views":[`+strconv.FormatInt(b.ID, 10)+`,`+strconv.FormatInt(a.ID, 10)+`]}`)
	if rr.Code != http.StatusCreated {
		t.Fatalf("create board: %d %s", rr.Code, rr.Body.String())
	}
	var board store.Board
	if err := json.Unmarshal(rr.Body.Bytes(), &board); err != nil {
		t.Fatal(err)
	}
	if len(board.Views) != 2 || board.Views[0].ID != b.ID {
		t.Fatalf("board = %+v", board)
	}

	rr = do(t, h, http.MethodGet, "/v1/boards", "")
	if rr.Code != http.StatusOK || !strings.Contains(rr.Body.String(), "Monday board") {
		t.Fatalf("list boards: %d %s", rr.Code, rr.Body.String())
	}

	rr = do(t, h, http.MethodPut, "/v1/boards/"+strconv.FormatInt(board.ID, 10), `{"views":[`+strconv.FormatInt(a.ID, 10)+`]}`)
	if rr.Code != http.StatusOK {
		t.Fatalf("set views: %d %s", rr.Code, rr.Body.String())
	}

	if rr = do(t, h, http.MethodDelete, "/v1/boards/"+strconv.FormatInt(board.ID, 10), ""); rr.Code != http.StatusNoContent {
		t.Fatalf("delete board: %d", rr.Code)
	}
	if rr = do(t, h, http.MethodGet, "/v1/boards/"+strconv.FormatInt(board.ID, 10), ""); rr.Code != http.StatusNotFound {
		t.Fatalf("get after delete: %d", rr.Code)
	}
}

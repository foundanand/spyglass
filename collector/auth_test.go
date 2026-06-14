package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func okHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok")) //nolint:errcheck
	})
}

func TestDashboardAuth(t *testing.T) {
	tests := []struct {
		name     string
		password string
		setAuth  bool
		user     string
		pass     string
		wantCode int
	}{
		{"no password disables auth", "", false, "", "", http.StatusOK},
		{"missing credentials rejected", "s3cret", false, "", "", http.StatusUnauthorized},
		{"correct password accepted", "s3cret", true, "admin", "s3cret", http.StatusOK},
		{"wrong password rejected", "s3cret", true, "admin", "nope", http.StatusUnauthorized},
		{"username ignored", "s3cret", true, "anything", "s3cret", http.StatusOK},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			h := dashboardAuth(tc.password, okHandler())
			req := httptest.NewRequest(http.MethodGet, "/", nil)
			if tc.setAuth {
				req.SetBasicAuth(tc.user, tc.pass)
			}
			rr := httptest.NewRecorder()
			h.ServeHTTP(rr, req)
			if rr.Code != tc.wantCode {
				t.Errorf("got %d, want %d", rr.Code, tc.wantCode)
			}
			if tc.wantCode == http.StatusUnauthorized {
				if rr.Header().Get("WWW-Authenticate") == "" {
					t.Error("expected WWW-Authenticate header on 401")
				}
			}
		})
	}
}

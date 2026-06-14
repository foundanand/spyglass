package main

import (
	"crypto/subtle"
	"net/http"
)

// dashboardAuth wraps a handler with HTTP Basic Auth gated on a single shared
// password (the username is ignored). An empty password disables auth entirely —
// useful for local dev — so the gate only engages when an operator sets one.
//
// This is for dashboard-facing routes only. Ingest endpoints (/v1/events,
// /v1/replay) authenticate with per-app keys and must NOT be wrapped, or the SDK
// could never post.
func dashboardAuth(password string, next http.Handler) http.Handler {
	if password == "" {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, pass, ok := r.BasicAuth()
		// constant-time compare to avoid leaking the password length/prefix via timing.
		if !ok || subtle.ConstantTimeCompare([]byte(pass), []byte(password)) != 1 {
			w.Header().Set("WWW-Authenticate", `Basic realm="spyglass", charset="UTF-8"`)
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}

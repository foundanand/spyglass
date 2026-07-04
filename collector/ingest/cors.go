package ingest

import "net/http"

// Shared CORS handling for the ingest endpoints (/v1/events, /v1/replay).
//
// Both endpoints are called cross-origin by the browser SDK (the app runs on a
// different origin than the collector), and both send a non-simple request that
// triggers a preflight — events via Content-Type: application/json, replay via
// the X-Spyglass-Key header and gzip Content-Encoding. Keeping the origin check
// and header allowlist in one place guarantees the two stay in lockstep.

// corsAllowHeaders lists every request header the SDK may send on an ingest
// call. Content-Type covers events; Content-Encoding + X-Spyglass-Key cover the
// gzipped, key-authenticated replay chunks.
const corsAllowHeaders = "Content-Type, Content-Encoding, X-Spyglass-Key"

// writePreflight answers a CORS preflight (OPTIONS) request. The origin is
// allowed if it matches the allowlist of any configured app.
func writePreflight(w http.ResponseWriter, r *http.Request, apps map[string]AppCfg) {
	origin := r.Header.Get("Origin")
	if origin == "" {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	allowed := false
	for _, app := range apps {
		if originAllowed(app.Origins, origin) {
			allowed = true
			break
		}
	}
	if !allowed {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	w.Header().Set("Access-Control-Allow-Origin", origin)
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", corsAllowHeaders)
	w.Header().Set("Access-Control-Max-Age", "86400")
	w.Header().Set("Vary", "Origin")
	w.WriteHeader(http.StatusNoContent)
}

// allowOrigin sets the CORS response header on an actual (non-preflight) request
// once the origin has been validated against the app's allowlist. Returns false
// (and writes a 403) when the origin is present but not allowed.
func allowOrigin(w http.ResponseWriter, origin string, allowed []string) bool {
	if origin == "" {
		return true // same-origin or non-browser client; nothing to set
	}
	if !originAllowed(allowed, origin) {
		http.Error(w, "origin not allowed", http.StatusForbidden)
		return false
	}
	w.Header().Set("Access-Control-Allow-Origin", origin)
	w.Header().Set("Vary", "Origin")
	return true
}

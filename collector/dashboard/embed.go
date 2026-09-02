package dashboard

import (
	"embed"
	"io/fs"
	"mime"
	"net/http"
	"path"
	"strings"
)

// The all: prefix matters — the bare form silently skips files whose names
// begin with "_" or ".", which is exactly the shape esbuild's generated code-
// split chunk names can take.
//
//go:embed all:ui/dist
var staticFiles embed.FS

// Handler returns an http.Handler that serves the embedded Preact SPA at GET /.
// Static assets are served by extension/name; everything else returns index.html
// so the SPA can handle client-side routing. Avoids http.FileServer's redirect
// of /index.html → ./ which causes an infinite loop.
func Handler() http.Handler {
	dist, err := fs.Sub(staticFiles, "ui/dist")
	if err != nil {
		panic("dashboard: ui/dist not embedded: " + err.Error())
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		name := strings.TrimPrefix(r.URL.Path, "/")
		if name == "" {
			serveIndex(w, dist)
			return
		}

		data, err := fs.ReadFile(dist, name)
		if err != nil {
			// Unknown path → SPA fallback
			serveIndex(w, dist)
			return
		}

		ct := mime.TypeByExtension(path.Ext(name))
		if ct == "" {
			ct = "application/octet-stream"
		}
		w.Header().Set("Content-Type", ct)
		w.Header().Set("Cache-Control", cacheControl(name))
		w.WriteHeader(http.StatusOK)
		w.Write(data) //nolint:errcheck
	})
}

// cacheControl decides how long a static asset may be reused.
//
// This matters more since the bundle started code-splitting: chunk names carry
// a content hash, so a browser holding a stale app.js can ask for a chunk hash
// that no longer exists in the new binary and the replay view breaks outright.
// Hashed files are immutable and cached hard; everything else must revalidate,
// so upgrading the binary is enough to serve the new UI.
func cacheControl(name string) string {
	if hashedAsset(name) {
		return "public, max-age=31536000, immutable"
	}
	return "no-cache"
}

// hashedAsset reports whether a filename carries esbuild's content hash, i.e.
// ends in "-XXXXXXXX.<ext>" with an 8-character base32 hash.
func hashedAsset(name string) bool {
	base := path.Base(name)
	ext := path.Ext(base)
	if ext == "" {
		return false
	}
	stem := strings.TrimSuffix(base, ext)
	i := strings.LastIndex(stem, "-")
	if i < 0 {
		return false
	}
	hash := stem[i+1:]
	if len(hash) != 8 {
		return false
	}
	for _, r := range hash {
		if !(r >= 'A' && r <= 'Z') && !(r >= '2' && r <= '7') {
			return false
		}
	}
	return true
}

func serveIndex(w http.ResponseWriter, dist fs.FS) {
	data, err := fs.ReadFile(dist, "index.html")
	if err != nil {
		http.Error(w, "dashboard not built", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	// The SPA shell names the current entry bundle, so it must never be stale.
	w.Header().Set("Cache-Control", "no-cache")
	w.WriteHeader(http.StatusOK)
	w.Write(data) //nolint:errcheck
}

package dashboard

import (
	"embed"
	"io/fs"
	"mime"
	"net/http"
	"path"
	"strings"
)

//go:embed ui/dist
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
		w.WriteHeader(http.StatusOK)
		w.Write(data) //nolint:errcheck
	})
}

func serveIndex(w http.ResponseWriter, dist fs.FS) {
	data, err := fs.ReadFile(dist, "index.html")
	if err != nil {
		http.Error(w, "dashboard not built", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	w.Write(data) //nolint:errcheck
}

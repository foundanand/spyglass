// Package dashboard embeds the built Preact SPA (collector/dashboard/ui/dist)
// via Go's embed and serves it at GET / (p1-dashboard-shell). The UI source
// lives under ui/ and is built with esbuild, not compiled by Go.
package dashboard

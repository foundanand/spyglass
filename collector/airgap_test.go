package main

// Air-gap guarantee, enforced as a test.
//
// spyglass is advertised as running fully disconnected: the only network
// traffic in a deployment is browser -> collector, both inside the operator's
// enclave. These tests fail the build the moment that stops being true, so the
// claim can't silently rot.
//
//   1. TestNoAccidentalOutboundInCollector — the shipped Go code makes no
//      outbound HTTP/socket calls. Any *intentional*, opt-in egress a future
//      feature adds (e.g. a Slack webhook or an on-prem LLM summary) must carry
//      an inline `// airgap:allow <reason>` marker on the offending line, which
//      turns an invisible regression into a reviewed, documented decision.
//
//   2. TestNoExternalAssetsInDashboard — the embedded dashboard loads nothing
//      from a CDN, external font host, or remote script/stylesheet. A
//      disconnected browser must render it fully from the binary alone.
//
// Run as part of `make test` (`go test ./...`).

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// allowMarker lets a deliberate, reviewed egress call opt out of the guard.
const allowMarker = "airgap:allow"

// outboundGoPatterns are substrings that indicate the collector is originating
// a network connection (a client call), as opposed to serving one. Server-side
// symbols (http.Server, http.Handle, http.Error, http.StatusOK, …) are
// intentionally absent.
var outboundGoPatterns = []string{
	"http.Get(",
	"http.Post(",
	"http.PostForm(",
	"http.Head(",
	"http.NewRequest(",
	"http.NewRequestWithContext(",
	"http.DefaultClient",
	"http.DefaultTransport",
	"http.Client{",
	"&http.Client",
	"net.Dial(",
	"net.DialTimeout(",
	"net.DialTCP(",
	"net.DialUDP(",
	"tls.Dial(",
	"smtp.",
	"websocket.Dial",
}

func TestNoAccidentalOutboundInCollector(t *testing.T) {
	root := "."
	err := filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			// Never scan vendored JS, build output, or hidden dirs.
			switch info.Name() {
			case "node_modules", "dist", ".git":
				return filepath.SkipDir
			}
			return nil
		}
		// Only shipped Go source; tests (including this file) are exempt.
		if !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		for i, line := range strings.Split(string(data), "\n") {
			trimmed := strings.TrimSpace(line)
			if strings.HasPrefix(trimmed, "//") || strings.HasPrefix(trimmed, "*") {
				continue // comment line, not executable code
			}
			if strings.Contains(line, allowMarker) {
				continue // explicitly reviewed egress
			}
			for _, pat := range outboundGoPatterns {
				if strings.Contains(line, pat) {
					t.Errorf("%s:%d: outbound network call %q breaks the air-gap guarantee.\n"+
						"    If this egress is intentional and opt-in, append `// %s <reason>` to the line and document it in the README air-gap section.",
						path, i+1, pat, allowMarker)
				}
			}
		}
		return nil
	})
	if err != nil {
		t.Fatalf("walking collector source: %v", err)
	}
}

func TestNoExternalAssetsInDashboard(t *testing.T) {
	distDir := filepath.Join("dashboard", "ui", "dist")
	if _, err := os.Stat(distDir); os.IsNotExist(err) {
		t.Skipf("dashboard not built (%s missing); run `make dashboard`", distDir)
	}

	// Hosts that only ever mean "loaded from the internet".
	cdnHosts := []string{
		"googleapis.com", "gstatic.com", "cdn.jsdelivr", "jsdelivr.net",
		"unpkg.com", "cdnjs.cloudflare", "fonts.google", "cdn.",
	}
	// Markup/style load vectors that pull an external resource.
	htmlVectors := []string{
		`href="http`, `href='http`, `src="http`, `src='http`,
		`href="//`, `href='//`, `src="//`, `src='//`, `@import`,
	}
	cssVectors := []string{
		"url(http", "url( http", `url("http`, "url('http",
		"url(//", `url("//`, "url('//", "@import",
	}
	// Genuine JS fetch/import of a remote URL — narrow on purpose so that
	// harmless string literals in the bundle (e.g. a console.warn pointing at
	// a docs URL) don't trip the guard.
	jsVectors := []string{
		`fetch("http`, `fetch('http`, "fetch(`http",
		`import("http`, `import('http`, "import(`http",
	}

	files := map[string][]string{
		"index.html": append(append([]string{}, htmlVectors...), cdnHosts...),
		"app.css":    append(append([]string{}, cssVectors...), cdnHosts...),
		"app.js":     append(append([]string{}, jsVectors...), cdnHosts...),
	}

	for name, patterns := range files {
		p := filepath.Join(distDir, name)
		data, err := os.ReadFile(p)
		if err != nil {
			t.Errorf("reading embedded asset %s: %v", p, err)
			continue
		}
		for i, line := range strings.Split(string(data), "\n") {
			for _, pat := range patterns {
				if strings.Contains(line, pat) {
					t.Errorf("%s:%d: external asset reference %q breaks the air-gap guarantee — "+
						"embed the asset (inline it or serve it from the binary) instead of loading it remotely.",
						p, i+1, pat)
				}
			}
		}
	}
}

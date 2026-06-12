// Command spyglassd is the spyglass collector: a single static binary that
// ingests events and replay chunks, serves query endpoints, and embeds the
// dashboard. See CLAUDE.md for the full design.
package main

import (
	"flag"
	"fmt"
	"os"
)

// version is overridden at build time via -ldflags.
var version = "dev"

func main() {
	configPath := flag.String("config", "spyglass.config.json", "path to the config file")
	showVersion := flag.Bool("version", false, "print version and exit")
	flag.Parse()

	if *showVersion {
		fmt.Printf("spyglassd %s\n", version)
		return
	}

	// Phase 0: skeleton only. Config loading (p1-config-loader), the store
	// (p1-store-open), and the HTTP server (p1-http-server) land in Phase 1.
	fmt.Printf("spyglassd %s — config: %s\n", version, *configPath)
	fmt.Fprintln(os.Stderr, "skeleton only: no server yet (see tasks/ phase 1)")
}

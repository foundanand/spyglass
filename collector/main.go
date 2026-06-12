// Command spyglassd is the spyglass collector: a single static binary that
// ingests events and replay chunks, serves query endpoints, and embeds the
// dashboard. See CLAUDE.md for the full design.
package main

import (
	"flag"
	"fmt"
	"log"
	"os"

	"github.com/foundanand/spyglass/collector/store"
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

	cfg, err := LoadConfig(*configPath)
	if err != nil {
		log.Fatalf("config: %v", err)
	}

	if err := os.MkdirAll(cfg.DataDir, 0o755); err != nil {
		log.Fatalf("create dataDir %q: %v", cfg.DataDir, err)
	}

	st, err := store.Open(cfg.DataDir)
	if err != nil {
		log.Fatalf("store: %v", err)
	}
	defer st.Close()

	if err := run(cfg, st); err != nil {
		log.Fatalf("server: %v", err)
	}
}

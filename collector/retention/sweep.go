// Package retention provides the daily sweep that deletes old replay directories.
package retention

import (
	"log"
	"os"
	"path/filepath"
	"time"
)

// StartSweep starts a background goroutine that deletes replay directories whose
// most-recently-modified file is older than retentionDays. It runs immediately on
// startup and then once per 24 hours. A retentionDays of 0 is a no-op (keep forever).
func StartSweep(dataDir string, retentionDays int) {
	if retentionDays <= 0 {
		return
	}
	go func() {
		runSweep(dataDir, retentionDays)
		ticker := time.NewTicker(24 * time.Hour)
		defer ticker.Stop()
		for range ticker.C {
			runSweep(dataDir, retentionDays)
		}
	}()
}

func runSweep(dataDir string, retentionDays int) {
	replaysDir := filepath.Join(dataDir, "replays")
	cutoff := time.Now().AddDate(0, 0, -retentionDays)

	entries, err := os.ReadDir(replaysDir)
	if err != nil {
		if !os.IsNotExist(err) {
			log.Printf("retention sweep: read dir %s: %v", replaysDir, err)
		}
		return
	}

	deleted := 0
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		dir := filepath.Join(replaysDir, e.Name())
		if dirLastActivity(dir).Before(cutoff) {
			if err := os.RemoveAll(dir); err != nil {
				log.Printf("retention sweep: remove %s: %v", dir, err)
			} else {
				deleted++
			}
		}
	}

	if deleted > 0 {
		log.Printf("retention sweep: removed %d session replay dir(s) older than %d days", deleted, retentionDays)
	}
}

// dirLastActivity returns the most recent ModTime of any file inside dir.
// This is correct because writing a file does NOT update the parent directory
// ModTime on most filesystems.
func dirLastActivity(dir string) time.Time {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return time.Time{}
	}
	var latest time.Time
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		if info.ModTime().After(latest) {
			latest = info.ModTime()
		}
	}
	return latest
}

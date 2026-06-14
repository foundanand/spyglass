// Package retention provides the daily sweep that deletes old replay directories.
package retention

import (
	"log"
	"os"
	"path/filepath"
	"time"
)

// EventDeleter purges events older than a cutoff. *store.Store satisfies it;
// kept as an interface here to avoid a retention→store import dependency.
type EventDeleter interface {
	DeleteEventsBefore(cutoffMs int64) (int64, error)
}

// StartSweep starts a background goroutine that deletes replay directories whose
// most-recently-modified file is older than replaysDays, and (if eventsDays > 0)
// events older than eventsDays. It runs immediately on startup and then once per
// 24 hours. A day count of 0 means "keep forever" for that data type. If both are
// 0 the sweep does nothing and no goroutine is started.
func StartSweep(dataDir string, replaysDays int, ev EventDeleter, eventsDays int) {
	if replaysDays <= 0 && eventsDays <= 0 {
		return
	}
	run := func() {
		if replaysDays > 0 {
			runSweep(dataDir, replaysDays)
		}
		if eventsDays > 0 && ev != nil {
			sweepEvents(ev, eventsDays)
		}
	}
	go func() {
		run()
		ticker := time.NewTicker(24 * time.Hour)
		defer ticker.Stop()
		for range ticker.C {
			run()
		}
	}()
}

// sweepEvents deletes events older than eventsDays.
func sweepEvents(ev EventDeleter, eventsDays int) {
	cutoff := time.Now().AddDate(0, 0, -eventsDays).UnixMilli()
	n, err := ev.DeleteEventsBefore(cutoff)
	if err != nil {
		log.Printf("retention sweep: delete events: %v", err)
		return
	}
	if n > 0 {
		log.Printf("retention sweep: removed %d event(s) older than %d days", n, eventsDays)
	}
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

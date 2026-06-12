package retention

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestRunSweep(t *testing.T) {
	dataDir := t.TempDir()
	replaysDir := filepath.Join(dataDir, "replays")
	if err := os.MkdirAll(replaysDir, 0o755); err != nil {
		t.Fatal(err)
	}

	// oldSession — last chunk was written > 7 days ago.
	oldDir := filepath.Join(replaysDir, "old-session")
	if err := os.MkdirAll(oldDir, 0o755); err != nil {
		t.Fatal(err)
	}
	oldChunk := filepath.Join(oldDir, "000001.json.gz")
	if err := os.WriteFile(oldChunk, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	// Back-date the file's mtime to 8 days ago.
	old := time.Now().AddDate(0, 0, -8)
	if err := os.Chtimes(oldChunk, old, old); err != nil {
		t.Fatal(err)
	}

	// recentSession — last chunk is fresh.
	newDir := filepath.Join(replaysDir, "new-session")
	if err := os.MkdirAll(newDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(newDir, "000001.json.gz"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}

	runSweep(dataDir, 7)

	if _, err := os.Stat(oldDir); !os.IsNotExist(err) {
		t.Error("old-session dir should have been deleted")
	}
	if _, err := os.Stat(newDir); err != nil {
		t.Errorf("new-session dir should still exist: %v", err)
	}
}

func TestRunSweep_NoReplaysDir(t *testing.T) {
	// Should not panic when replays dir doesn't exist yet.
	runSweep(t.TempDir(), 7)
}

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

// fakeDeleter records the cutoff it was called with.
type fakeDeleter struct {
	gotCutoff int64
	deleted   int64
}

func (f *fakeDeleter) DeleteEventsBefore(cutoffMs int64) (int64, error) {
	f.gotCutoff = cutoffMs
	return f.deleted, nil
}

func TestSweepEvents(t *testing.T) {
	f := &fakeDeleter{deleted: 5}
	sweepEvents(f, 30)

	// Cutoff should be ~30 days ago in unix ms.
	want := time.Now().AddDate(0, 0, -30).UnixMilli()
	if diff := f.gotCutoff - want; diff < -60_000 || diff > 60_000 {
		t.Errorf("cutoff off by %dms; got %d want ~%d", diff, f.gotCutoff, want)
	}
}

func TestStartSweep_AllZeroIsNoop(t *testing.T) {
	f := &fakeDeleter{}
	// replaysDays=0 and eventsDays=0 → no goroutine, deleter never called.
	StartSweep(t.TempDir(), 0, f, 0)
	time.Sleep(20 * time.Millisecond)
	if f.gotCutoff != 0 {
		t.Error("deleter should not have been called when both retentions are 0")
	}
}

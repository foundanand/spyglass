package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeConfig(t *testing.T, content string) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "spyglass.config.json")
	if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestLoadConfig(t *testing.T) {
	tests := []struct {
		name    string
		content string
		env     map[string]string
		wantErr bool
		check   func(*testing.T, *Config)
	}{
		{
			name: "valid minimal config",
			content: `{
				"listen": ":7474",
				"dataDir": "./data",
				"apps": {"demo": {"key": "sg_live_abc"}},
				"retention": {"replays_days": 21}
			}`,
			check: func(t *testing.T, c *Config) {
				if c.Listen != ":7474" {
					t.Errorf("listen = %q, want :7474", c.Listen)
				}
				if c.Apps["demo"].Key != "sg_live_abc" {
					t.Error("expected app key")
				}
			},
		},
		{
			name:    "defaults applied when fields omitted",
			content: `{"apps": {"x": {"key": "k"}}}`,
			check: func(t *testing.T, c *Config) {
				if c.Listen != ":7474" {
					t.Errorf("default listen = %q, want :7474", c.Listen)
				}
				if c.DataDir != "./data" {
					t.Errorf("default dataDir = %q", c.DataDir)
				}
				if c.Retention.ReplaysDays != 21 {
					t.Errorf("default replays_days = %d", c.Retention.ReplaysDays)
				}
			},
		},
		{
			name:    "missing apps → error",
			content: `{"listen": ":7474"}`,
			wantErr: true,
		},
		{
			name:    "empty app key → error",
			content: `{"apps": {"bad": {"key": ""}}}`,
			wantErr: true,
		},
		{
			name: "env: resolution works",
			content: `{
				"apps": {"a": {"key": "k"}},
				"auth": {"dashboard_password": "env:SG_TEST_PASS"}
			}`,
			env: map[string]string{"SG_TEST_PASS": "secret123"},
			check: func(t *testing.T, c *Config) {
				if c.Auth.DashboardPassword != "secret123" {
					t.Errorf("got %q, want secret123", c.Auth.DashboardPassword)
				}
			},
		},
		{
			name: "env: missing var → error",
			content: `{
				"apps": {"a": {"key": "k"}},
				"auth": {"dashboard_password": "env:SG_DOES_NOT_EXIST_XYZ"}
			}`,
			wantErr: true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			for k, v := range tc.env {
				t.Setenv(k, v)
			}
			cfg, err := LoadConfig(writeConfig(t, tc.content))
			if tc.wantErr {
				if err == nil {
					t.Fatal("expected error, got nil")
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if tc.check != nil {
				tc.check(t, cfg)
			}
		})
	}
}

// A replays_days of 0 documents "keep forever" (README, and retention.StartSweep
// treats <= 0 that way). Defaults are only for keys the operator left out, so an
// explicit 0 must survive them — filling in 21 would silently start deleting
// replays somebody asked to keep.
func TestRetentionZeroMeansKeepForever(t *testing.T) {
	cfg, err := LoadConfig(writeConfig(t, `{
		"apps": {"a": {"key": "k"}},
		"retention": {"replays_days": 0, "events_days": 0}
	}`))
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	if cfg.Retention.ReplaysDays != 0 {
		t.Errorf("replays_days = %d, want 0 (keep forever)", cfg.Retention.ReplaysDays)
	}
}

func TestRetentionDefaultsOnlyWhenAbsent(t *testing.T) {
	cfg, err := LoadConfig(writeConfig(t, `{"apps": {"a": {"key": "k"}}}`))
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	if cfg.Retention.ReplaysDays != 21 {
		t.Errorf("replays_days = %d, want the 21-day default", cfg.Retention.ReplaysDays)
	}
}

// An app key is a credential. The config file is meant to be the whole ops
// story and safe to keep in version control, which it cannot be if the one
// thing it must carry literally is a key.
func TestAppKeyFromEnv(t *testing.T) {
	t.Setenv("SG_TEST_APP_KEY", "sg_live_from_env")

	cfg, err := LoadConfig(writeConfig(t, `{
		"apps": {"demo": {"key": "env:SG_TEST_APP_KEY"}}
	}`))
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	if got := cfg.Apps["demo"].Key; got != "sg_live_from_env" {
		t.Errorf("app key = %q, want the resolved env value", got)
	}
}

func TestAppKeyLiteralIsUnchanged(t *testing.T) {
	cfg, err := LoadConfig(writeConfig(t, `{
		"apps": {"demo": {"key": "sg_live_literal"}}
	}`))
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	if got := cfg.Apps["demo"].Key; got != "sg_live_literal" {
		t.Errorf("app key = %q, want it left alone", got)
	}
}

func TestAppKeyMissingEnvIsAnError(t *testing.T) {
	// Silently starting with an empty key would accept every ingest request
	// that also sends an empty key. Fail at boot instead.
	_, err := LoadConfig(writeConfig(t, `{
		"apps": {"demo": {"key": "env:SG_DOES_NOT_EXIST_XYZ"}}
	}`))
	if err == nil {
		t.Fatal("expected an error for an unset app-key env var")
	}
	if !strings.Contains(err.Error(), "apps.demo.key") {
		t.Errorf("error should name the field, got: %v", err)
	}
}

// A server key equal to the browser key would hand every browser the ability to
// skip the origin check, silently making the allowlist decorative.
func TestServerKeyMustDifferFromBrowserKey(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "c.json")
	write := func(body string) {
		if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	write(`{"apps":{"demo":{"key":"same","server_key":"same"}}}`)
	if _, err := LoadConfig(path); err == nil {
		t.Error("server_key equal to key should be rejected")
	}

	write(`{"apps":{"demo":{"key":"browser","server_key":"secret"}}}`)
	cfg, err := LoadConfig(path)
	if err != nil {
		t.Fatalf("distinct keys should load: %v", err)
	}
	if cfg.Apps["demo"].ServerKey != "secret" {
		t.Errorf("server_key = %q", cfg.Apps["demo"].ServerKey)
	}

	// Absent server_key is the default posture: browsers only.
	write(`{"apps":{"demo":{"key":"browser"}}}`)
	cfg, err = LoadConfig(path)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Apps["demo"].ServerKey != "" {
		t.Errorf("server_key should default to empty, got %q", cfg.Apps["demo"].ServerKey)
	}
}

func TestServerKeyResolvesFromEnv(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "c.json")
	if err := os.WriteFile(path, []byte(
		`{"apps":{"demo":{"key":"browser","server_key":"env:SG_TEST_SERVER_KEY"}}}`), 0o644); err != nil {
		t.Fatal(err)
	}

	if _, err := LoadConfig(path); err == nil {
		t.Error("unset env var should fail loudly rather than leaving an empty key")
	}

	t.Setenv("SG_TEST_SERVER_KEY", "from-env")
	cfg, err := LoadConfig(path)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Apps["demo"].ServerKey != "from-env" {
		t.Errorf("server_key = %q, want from-env", cfg.Apps["demo"].ServerKey)
	}
}

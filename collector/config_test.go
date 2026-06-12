package main

import (
	"os"
	"path/filepath"
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
			name: "defaults applied when fields omitted",
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
			env:   map[string]string{"SG_TEST_PASS": "secret123"},
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

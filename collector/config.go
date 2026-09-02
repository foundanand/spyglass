package main

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
)

// Config is the top-level configuration loaded from spyglass.config.json.
type Config struct {
	Listen    string            `json:"listen"`
	DataDir   string            `json:"dataDir"`
	Apps      map[string]AppCfg `json:"apps"`
	Retention RetentionCfg      `json:"retention"`
	Auth      AuthCfg           `json:"auth"`
	Webhooks  WebhookCfg        `json:"webhooks"`

	// retentionSet records whether replays_days was actually present in the
	// file, so an explicit 0 ("keep forever") survives default application.
	retentionSet bool
}

// AppCfg holds per-application settings.
type AppCfg struct {
	// Key is the browser key. It ships to the client and is public by design,
	// which is why it is paired with an origin allowlist.
	Key string `json:"key"`
	// ServerKey authenticates callers that are not browsers — a worker, a cron
	// job, a CLI. It is never sent to a client, so it is a real secret and it
	// skips the origin check (a server has no meaningful Origin to present).
	//
	// Optional: absent means only browsers can report, which is the default
	// posture.
	ServerKey string   `json:"server_key"`
	Origins   []string `json:"origins"`
}

// RetentionCfg controls how long data is kept.
type RetentionCfg struct {
	ReplaysDays int `json:"replays_days"`
	EventsDays  int `json:"events_days"`
}

// AuthCfg holds dashboard authentication settings.
type AuthCfg struct {
	DashboardPassword string `json:"dashboard_password"`
}

// WebhookCfg configures the collector's only outbound calls.
//
// Absent means no egress is possible — not disabled, absent: with no URL the
// notifier is never constructed and no code path exists that could dial out.
// Point these at an in-enclave receiver and the air-gap guarantee is intact.
type WebhookCfg struct {
	// OnBugReport fires when a user files a bug report.
	OnBugReport string `json:"on_bug_report"`
	// OnNewError fires the first time an error signature is seen in the window.
	OnNewError string `json:"on_new_error"`
	// DashboardURL is the externally reachable base URL of this collector, used
	// to build the incident deep link in a message. Optional.
	DashboardURL string `json:"dashboard_url"`
}

// LoadConfig reads and validates the config file at path.
// Values prefixed with "env:" are resolved from environment variables.
func LoadConfig(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read config %q: %w", path, err)
	}

	var cfg Config
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("parse config: %w", err)
	}

	// Distinguish "retention.replays_days: 0" (keep forever) from an absent key
	// (use the default) — json.Unmarshal renders both as the zero value.
	var raw struct {
		Retention *struct {
			ReplaysDays *int `json:"replays_days"`
		} `json:"retention"`
	}
	if err := json.Unmarshal(data, &raw); err == nil {
		cfg.retentionSet = raw.Retention != nil && raw.Retention.ReplaysDays != nil
	}

	if err := cfg.resolveEnvRefs(); err != nil {
		return nil, err
	}

	if err := cfg.validate(); err != nil {
		return nil, err
	}

	// Apply defaults.
	if cfg.Listen == "" {
		cfg.Listen = ":7474"
	}
	if cfg.DataDir == "" {
		cfg.DataDir = "./data"
	}
	// A retention of 0 means "keep forever" (both here and in retention.StartSweep),
	// so the 21-day default can only apply when the key is genuinely absent —
	// filling in 0 would silently start deleting replays an operator asked to keep.
	if !cfg.retentionSet {
		cfg.Retention.ReplaysDays = 21
	}

	return &cfg, nil
}

// resolveEnvRef expands a single "env:NAME" reference. Values without the
// prefix are returned unchanged, so a literal stays a literal.
func resolveEnvRef(value, field string) (string, error) {
	if !strings.HasPrefix(value, "env:") {
		return value, nil
	}
	name := strings.TrimPrefix(value, "env:")
	val, ok := os.LookupEnv(name)
	if !ok {
		return "", fmt.Errorf("config: env var %q not set (referenced in %s)", name, field)
	}
	return val, nil
}

func (c *Config) resolveEnvRefs() error {
	pw, err := resolveEnvRef(c.Auth.DashboardPassword, "auth.dashboard_password")
	if err != nil {
		return err
	}
	c.Auth.DashboardPassword = pw

	// Webhook URLs are credentials in practice — a Slack URL is a bearer token —
	// so they get the same env: treatment, and stay out of version control.
	for _, ref := range []struct {
		val   *string
		field string
	}{
		{&c.Webhooks.OnBugReport, "webhooks.on_bug_report"},
		{&c.Webhooks.OnNewError, "webhooks.on_new_error"},
		{&c.Webhooks.DashboardURL, "webhooks.dashboard_url"},
	} {
		v, err := resolveEnvRef(*ref.val, ref.field)
		if err != nil {
			return err
		}
		*ref.val = v
	}

	for name, app := range c.Apps {
		sk, err := resolveEnvRef(app.ServerKey, "apps."+name+".server_key")
		if err != nil {
			return err
		}
		app.ServerKey = sk
		c.Apps[name] = app
	}

	// App keys too. Without this the config file — "the entire ops story" — is
	// the one place a credential cannot come from the environment, which forces
	// operators to either commit a key or keep the file out of version control
	// entirely. Both are worse than an env reference.
	for name, app := range c.Apps {
		key, err := resolveEnvRef(app.Key, fmt.Sprintf("apps.%s.key", name))
		if err != nil {
			return err
		}
		app.Key = key
		c.Apps[name] = app
	}
	return nil
}

func (c *Config) validate() error {
	if len(c.Apps) == 0 {
		return fmt.Errorf("config: at least one app is required")
	}
	for name, app := range c.Apps {
		if app.Key == "" {
			return fmt.Errorf("config: app %q has empty key", name)
		}
		// A server key equal to the browser key would silently hand every
		// browser the ability to skip the origin check.
		if app.ServerKey != "" && app.ServerKey == app.Key {
			return fmt.Errorf("config: app %q has server_key equal to key; the server key must be a separate secret", name)
		}
	}
	return nil
}

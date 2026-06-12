package main

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
)

// Config is the top-level configuration loaded from spyglass.config.json.
type Config struct {
	Listen    string             `json:"listen"`
	DataDir   string             `json:"dataDir"`
	Apps      map[string]AppCfg  `json:"apps"`
	Retention RetentionCfg       `json:"retention"`
	Auth      AuthCfg            `json:"auth"`
}

// AppCfg holds per-application settings.
type AppCfg struct {
	Key     string   `json:"key"`
	Origins []string `json:"origins"`
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
	if cfg.Retention.ReplaysDays == 0 {
		cfg.Retention.ReplaysDays = 21
	}

	return &cfg, nil
}

func (c *Config) resolveEnvRefs() error {
	if strings.HasPrefix(c.Auth.DashboardPassword, "env:") {
		name := strings.TrimPrefix(c.Auth.DashboardPassword, "env:")
		val, ok := os.LookupEnv(name)
		if !ok {
			return fmt.Errorf("config: env var %q not set (referenced in auth.dashboard_password)", name)
		}
		c.Auth.DashboardPassword = val
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
	}
	return nil
}

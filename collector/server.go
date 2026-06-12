package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/foundanand/spyglass/collector/dashboard"
	"github.com/foundanand/spyglass/collector/ingest"
	"github.com/foundanand/spyglass/collector/query"
	"github.com/foundanand/spyglass/collector/retention"
	"github.com/foundanand/spyglass/collector/store"
)

func run(cfg *Config, st *store.Store) error {
	mux := http.NewServeMux()

	// Convert config apps to ingest.AppCfg map.
	apps := make(map[string]ingest.AppCfg, len(cfg.Apps))
	for name, a := range cfg.Apps {
		apps[name] = ingest.AppCfg{Key: a.Key, Origins: a.Origins}
	}

	replayHandler := query.NewReplayHandler(cfg.DataDir)
	incidentHandler := query.NewIncidentHandler(st, cfg.DataDir)

	mux.Handle("POST /v1/events", ingest.NewEventsHandler(st, apps))
	mux.Handle("OPTIONS /v1/events", ingest.NewEventsHandler(st, apps))
	mux.Handle("POST /v1/replay", ingest.NewReplayHandler(st, apps, cfg.DataDir))
	mux.Handle("GET /v1/query/events", query.NewEventsHandler(st))
	mux.Handle("GET /v1/query/users", query.NewUsersHandler(st))
	mux.Handle("GET /v1/query/sessions", query.NewSessionsHandler(st))
	mux.Handle("GET /v1/sessions/", replayHandler)
	mux.Handle("GET /v1/incidents/", incidentHandler)
	mux.Handle("/", dashboard.Handler())

	retention.StartSweep(cfg.DataDir, cfg.Retention.ReplaysDays)

	srv := &http.Server{
		Addr:         cfg.Listen,
		Handler:      mux,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	errCh := make(chan error, 1)
	go func() {
		log.Printf("spyglassd %s listening on %s", version, cfg.Listen)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			errCh <- err
		}
		close(errCh)
	}()

	select {
	case err := <-errCh:
		return err
	case <-ctx.Done():
		log.Println("shutting down…")
		shutCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		return srv.Shutdown(shutCtx)
	}
}

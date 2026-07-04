package main

import (
	"context"
	"kiroku-api/internal/anki"
	"kiroku-api/internal/config"
	"kiroku-api/internal/db"
	"kiroku-api/internal/events"
	"kiroku-api/internal/handlers"
	"kiroku-api/internal/middleware"
	"kiroku-api/internal/signal"
	"log"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

// staleUploadAge is how long an interrupted chunked upload session is kept on disk before the
// background sweeper reclaims it.
const staleUploadAge = 24 * time.Hour

// signalRoomTTL is how long a P2P signaling room survives without activity before it's
// reclaimed. Generous enough to cover a slow handshake (a device on a bad connection retrying
// ICE candidates), short enough that an abandoned room doesn't linger.
const signalRoomTTL = 10 * time.Minute

func main() {
	// Configure structured logging first so config errors are logged in JSON too.
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	slog.SetDefault(logger)

	cfg, err := config.Load()
	if err != nil {
		slog.Error("Failed to load configuration", "error", err)
		os.Exit(1)
	}

	database, err := db.Init(cfg.DataDir)
	if err != nil {
		slog.Error("Failed to initialize database", "error", err)
		os.Exit(1)
	}
	defer database.Close()

	if len(os.Args) > 1 && os.Args[1] == "-healthcheck" {
		if err := database.Ping(); err != nil {
			slog.Error("Healthcheck failed", "error", err)
			os.Exit(1)
		}
		return
	}

	signalRegistry := signal.NewRegistry(signalRoomTTL)
	h := &handlers.Handler{
		DB:     database,
		Config: cfg,
		Events: events.NewHub(),
		Signal: signalRegistry,
	}

	mux := http.NewServeMux()
	handlers.RegisterRoutes(mux, h)

	// Reclaim abandoned P2P signaling rooms. The registry has no shutdown to wait for (it's
	// pure in-memory bookkeeping), so a background context — rather than one tied to a real
	// shutdown signal, which this server doesn't otherwise have — is enough here.
	go signalRegistry.Run(context.Background())

	// Reclaim disk from chunked uploads that were started but never completed: sweep once at
	// startup, then hourly in the background.
	uploadsRoot := filepath.Join(cfg.DataDir, "uploads")
	if err := anki.SweepStaleSessions(uploadsRoot, staleUploadAge); err != nil {
		slog.Warn("Initial upload session sweep failed", "error", err)
	}
	go func() {
		ticker := time.NewTicker(time.Hour)
		defer ticker.Stop()
		for range ticker.C {
			if err := anki.SweepStaleSessions(uploadsRoot, staleUploadAge); err != nil {
				slog.Warn("Upload session sweep failed", "error", err)
			}
		}
	}()

	// Wrap mux with middleware
	handler := middleware.WithRequestID(mux)
	handler = middleware.Logging(handler)
	handler = middleware.CommonHeaders(handler)
	handler = middleware.Recover(handler)

	slog.Info("Kiroku API listening", "port", cfg.Port)
	if err := http.ListenAndServe("0.0.0.0:"+cfg.Port, handler); err != nil {
		log.Fatal(err)
	}
}

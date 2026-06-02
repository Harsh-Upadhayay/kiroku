package main

import (
	"kiroku-api/internal/config"
	"kiroku-api/internal/db"
	"kiroku-api/internal/handlers"
	"kiroku-api/internal/middleware"
	"log"
	"log/slog"
	"net/http"
	"os"
)

func main() {
	cfg := config.Load()

	// Configure structured logging
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	slog.SetDefault(logger)

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

	h := &handlers.Handler{
		DB:     database,
		Config: cfg,
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", h.Health)
	mux.HandleFunc("GET /api/healthz", h.Health)
	mux.HandleFunc("POST /api/auth/register", h.Register)
	mux.HandleFunc("POST /api/auth/login", h.Login)
	mux.HandleFunc("POST /api/sync/push", h.SyncPush)
	mux.HandleFunc("POST /api/sync/pull", h.SyncPull)
	mux.HandleFunc("POST /api/import-apkg", h.ImportAPKG)
	mux.HandleFunc("POST /api/auth/change-password", h.ChangePassword)
	mux.HandleFunc("POST /api/auth/delete-account", h.DeleteAccount)

	// Wrap mux with middleware
	handler := middleware.WithRequestID(mux)
	handler = middleware.Logging(handler)
	handler = middleware.CommonHeaders(handler)

	slog.Info("Kiroku API listening", "port", cfg.Port)
	if err := http.ListenAndServe("0.0.0.0:"+cfg.Port, handler); err != nil {
		log.Fatal(err)
	}
}

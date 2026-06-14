// Package middleware provides standard HTTP middleware. Each function takes the next
// http.Handler and returns a wrapped one, so they compose by nesting (see main.go).
package middleware

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"runtime/debug"

	"github.com/google/uuid"
)

// contextKey is an unexported type for context keys, so values stored under it can't collide
// with keys from other packages.
type contextKey string

// RequestIDKey is the context key under which the per-request ID is stored.
const RequestIDKey contextKey = "requestId"

// WithRequestID attaches a request ID to the request context and echoes it back in the
// X-Request-ID response header, reusing an inbound X-Request-ID when the client sent one.
func WithRequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestID := r.Header.Get("X-Request-ID")
		if requestID == "" {
			requestID = uuid.New().String()
		}
		ctx := context.WithValue(r.Context(), RequestIDKey, requestID)
		w.Header().Set("X-Request-ID", requestID)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// Logging emits a structured log line for each inbound request.
func Logging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestID, _ := r.Context().Value(RequestIDKey).(string)
		slog.Info("Request started",
			"method", r.Method,
			"path", r.URL.Path,
			"request_id", requestID,
			"remote_addr", r.RemoteAddr,
		)
		next.ServeHTTP(w, r)
	})
}

// CommonHeaders sets security headers applied to every response.
func CommonHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		next.ServeHTTP(w, r)
	})
}

// Recover catches a panic from a downstream handler, logs it with a stack trace, and returns
// a 500 JSON error instead of letting the connection drop.
func Recover(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				slog.Error("panic in handler", "error", rec, "stack", string(debug.Stack()))
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusInternalServerError)
				json.NewEncoder(w).Encode(map[string]any{"success": false, "error": "internal server error"})
			}
		}()
		next.ServeHTTP(w, r)
	})
}

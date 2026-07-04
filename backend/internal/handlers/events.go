package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"kiroku-api/internal/auth"
)

// sseHeartbeatInterval keeps the stream alive through proxies. Cloudflare drops idle
// connections after ~100s; a comment line every 25s stays comfortably under that, and
// EventSource clients ignore comment lines entirely.
const sseHeartbeatInterval = 25 * time.Second

// SyncEvents streams "state changed" pokes for a user's devices as Server-Sent Events.
// GET /api/sync/events?email=...
//
// SSE fits this job better than WebSockets: it is plain HTTP (no upgrade to proxy through),
// one-directional (the client talks back over normal REST), and the browser's EventSource
// reconnects by itself. The handler is a select loop over three things: an event to forward,
// a heartbeat tick, or the client going away (r.Context() is canceled when the connection
// drops — tying cleanup to the request context is what stops this goroutine from leaking).
func (h *Handler) SyncEvents(w http.ResponseWriter, r *http.Request) {
	if h.Events == nil {
		h.WriteError(w, http.StatusServiceUnavailable, "Event stream unavailable", nil)
		return
	}
	email := auth.NormalizeEmail(r.URL.Query().Get("email"))
	if email == "" {
		h.WriteError(w, http.StatusBadRequest, "Missing email", nil)
		return
	}
	// Streaming needs per-message flushing; without a Flusher the response would sit in a
	// buffer until the handler returns, which for SSE is "never".
	flusher, ok := w.(http.Flusher)
	if !ok {
		h.WriteError(w, http.StatusInternalServerError, "Streaming unsupported", nil)
		return
	}

	// Subscribe BEFORE announcing readiness. If the greeting went out first, a client that
	// pushed the instant it saw ": connected" could have its poke published into the hub
	// before this handler was actually listening — and a non-blocking Publish drops it. By
	// subscribing first, "greeting received" reliably means "this stream will catch events
	// from here on."
	ch, cancel := h.Events.Subscribe(email)
	defer cancel()

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	// Tells buffering reverse proxies (nginx and friends) to pass bytes through as written.
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	// An immediate comment line forces headers + first bytes onto the wire, so the client's
	// EventSource fires "open" right away instead of when the first real event happens.
	fmt.Fprint(w, ": connected\n\n")
	flusher.Flush()

	heartbeat := time.NewTicker(sseHeartbeatInterval)
	defer heartbeat.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case event := <-ch:
			payload, err := json.Marshal(event)
			if err != nil {
				continue
			}
			fmt.Fprintf(w, "event: sync\ndata: %s\n\n", payload)
			flusher.Flush()
		case <-heartbeat.C:
			fmt.Fprint(w, ": ping\n\n")
			flusher.Flush()
		}
	}
}

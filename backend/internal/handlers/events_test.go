package handlers

import (
	"bufio"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"kiroku-api/internal/config"
	"kiroku-api/internal/events"
)

// TestSyncEventsStreamsPublishedEvents drives the SSE handler over a real HTTP connection —
// httptest.NewRecorder can't model a long-lived streaming response being read while the
// handler is still running.
func TestSyncEventsStreamsPublishedEvents(t *testing.T) {
	hub := events.NewHub()
	h := &Handler{Config: &config.Config{}, Events: hub}
	mux := http.NewServeMux()
	RegisterRoutes(mux, h)
	server := httptest.NewServer(mux)
	defer server.Close()

	ctx, cancelReq := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelReq()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, server.URL+"/api/sync/events?email=User@Example.com", nil)
	if err != nil {
		t.Fatal(err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("open stream: %v", err)
	}
	defer resp.Body.Close()
	if ct := resp.Header.Get("Content-Type"); ct != "text/event-stream" {
		t.Fatalf("Content-Type = %q", ct)
	}

	reader := bufio.NewReader(resp.Body)
	// First line is the ": connected" comment, flushed immediately on subscribe.
	first, err := reader.ReadString('\n')
	if err != nil {
		t.Fatalf("read greeting: %v", err)
	}
	if !strings.HasPrefix(first, ": connected") {
		t.Fatalf("greeting = %q", first)
	}

	// Publish under the normalized email — the handler must normalize the query param the
	// same way SyncPush normalizes the body email, or devices never hear each other.
	hub.Publish("user@example.com", events.Event{Origin: "device-a", At: 7})

	deadline := time.Now().Add(3 * time.Second)
	var eventLine, dataLine string
	for time.Now().Before(deadline) {
		line, err := reader.ReadString('\n')
		if err != nil {
			t.Fatalf("read stream: %v", err)
		}
		if strings.HasPrefix(line, "event: ") {
			eventLine = strings.TrimSpace(line)
		}
		if strings.HasPrefix(line, "data: ") {
			dataLine = strings.TrimSpace(line)
			break
		}
	}
	if eventLine != "event: sync" {
		t.Fatalf("event line = %q", eventLine)
	}
	if !strings.Contains(dataLine, `"origin":"device-a"`) || !strings.Contains(dataLine, `"at":7`) {
		t.Fatalf("data line = %q", dataLine)
	}
}

func TestSyncEventsRejectsMissingEmailAndNilHub(t *testing.T) {
	withHub := &Handler{Config: &config.Config{}, Events: events.NewHub()}
	w := httptest.NewRecorder()
	withHub.SyncEvents(w, httptest.NewRequest(http.MethodGet, "/api/sync/events", nil))
	if w.Code != http.StatusBadRequest {
		t.Fatalf("missing email: code = %d, want 400", w.Code)
	}

	noHub := &Handler{Config: &config.Config{}}
	w = httptest.NewRecorder()
	noHub.SyncEvents(w, httptest.NewRequest(http.MethodGet, "/api/sync/events?email=a@b.c", nil))
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("nil hub: code = %d, want 503", w.Code)
	}
}

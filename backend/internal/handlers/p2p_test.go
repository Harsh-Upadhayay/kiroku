package handlers

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"kiroku-api/internal/config"
	"kiroku-api/internal/signal"
)

func newP2PTestHandler(t *testing.T) *Handler {
	t.Helper()
	return &Handler{Config: &config.Config{}, Signal: signal.NewRegistry(time.Minute)}
}

func postJSON(h *Handler, fn http.HandlerFunc, path string, body any) *httptest.ResponseRecorder {
	b, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(b))
	w := httptest.NewRecorder()
	fn(w, req)
	return w
}

func decodeAPI[T any](t *testing.T, w *httptest.ResponseRecorder) T {
	t.Helper()
	var resp struct {
		Success bool `json:"success"`
		Data    T    `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response %s: %v", w.Body.String(), err)
	}
	return resp.Data
}

func TestP2PCreateAndListRooms(t *testing.T) {
	h := newP2PTestHandler(t)

	w := postJSON(h, h.P2PCreateRoom, "/api/p2p/rooms", map[string]any{
		"email": "User@Example.com", "mode": "push", "deckName": "N5 Kanji", "mediaCount": 2, "totalBytes": 512,
	})
	if w.Code != http.StatusCreated {
		t.Fatalf("create room: code=%d body=%s", w.Code, w.Body.String())
	}
	room := decodeAPI[signal.RoomMeta](t, w)
	if room.ID == "" || room.DeckName != "N5 Kanji" {
		t.Fatalf("created room = %+v", room)
	}

	// Listing must normalize the email the same way SyncPush does, or a device querying with
	// different casing would never find its own rooms.
	req := httptest.NewRequest(http.MethodGet, "/api/p2p/rooms?email=user@example.com", nil)
	w = httptest.NewRecorder()
	h.P2PListRooms(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("list rooms: code=%d", w.Code)
	}
	listed := decodeAPI[struct {
		Rooms []signal.RoomMeta `json:"rooms"`
	}](t, w)
	if len(listed.Rooms) != 1 || listed.Rooms[0].ID != room.ID {
		t.Fatalf("listed rooms = %+v, want the created room", listed.Rooms)
	}
}

func TestP2PCreateRoomRejectsInvalidMode(t *testing.T) {
	h := newP2PTestHandler(t)
	w := postJSON(h, h.P2PCreateRoom, "/api/p2p/rooms", map[string]any{"email": "a@b.c", "mode": "sideways"})
	if w.Code != http.StatusBadRequest {
		t.Fatalf("invalid mode: code=%d, want 400", w.Code)
	}
}

func TestP2PListRoomsRequiresEmail(t *testing.T) {
	h := newP2PTestHandler(t)
	req := httptest.NewRequest(http.MethodGet, "/api/p2p/rooms", nil)
	w := httptest.NewRecorder()
	h.P2PListRooms(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("missing email: code=%d, want 400", w.Code)
	}
}

func TestP2PMessageRoundTripAndClose(t *testing.T) {
	h := newP2PTestHandler(t)
	room := h.Signal.Create("user@example.com", signal.RoomMeta{Mode: signal.ModePush})

	postMessage := func(from, kind, roomID string) *httptest.ResponseRecorder {
		body, _ := json.Marshal(map[string]any{"from": from, "kind": kind, "payload": map[string]string{"sdp": "x"}})
		req := httptest.NewRequest(http.MethodPost, "/api/p2p/rooms/"+roomID+"/messages", bytes.NewReader(body))
		req.SetPathValue("roomID", roomID)
		w := httptest.NewRecorder()
		h.P2PPostMessage(w, req)
		return w
	}
	getMessages := func(from, roomID string, since int) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, "/api/p2p/rooms/"+roomID+"/messages", nil)
		q := req.URL.Query()
		q.Set("from", from)
		q.Set("since", "0")
		_ = since
		req.URL.RawQuery = q.Encode()
		req.SetPathValue("roomID", roomID)
		w := httptest.NewRecorder()
		h.P2PGetMessages(w, req)
		return w
	}

	w := postMessage("device-a", "offer", room.ID)
	if w.Code != http.StatusOK {
		t.Fatalf("post message: code=%d body=%s", w.Code, w.Body.String())
	}
	seqResp := decodeAPI[struct {
		Seq int `json:"seq"`
	}](t, w)
	if seqResp.Seq != 1 {
		t.Fatalf("seq = %d, want 1", seqResp.Seq)
	}

	w = getMessages("device-b", room.ID, 0)
	if w.Code != http.StatusOK {
		t.Fatalf("get messages: code=%d body=%s", w.Code, w.Body.String())
	}
	got := decodeAPI[struct {
		Messages  []signal.Message `json:"messages"`
		NextSince int              `json:"nextSince"`
	}](t, w)
	if len(got.Messages) != 1 || got.Messages[0].From != "device-a" || got.NextSince != 1 {
		t.Fatalf("get messages result = %+v", got)
	}

	// device-a polling its own message back must see nothing.
	w = getMessages("device-a", room.ID, 0)
	got = decodeAPI[struct {
		Messages  []signal.Message `json:"messages"`
		NextSince int              `json:"nextSince"`
	}](t, w)
	if len(got.Messages) != 0 {
		t.Fatalf("device-a saw its own echoed message: %+v", got.Messages)
	}

	req := httptest.NewRequest(http.MethodDelete, "/api/p2p/rooms/"+room.ID, nil)
	req.SetPathValue("roomID", room.ID)
	w = httptest.NewRecorder()
	h.P2PCloseRoom(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("close room: code=%d", w.Code)
	}

	w = postMessage("device-a", "offer", room.ID)
	if w.Code != http.StatusNotFound {
		t.Fatalf("post to closed room: code=%d, want 404", w.Code)
	}
}

func TestP2PHandlersServiceUnavailableWithoutRegistry(t *testing.T) {
	h := &Handler{Config: &config.Config{}} // Signal left nil
	cases := []struct {
		name string
		call func() *httptest.ResponseRecorder
	}{
		{"create", func() *httptest.ResponseRecorder {
			return postJSON(h, h.P2PCreateRoom, "/api/p2p/rooms", map[string]any{"email": "a@b.c", "mode": "push"})
		}},
		{"list", func() *httptest.ResponseRecorder {
			req := httptest.NewRequest(http.MethodGet, "/api/p2p/rooms?email=a@b.c", nil)
			w := httptest.NewRecorder()
			h.P2PListRooms(w, req)
			return w
		}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if w := c.call(); w.Code != http.StatusServiceUnavailable {
				t.Fatalf("code=%d, want 503", w.Code)
			}
		})
	}
}

// TestP2PRoutesResolve pins the P2P route set so a future reshuffle can't silently drop one,
// mirroring the existing route-registration guard tests.
func TestP2PRoutesResolve(t *testing.T) {
	mux := http.NewServeMux()
	RegisterRoutes(mux, &Handler{})

	for _, c := range []struct{ method, path string }{
		{http.MethodPost, "/api/p2p/rooms"},
		{http.MethodGet, "/api/p2p/rooms"},
		{http.MethodDelete, "/api/p2p/rooms/some-id"},
		{http.MethodPost, "/api/p2p/rooms/some-id/messages"},
		{http.MethodGet, "/api/p2p/rooms/some-id/messages"},
	} {
		req := httptest.NewRequest(c.method, c.path, nil)
		if _, pattern := mux.Handler(req); pattern == "" {
			t.Errorf("no route matched %s %s", c.method, c.path)
		}
	}
}

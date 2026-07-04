package handlers

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"kiroku-api/internal/auth"
	"kiroku-api/internal/models"
	"kiroku-api/internal/signal"
)

// This file is the HTTP surface over internal/signal's rendezvous mailbox: create a room,
// discover open rooms, and post/read the SDP+ICE messages that let two devices negotiate a
// direct WebRTC connection. None of these handlers touch the database — signaling state is
// deliberately ephemeral (see package signal's doc comment).

// writeSignalError maps a signal package error to a status code, the same pattern
// writeUploadError uses for the chunked-upload errors.
func (h *Handler) writeSignalError(w http.ResponseWriter, msg string, err error) {
	if errors.Is(err, signal.ErrRoomNotFound) {
		h.WriteError(w, http.StatusNotFound, "Room not found", err)
		return
	}
	h.WriteError(w, http.StatusInternalServerError, msg, err)
}

type createRoomReq struct {
	Email      string      `json:"email"`
	Mode       signal.Mode `json:"mode"`
	DeckName   string      `json:"deckName"`
	MediaCount int         `json:"mediaCount"`
	TotalBytes int64       `json:"totalBytes"`
}

// P2PCreateRoom opens a new signaling room. POST /api/p2p/rooms.
func (h *Handler) P2PCreateRoom(w http.ResponseWriter, r *http.Request) {
	if h.Signal == nil {
		h.WriteError(w, http.StatusServiceUnavailable, "P2P signaling unavailable", nil)
		return
	}
	req, err := decodeJSON[createRoomReq](r)
	if err != nil {
		h.WriteError(w, http.StatusBadRequest, "Invalid request", err)
		return
	}
	if req.Mode != signal.ModePush && req.Mode != signal.ModePull {
		h.WriteError(w, http.StatusBadRequest, "Invalid room mode", nil)
		return
	}

	email := auth.NormalizeEmail(req.Email)
	meta := h.Signal.Create(email, signal.RoomMeta{
		Mode:       req.Mode,
		DeckName:   req.DeckName,
		MediaCount: req.MediaCount,
		TotalBytes: req.TotalBytes,
	})
	h.WriteJSON(w, http.StatusCreated, models.APIResponse{Success: true, Data: meta})
}

// P2PListRooms returns the open rooms for a user, so another of their devices can discover a
// transfer being offered or requested. GET /api/p2p/rooms?email=...
func (h *Handler) P2PListRooms(w http.ResponseWriter, r *http.Request) {
	if h.Signal == nil {
		h.WriteError(w, http.StatusServiceUnavailable, "P2P signaling unavailable", nil)
		return
	}
	email := auth.NormalizeEmail(r.URL.Query().Get("email"))
	if email == "" {
		h.WriteError(w, http.StatusBadRequest, "Missing email", nil)
		return
	}
	rooms := h.Signal.OpenRooms(email)
	h.WriteJSON(w, http.StatusOK, models.APIResponse{Success: true, Data: map[string]any{"rooms": rooms}})
}

// P2PCloseRoom ends a room, e.g. once a transfer finishes or is abandoned.
// DELETE /api/p2p/rooms/{roomID}.
func (h *Handler) P2PCloseRoom(w http.ResponseWriter, r *http.Request) {
	if h.Signal == nil {
		h.WriteError(w, http.StatusServiceUnavailable, "P2P signaling unavailable", nil)
		return
	}
	if err := h.Signal.Close(r.PathValue("roomID")); err != nil {
		h.writeSignalError(w, "Failed to close room", err)
		return
	}
	h.WriteJSON(w, http.StatusOK, models.APIResponse{Success: true})
}

type postMessageReq struct {
	From    string          `json:"from"`
	Kind    string          `json:"kind"`
	Payload json.RawMessage `json:"payload"`
}

// P2PPostMessage appends one signaling message (an SDP offer/answer, an ICE candidate, ...) to
// a room. POST /api/p2p/rooms/{roomID}/messages.
func (h *Handler) P2PPostMessage(w http.ResponseWriter, r *http.Request) {
	if h.Signal == nil {
		h.WriteError(w, http.StatusServiceUnavailable, "P2P signaling unavailable", nil)
		return
	}
	req, err := decodeJSON[postMessageReq](r)
	if err != nil {
		h.WriteError(w, http.StatusBadRequest, "Invalid request", err)
		return
	}
	if req.From == "" || req.Kind == "" {
		h.WriteError(w, http.StatusBadRequest, "Missing from or kind", nil)
		return
	}

	seq, err := h.Signal.Append(r.PathValue("roomID"), req.From, req.Kind, req.Payload)
	if err != nil {
		h.writeSignalError(w, "Failed to post message", err)
		return
	}
	h.WriteJSON(w, http.StatusOK, models.APIResponse{Success: true, Data: map[string]int{"seq": seq}})
}

// P2PGetMessages returns a room's messages from the other device, after the given sequence
// number. GET /api/p2p/rooms/{roomID}/messages?from=...&since=0.
func (h *Handler) P2PGetMessages(w http.ResponseWriter, r *http.Request) {
	if h.Signal == nil {
		h.WriteError(w, http.StatusServiceUnavailable, "P2P signaling unavailable", nil)
		return
	}
	from := r.URL.Query().Get("from")
	if from == "" {
		h.WriteError(w, http.StatusBadRequest, "Missing from", nil)
		return
	}
	// An absent or malformed "since" defaults to 0 (the start of the room) rather than
	// rejecting the request — a first poll has nothing to compare against yet.
	since, _ := strconv.Atoi(r.URL.Query().Get("since"))

	messages, err := h.Signal.After(r.PathValue("roomID"), from, since)
	if err != nil {
		h.writeSignalError(w, "Failed to read messages", err)
		return
	}
	nextSince := since
	if len(messages) > 0 {
		nextSince = messages[len(messages)-1].Seq
	}
	h.WriteJSON(w, http.StatusOK, models.APIResponse{
		Success: true,
		Data:    map[string]any{"messages": messages, "nextSince": nextSince},
	})
}

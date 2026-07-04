// Package signal is a tiny in-memory rendezvous for WebRTC signaling. Two browser devices
// exchanging an SDP offer/answer and ICE candidates need a way to find each other and pass a
// handful of messages back and forth before they can open a direct RTCPeerConnection between
// themselves — after that, the server is no longer in the data path at all. This package is
// only that handshake mailbox: it never looks at what's inside a message.
//
// Rooms are throwaway. They're created when one device wants to send or receive media, and
// reclaimed by a TTL janitor shortly after. Nothing here survives a server restart — a lost
// room just means the clients retry or fall back to the cloud media store, so durability
// would be solving a problem that doesn't exist.
package signal

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"time"

	"github.com/google/uuid"
)

// ErrRoomNotFound is returned by Append/After/Close for an unknown or already-expired room.
var ErrRoomNotFound = errors.New("signal: room not found")

// Mode says which direction a room's transfer runs. Both directions share the exact same
// message protocol below — only which side is expected to speak first differs — so one Room
// shape covers a deck import (the importing device offers media to another) and cross-device
// seeding (a new device asks whoever's online for media) alike.
type Mode string

const (
	ModePush Mode = "push" // an importing device is offering media to whoever joins
	ModePull Mode = "pull" // a new device is requesting media from whoever has it
)

// RoomMeta is a room's discoverable metadata: enough for another device to decide whether to
// join, without any of the signaling traffic itself.
type RoomMeta struct {
	ID         string `json:"id"`
	Mode       Mode   `json:"mode"`
	DeckName   string `json:"deckName,omitempty"`
	MediaCount int    `json:"mediaCount"`
	TotalBytes int64  `json:"totalBytes"`
	CreatedAt  int64  `json:"createdAt"`
}

// Message is one relayed signaling message. Payload is opaque JSON — whatever object the
// WebRTC API on either end produced (an RTCSessionDescription, an RTCIceCandidate, ...) —
// passed through unexamined; Kind is a label the clients agree on for their own dispatch.
type Message struct {
	From    string          `json:"from"`
	Seq     int             `json:"seq"`
	Kind    string          `json:"kind"`
	Payload json.RawMessage `json:"payload"`
}

// room is the mutable state behind a RoomMeta: who owns it, its messages so far, and when it
// expires. Email is kept out of RoomMeta's JSON because it's never useful to the other side of
// a handshake — it only matters for the owner-scoped discovery query below.
type room struct {
	owner    string
	meta     RoomMeta
	messages []Message
	expires  time.Time
}

// Registry holds every open room. Every operation here is a quick map or slice touch, so a
// plain sync.Mutex is simpler than an RWMutex and no slower — RWMutex only pays for itself
// when reads hold the lock long enough for writers to actually queue up behind them.
type Registry struct {
	mu    sync.Mutex
	rooms map[string]*room
	ttl   time.Duration
}

// NewRegistry creates an empty registry. ttl is how long a room survives without activity
// before the janitor (Run) reclaims it; any Append or After call extends it, so a room stays
// alive for the duration of an active handshake and only expires once both sides go quiet.
func NewRegistry(ttl time.Duration) *Registry {
	return &Registry{rooms: map[string]*room{}, ttl: ttl}
}

// Create starts a new room owned by email and returns its public metadata, including the
// generated id the creator uses for every subsequent call.
func (r *Registry) Create(email string, meta RoomMeta) RoomMeta {
	meta.ID = uuid.NewString()
	meta.CreatedAt = time.Now().UnixMilli()

	r.mu.Lock()
	defer r.mu.Unlock()
	r.rooms[meta.ID] = &room{owner: email, meta: meta, expires: time.Now().Add(r.ttl)}
	return meta
}

// OpenRooms returns the metadata for every non-expired room owned by email, newest first. A
// device polls this (piggybacked on the existing sync tick, so no new polling loop) to
// discover a transfer another of its own devices is offering or requesting.
func (r *Registry) OpenRooms(email string) []RoomMeta {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := []RoomMeta{}
	for _, rm := range r.rooms {
		if rm.owner == email {
			out = append(out, rm.meta)
		}
	}
	return out
}

// Append adds a message to roomID and returns its assigned sequence number. Sequencing must
// happen under the same lock as the append itself — assigning it beforehand would let two
// concurrent posts race and hand out the same number.
func (r *Registry) Append(roomID, from, kind string, payload json.RawMessage) (int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	rm, ok := r.rooms[roomID]
	if !ok {
		return 0, ErrRoomNotFound
	}
	seq := len(rm.messages) + 1
	rm.messages = append(rm.messages, Message{From: from, Seq: seq, Kind: kind, Payload: payload})
	rm.expires = time.Now().Add(r.ttl)
	return seq, nil
}

// After returns roomID's messages from a device other than from with Seq > since, in order —
// "what the other side has said since I last checked." Excluding the caller's own messages
// means a device never has to filter out its own echo.
func (r *Registry) After(roomID, from string, since int) ([]Message, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	rm, ok := r.rooms[roomID]
	if !ok {
		return nil, ErrRoomNotFound
	}
	rm.expires = time.Now().Add(r.ttl)

	out := []Message{}
	for _, msg := range rm.messages {
		if msg.Seq > since && msg.From != from {
			out = append(out, msg)
		}
	}
	return out, nil
}

// Close removes a room immediately, e.g. once a transfer finishes or is abandoned.
func (r *Registry) Close(roomID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.rooms[roomID]; !ok {
		return ErrRoomNotFound
	}
	delete(r.rooms, roomID)
	return nil
}

// janitorInterval is how often Run sweeps for expired rooms. It doesn't need to track ttl
// closely — a room living a little past its TTL costs nothing but a few bytes of memory.
const janitorInterval = time.Minute

// Run sweeps expired rooms on a ticker until ctx is canceled. Call it once in a goroutine at
// startup (see cmd/kiroku-api/main.go); tying its lifetime to the server's shutdown context is
// what lets it stop cleanly instead of leaking a goroutine.
func (r *Registry) Run(ctx context.Context) {
	ticker := time.NewTicker(janitorInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			r.sweep()
		}
	}
}

func (r *Registry) sweep() {
	now := time.Now()
	r.mu.Lock()
	defer r.mu.Unlock()
	for id, rm := range r.rooms {
		if now.After(rm.expires) {
			delete(r.rooms, id)
		}
	}
}

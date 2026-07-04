// Package events is an in-memory fan-out of "your synced state changed" pokes to a user's
// connected devices, delivered over Server-Sent Events. Events deliberately carry no state —
// just which device caused the change and when — so nothing here needs durability or ordering:
// a receiver reacts by pulling /api/sync/pull, which always returns the canonical merged
// state, and the client's periodic poll remains as the safety net for anything missed.
package events

import "sync"

// Event is one poke. Origin is the client id of the device whose push changed the state, so
// that device can ignore its own echo instead of re-pulling what it just wrote.
type Event struct {
	Origin string `json:"origin"`
	At     int64  `json:"at"`
}

// Hub tracks subscribers per user email. A plain mutex-guarded map is all this needs: every
// operation is a quick map/set touch, and contention is a handful of devices per user.
type Hub struct {
	mu   sync.Mutex
	subs map[string]map[chan Event]struct{}
}

func NewHub() *Hub {
	return &Hub{subs: map[string]map[chan Event]struct{}{}}
}

// Subscribe registers a listener for a user's events. The returned cancel function must be
// called when the listener goes away (the SSE handler defers it); it is safe to call twice.
//
// The channel is buffered so Publish never waits on a listener. A subscriber that somehow
// falls 8 events behind loses the oldest pokes — harmless, because any single poke already
// means "pull now" and the pull picks up everything.
func (h *Hub) Subscribe(email string) (<-chan Event, func()) {
	ch := make(chan Event, 8)
	h.mu.Lock()
	set := h.subs[email]
	if set == nil {
		set = map[chan Event]struct{}{}
		h.subs[email] = set
	}
	set[ch] = struct{}{}
	h.mu.Unlock()

	var once sync.Once
	cancel := func() {
		once.Do(func() {
			h.mu.Lock()
			delete(h.subs[email], ch)
			if len(h.subs[email]) == 0 {
				delete(h.subs, email)
			}
			h.mu.Unlock()
		})
	}
	return ch, cancel
}

// Publish delivers e to every subscriber of email without ever blocking: a full subscriber
// buffer drops the poke (select with default) rather than stalling the sync push that
// triggered it. Slow consumers are the poll fallback's problem, not the publisher's.
func (h *Hub) Publish(email string, e Event) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for ch := range h.subs[email] {
		select {
		case ch <- e:
		default:
		}
	}
}

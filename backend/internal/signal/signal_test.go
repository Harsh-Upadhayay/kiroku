package signal

import (
	"context"
	"encoding/json"
	"testing"
	"time"
)

func TestCreateAndOpenRooms(t *testing.T) {
	reg := NewRegistry(time.Minute)
	meta := reg.Create("user@example.com", RoomMeta{Mode: ModePush, DeckName: "N5 Kanji", MediaCount: 3, TotalBytes: 1024})

	if meta.ID == "" {
		t.Fatal("Create did not assign an id")
	}
	if meta.CreatedAt == 0 {
		t.Fatal("Create did not stamp CreatedAt")
	}

	open := reg.OpenRooms("user@example.com")
	if len(open) != 1 || open[0].ID != meta.ID {
		t.Fatalf("OpenRooms = %+v, want the just-created room", open)
	}

	// A different user's rooms must never be visible — signaling rooms are scoped per
	// account, not shared across users.
	if got := reg.OpenRooms("someone-else@example.com"); len(got) != 0 {
		t.Fatalf("OpenRooms leaked another user's room: %+v", got)
	}
}

func TestAppendAssignsMonotonicSeqAndAfterExcludesOwnMessages(t *testing.T) {
	reg := NewRegistry(time.Minute)
	room := reg.Create("user@example.com", RoomMeta{Mode: ModePull})

	seq1, err := reg.Append(room.ID, "device-a", "offer", json.RawMessage(`{"sdp":"a"}`))
	if err != nil || seq1 != 1 {
		t.Fatalf("first Append: seq=%d err=%v, want 1, nil", seq1, err)
	}
	seq2, err := reg.Append(room.ID, "device-b", "answer", json.RawMessage(`{"sdp":"b"}`))
	if err != nil || seq2 != 2 {
		t.Fatalf("second Append: seq=%d err=%v, want 2, nil", seq2, err)
	}

	// device-b asks "what's new since 0" and must see only device-a's message, never its own.
	fromB, err := reg.After(room.ID, "device-b", 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(fromB) != 1 || fromB[0].From != "device-a" || fromB[0].Kind != "offer" {
		t.Fatalf("After(device-b, 0) = %+v, want device-a's offer only", fromB)
	}

	// device-a asks "what's new since 0" and must see only device-b's message.
	fromA, err := reg.After(room.ID, "device-a", 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(fromA) != 1 || fromA[0].From != "device-b" {
		t.Fatalf("After(device-a, 0) = %+v, want device-b's answer only", fromA)
	}

	// Polling again with since=2 (the last seq already seen) must return nothing new.
	again, err := reg.After(room.ID, "device-b", 2)
	if err != nil {
		t.Fatal(err)
	}
	if len(again) != 0 {
		t.Fatalf("After with since=latest = %+v, want empty", again)
	}
}

func TestAppendAndAfterReturnErrRoomNotFound(t *testing.T) {
	reg := NewRegistry(time.Minute)
	if _, err := reg.Append("no-such-room", "device-a", "offer", nil); err != ErrRoomNotFound {
		t.Fatalf("Append on unknown room: err = %v, want ErrRoomNotFound", err)
	}
	if _, err := reg.After("no-such-room", "device-a", 0); err != ErrRoomNotFound {
		t.Fatalf("After on unknown room: err = %v, want ErrRoomNotFound", err)
	}
}

func TestCloseRemovesRoom(t *testing.T) {
	reg := NewRegistry(time.Minute)
	room := reg.Create("user@example.com", RoomMeta{Mode: ModePush})

	if err := reg.Close(room.ID); err != nil {
		t.Fatalf("Close: %v", err)
	}
	if err := reg.Close(room.ID); err != ErrRoomNotFound {
		t.Fatalf("Close on already-closed room: err = %v, want ErrRoomNotFound", err)
	}
	if open := reg.OpenRooms("user@example.com"); len(open) != 0 {
		t.Fatalf("closed room still visible: %+v", open)
	}
}

func TestRunReclaimsExpiredRooms(t *testing.T) {
	// A TTL shorter than the janitor's own sweep granularity would never get exercised in a
	// fast test, so signal_test.go can't use janitorInterval directly — instead this calls
	// the unexported sweep helper straight, on a registry whose rooms are already past their
	// (very short) TTL. That's the same effect as waiting for Run's ticker, without the wait.
	reg := NewRegistry(time.Millisecond)
	room := reg.Create("user@example.com", RoomMeta{Mode: ModePush})
	time.Sleep(5 * time.Millisecond)

	reg.sweep()

	if open := reg.OpenRooms("user@example.com"); len(open) != 0 {
		t.Fatalf("expired room survived a sweep: %+v", open)
	}
	if _, err := reg.After(room.ID, "device-a", 0); err != ErrRoomNotFound {
		t.Fatalf("expired room still readable: err = %v, want ErrRoomNotFound", err)
	}
}

func TestActivityExtendsExpiry(t *testing.T) {
	reg := NewRegistry(20 * time.Millisecond)
	room := reg.Create("user@example.com", RoomMeta{Mode: ModePush})

	// Keep the room alive with activity for longer than its TTL would allow if expiry were
	// fixed at creation time — proving Append/After refresh it.
	deadline := time.Now().Add(60 * time.Millisecond)
	for time.Now().Before(deadline) {
		if _, err := reg.Append(room.ID, "device-a", "ice", nil); err != nil {
			t.Fatalf("Append on room that should still be alive: %v", err)
		}
		time.Sleep(5 * time.Millisecond)
	}

	// Now let it actually go idle past its TTL and confirm it does eventually expire.
	time.Sleep(30 * time.Millisecond)
	reg.sweep()
	if open := reg.OpenRooms("user@example.com"); len(open) != 0 {
		t.Fatalf("idle room past TTL survived a sweep: %+v", open)
	}
}

func TestRunStopsOnContextCancel(t *testing.T) {
	reg := NewRegistry(time.Minute)
	ctx, cancel := context.WithCancel(context.Background())

	done := make(chan struct{})
	go func() {
		reg.Run(ctx)
		close(done)
	}()

	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("Run did not return after context cancellation")
	}
}

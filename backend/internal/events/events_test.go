package events

import "testing"

func TestPublishReachesEverySubscriber(t *testing.T) {
	hub := NewHub()
	ch1, cancel1 := hub.Subscribe("user@example.com")
	ch2, cancel2 := hub.Subscribe("user@example.com")
	other, cancelOther := hub.Subscribe("someone-else@example.com")
	defer cancel1()
	defer cancel2()
	defer cancelOther()

	hub.Publish("user@example.com", Event{Origin: "device-a", At: 42})

	for i, ch := range []<-chan Event{ch1, ch2} {
		select {
		case e := <-ch:
			if e.Origin != "device-a" || e.At != 42 {
				t.Fatalf("subscriber %d got %+v", i, e)
			}
		default:
			t.Fatalf("subscriber %d received nothing", i)
		}
	}
	select {
	case e := <-other:
		t.Fatalf("other user's subscriber received %+v", e)
	default:
	}
}

func TestPublishNeverBlocksOnFullSubscriber(t *testing.T) {
	hub := NewHub()
	_, cancel := hub.Subscribe("user@example.com")
	defer cancel()

	// The subscriber never drains; publishing must stay non-blocking well past the channel
	// buffer. A blocking Publish would hang this test (caught by the test timeout).
	for i := 0; i < 100; i++ {
		hub.Publish("user@example.com", Event{Origin: "device-a", At: int64(i)})
	}
}

func TestCancelRemovesSubscriberAndIsIdempotent(t *testing.T) {
	hub := NewHub()
	ch, cancel := hub.Subscribe("user@example.com")
	cancel()
	cancel() // second call must be a no-op, not a panic or double-delete of a new subscriber

	hub.Publish("user@example.com", Event{Origin: "device-a", At: 1})
	select {
	case e := <-ch:
		t.Fatalf("canceled subscriber received %+v", e)
	default:
	}

	// The user's empty subscriber set must be pruned so idle users don't accumulate.
	hub.mu.Lock()
	defer hub.mu.Unlock()
	if _, ok := hub.subs["user@example.com"]; ok {
		t.Fatal("empty subscriber set was not pruned")
	}
}

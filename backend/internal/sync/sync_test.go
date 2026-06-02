package sync

import (
	"encoding/json"
	"kiroku-api/internal/models"
	"testing"
)

func TestMergeState(t *testing.T) {
	existing := models.SyncState{
		SRSCards: []models.SRSCard{
			{Char: "A", Box: 1, UpdatedAt: 100},
			{Char: "B", Box: 2, UpdatedAt: 100},
		},
		AnkiDecks: []models.AnkiDeck{
			{ID: "d1", Name: "Deck 1", UpdatedAt: 100},
		},
	}
	incoming := models.SyncState{
		SRSCards: []models.SRSCard{
			{Char: "A", Box: 5, UpdatedAt: 200}, // Newer
			{Char: "B", Box: 1, UpdatedAt: 50},  // Older
		},
		AnkiDecks: []models.AnkiDeck{
			{ID: "d2", Name: "Deck 2", UpdatedAt: 200},
		},
	}

	existingRaw, _ := json.Marshal(existing)
	incomingRaw, _ := json.Marshal(incoming)

	mergedRaw, err := MergeState(existingRaw, incomingRaw)
	if err != nil {
		t.Fatalf("MergeState failed: %v", err)
	}

	var merged models.SyncState
	json.Unmarshal(mergedRaw, &merged)

	// Check SRS Cards
	foundA := false
	foundB := false
	for _, c := range merged.SRSCards {
		if c.Char == "A" {
			foundA = true
			if c.Box != 5 {
				t.Errorf("Expected A Box 5, got %f", c.Box)
			}
		}
		if c.Char == "B" {
			foundB = true
			if c.Box != 2 {
				t.Errorf("Expected B Box 2, got %f", c.Box)
			}
		}
	}
	if !foundA || !foundB {
		t.Error("Missing cards A or B in merged result")
	}

	// Check Anki Decks
	if len(merged.AnkiDecks) != 2 {
		t.Errorf("Expected 2 decks, got %d", len(merged.AnkiDecks))
	}
}

func TestIsDestructive(t *testing.T) {
	existing := models.SyncState{
		AnkiDecks: []models.AnkiDeck{{ID: "d1"}},
	}
	existingRaw, _ := json.Marshal(existing)

	emptyIncoming := models.SyncState{}

	if !IsDestructive(existingRaw, emptyIncoming) {
		t.Error("Expected empty sync to be destructive when existing state is substantial")
	}

	substantialIncoming := models.SyncState{
		AnkiDecks: []models.AnkiDeck{{ID: "d2"}},
	}
	if IsDestructive(existingRaw, substantialIncoming) {
		t.Error("Expected substantial sync to NOT be destructive")
	}
}

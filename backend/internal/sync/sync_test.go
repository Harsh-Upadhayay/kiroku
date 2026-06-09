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
		AnkiV3Collection: map[string]any{
			"id": "existing",
		},
	}
	incoming := models.SyncState{
		Meta: models.Meta{GeneratedAt: 200},
		SRSCards: []models.SRSCard{
			{Char: "A", Box: 5, UpdatedAt: 200}, // Newer
			{Char: "B", Box: 1, UpdatedAt: 50},  // Older
		},
		AnkiV3Collection: map[string]any{
			"id": "incoming",
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

	if merged.AnkiV3Collection["id"] != "incoming" {
		t.Errorf("Expected newer v3 collection to win, got %v", merged.AnkiV3Collection["id"])
	}
}

func TestIsDestructive(t *testing.T) {
	existing := models.SyncState{
		AnkiV3Collection: map[string]any{"id": "collection"},
	}
	existingRaw, _ := json.Marshal(existing)

	emptyIncoming := models.SyncState{}

	if !IsDestructive(existingRaw, emptyIncoming) {
		t.Error("Expected empty sync to be destructive when existing state is substantial")
	}

	substantialIncoming := models.SyncState{
		AnkiV3Collection: map[string]any{"id": "collection-2"},
	}
	if IsDestructive(existingRaw, substantialIncoming) {
		t.Error("Expected substantial sync to NOT be destructive")
	}
}

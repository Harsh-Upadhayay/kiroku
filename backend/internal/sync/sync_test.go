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

func TestMergeStateN5CourseProgress(t *testing.T) {
	existing := models.SyncState{
		Meta: models.Meta{SchemaVersion: 3, GeneratedAt: 100},
		N5CourseProgress: map[string]any{
			"unlockedDay":     float64(3),
			"completedDays":   []any{float64(1), float64(2)},
			"learnedVocabIds": []any{"001"},
			"dayStates": map[string]any{
				"2": map[string]any{"stage": "produce", "updatedAt": float64(200)},
			},
			"productionAnswers": map[string]any{
				"2": map[string]any{
					"produce-0": map[string]any{"text": "私は学生です。これは本です。", "updatedAt": float64(200)},
				},
			},
			"dueCountTrend": []any{
				map[string]any{"date": "2026-06-09", "dueCount": float64(5), "updatedAt": float64(100)},
			},
			"streak":    map[string]any{"current": float64(2), "highest": float64(5), "updatedAt": float64(200)},
			"updatedAt": float64(200),
		},
	}
	incoming := models.SyncState{
		Meta: models.Meta{SchemaVersion: 4, GeneratedAt: 300},
		N5CourseProgress: map[string]any{
			"unlockedDay":     float64(4),
			"completedDays":   []any{float64(2), float64(3)},
			"learnedVocabIds": []any{"002"},
			"dayStates": map[string]any{
				"2": map[string]any{"stage": "done", "updatedAt": float64(100)},
				"3": map[string]any{"stage": "grammar", "updatedAt": float64(300)},
			},
			"productionAnswers": map[string]any{
				"2": map[string]any{
					"produce-0": map[string]any{"text": "", "updatedAt": float64(300)},
					"produce-1": map[string]any{"text": "長い答えです。もう一つ書きます。", "updatedAt": float64(300)},
				},
			},
			"dueCountTrend": []any{
				map[string]any{"date": "2026-06-09", "dueCount": float64(7), "updatedAt": float64(300)},
			},
			"streak":    map[string]any{"current": float64(1), "highest": float64(4), "updatedAt": float64(300)},
			"updatedAt": float64(300),
		},
	}

	merged := mergeForTest(t, existing, incoming)
	if merged.Meta.SchemaVersion != 4 {
		t.Fatalf("expected schema v4, got %v", merged.Meta.SchemaVersion)
	}
	progress := merged.N5CourseProgress
	if progress["unlockedDay"].(float64) != 4 {
		t.Fatalf("expected unlockedDay 4, got %v", progress["unlockedDay"])
	}
	if len(progress["completedDays"].([]any)) != 3 {
		t.Fatalf("expected completed day union, got %#v", progress["completedDays"])
	}
	dayStates := progress["dayStates"].(map[string]any)
	if dayStates["2"].(map[string]any)["stage"] != "produce" {
		t.Fatalf("older incoming day state should not win: %#v", dayStates["2"])
	}
	if dayStates["3"].(map[string]any)["stage"] != "grammar" {
		t.Fatalf("new incoming day state missing: %#v", dayStates["3"])
	}
	answers := progress["productionAnswers"].(map[string]any)["2"].(map[string]any)
	if answers["produce-0"].(map[string]any)["text"] == "" {
		t.Fatal("empty incoming production answer should not delete existing text")
	}
	if answers["produce-1"].(map[string]any)["text"] == "" {
		t.Fatal("new non-empty production answer should be kept")
	}
	streak := progress["streak"].(map[string]any)
	if streak["highest"].(float64) != 5 || streak["current"].(float64) != 1 {
		t.Fatalf("unexpected streak merge: %#v", streak)
	}
}

func TestMergeN5CourseProgressGrammarIds(t *testing.T) {
	existing := models.SyncState{
		N5CourseProgress: map[string]any{
			"learnedGrammarIds": []any{"G01", "G02"},
			"updatedAt":         float64(100),
		},
	}
	incoming := models.SyncState{
		N5CourseProgress: map[string]any{
			"learnedGrammarIds": []any{"G02", "G03"},
			"updatedAt":         float64(200),
		},
	}
	merged := mergeForTest(t, existing, incoming)
	ids, ok := merged.N5CourseProgress["learnedGrammarIds"].([]any)
	if !ok {
		t.Fatalf("learnedGrammarIds not a slice: %#v", merged.N5CourseProgress["learnedGrammarIds"])
	}
	if len(ids) != 3 {
		t.Fatalf("expected union of 3 grammar ids, got %#v", ids)
	}
}

func TestMergeStateN5SRSCards(t *testing.T) {
	existing := models.SyncState{
		N5SRSCards: []map[string]any{
			{"id": "n5:vocab:001", "updatedAt": float64(200), "due": "existing"},
		},
	}
	incoming := models.SyncState{
		N5SRSCards: []map[string]any{
			{"id": "n5:vocab:001", "updatedAt": float64(100), "due": "incoming-old"},
			{"id": "n5:kanji:一", "updatedAt": float64(300), "due": "incoming-new"},
		},
	}

	merged := mergeForTest(t, existing, incoming)
	if len(merged.N5SRSCards) != 2 {
		t.Fatalf("expected two merged n5 cards, got %#v", merged.N5SRSCards)
	}
	for _, card := range merged.N5SRSCards {
		if card["id"] == "n5:vocab:001" && card["due"] != "existing" {
			t.Fatalf("older incoming n5 card overwrote newer existing: %#v", card)
		}
	}
}

func TestIsDestructiveConsidersN5State(t *testing.T) {
	existing := models.SyncState{
		N5CourseProgress: map[string]any{"unlockedDay": float64(5)},
		N5SRSCards: []map[string]any{
			{"id": "n5:vocab:001", "updatedAt": float64(100)},
		},
	}
	existingRaw, _ := json.Marshal(existing)

	if !IsDestructive(existingRaw, models.SyncState{}) {
		t.Fatal("expected empty incoming state to be destructive when n5 state exists")
	}
	if IsDestructive(existingRaw, models.SyncState{N5SRSCards: []map[string]any{{"id": "n5:vocab:001"}}}) {
		t.Fatal("expected incoming n5 state to not be destructive")
	}
}

// Regression: previously panicked with "assignment to entry in nil map" when
// server-side productionAnswers was empty and incoming had entries for a day
// that didn't exist on the server.
func TestMergeProductionAnswersIntoEmptyExisting(t *testing.T) {
	existing := models.SyncState{
		N5CourseProgress: map[string]any{
			"updatedAt":         float64(100),
			"productionAnswers": map[string]any{},
		},
	}
	incoming := models.SyncState{
		N5CourseProgress: map[string]any{
			"updatedAt": float64(200),
			"productionAnswers": map[string]any{
				"1": map[string]any{
					"produce-0": map[string]any{"text": "私は学生です。", "updatedAt": float64(200)},
				},
			},
		},
	}
	// Should not panic
	merged := mergeForTest(t, existing, incoming)
	answers, ok := merged.N5CourseProgress["productionAnswers"].(map[string]any)
	if !ok {
		t.Fatalf("expected productionAnswers map, got %T", merged.N5CourseProgress["productionAnswers"])
	}
	day1, ok := answers["1"].(map[string]any)
	if !ok || day1["produce-0"] == nil {
		t.Fatalf("expected merged day-1 production answer, got %#v", answers)
	}
}

func TestMergeProductionAnswersNilExisting(t *testing.T) {
	existing := models.SyncState{
		N5CourseProgress: map[string]any{
			"updatedAt": float64(100),
			// productionAnswers key entirely absent
		},
	}
	incoming := models.SyncState{
		N5CourseProgress: map[string]any{
			"updatedAt": float64(200),
			"productionAnswers": map[string]any{
				"1": map[string]any{
					"produce-0": map[string]any{"text": "テスト", "updatedAt": float64(200)},
				},
			},
		},
	}
	merged := mergeForTest(t, existing, incoming)
	answers, ok := merged.N5CourseProgress["productionAnswers"].(map[string]any)
	if !ok {
		t.Fatalf("expected productionAnswers map, got %T", merged.N5CourseProgress["productionAnswers"])
	}
	if len(answers) == 0 {
		t.Fatal("expected day-1 answer to be merged in")
	}
}

func TestMergeDayStatesIntoNilExisting(t *testing.T) {
	existing := models.SyncState{
		N5CourseProgress: map[string]any{
			"updatedAt": float64(100),
			// dayStates absent
		},
	}
	incoming := models.SyncState{
		N5CourseProgress: map[string]any{
			"updatedAt": float64(200),
			"dayStates": map[string]any{
				"1": map[string]any{"stage": "vocab", "updatedAt": float64(200)},
			},
		},
	}
	merged := mergeForTest(t, existing, incoming)
	ds, ok := merged.N5CourseProgress["dayStates"].(map[string]any)
	if !ok || ds["1"] == nil {
		t.Fatalf("expected dayStates to be merged in, got %#v", merged.N5CourseProgress["dayStates"])
	}
}

func mergeForTest(t *testing.T, existing, incoming models.SyncState) models.SyncState {
	t.Helper()
	existingRaw, _ := json.Marshal(existing)
	incomingRaw, _ := json.Marshal(incoming)
	mergedRaw, err := MergeState(existingRaw, incomingRaw)
	if err != nil {
		t.Fatalf("MergeState failed: %v", err)
	}
	var merged models.SyncState
	if err := json.Unmarshal(mergedRaw, &merged); err != nil {
		t.Fatalf("failed to unmarshal merged state: %v", err)
	}
	return merged
}

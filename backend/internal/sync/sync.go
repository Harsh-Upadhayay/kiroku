package sync

import (
	"encoding/json"
	"kiroku-api/internal/models"
	"math"
	"time"
)

func MergeState(existingRaw, incomingRaw []byte) ([]byte, error) {
	var existing models.SyncState
	var incoming models.SyncState

	if err := json.Unmarshal(existingRaw, &existing); err != nil {
		return nil, err
	}
	if err := json.Unmarshal(incomingRaw, &incoming); err != nil {
		return nil, err
	}

	result := models.SyncState{}

	// Merge Meta
	result.Meta = mergeMeta(existing.Meta, incoming.Meta)

	// Merge Active Rows
	result.ActiveRows, result.ActiveRowsInfo = mergeActiveRows(existing, incoming)

	// Merge Streak Info
	result.StreakInfo = mergeStreak(existing.StreakInfo, incoming.StreakInfo)

	// Merge Deleted Decks
	result.DeletedDeckIDs = unionStrings(existing.DeletedDeckIDs, incoming.DeletedDeckIDs)
	deletedDeckSet := makeSet(result.DeletedDeckIDs)

	// Merge SRS Cards
	result.SRSCards = mergeSRSCards(existing.SRSCards, incoming.SRSCards)

	// Merge Anki Decks
	result.AnkiDecks = mergeAnkiDecks(existing.AnkiDecks, incoming.AnkiDecks, deletedDeckSet)

	// Merge Anki Cards
	result.AnkiCards = mergeAnkiCards(existing.AnkiCards, incoming.AnkiCards, deletedDeckSet)

	return json.Marshal(result)
}

func mergeMeta(existing, incoming models.Meta) models.Meta {
	return models.Meta{
		SchemaVersion: math.Max(existing.SchemaVersion, incoming.SchemaVersion),
		GeneratedAt:   math.Max(existing.GeneratedAt, incoming.GeneratedAt),
		MergedAt:      time.Now().UnixMilli(),
	}
}

func mergeActiveRows(existing, incoming models.SyncState) ([]string, map[string]any) {
	existingUpdatedAt := getUpdatedAt(existing.ActiveRowsInfo)
	incomingUpdatedAt := getUpdatedAt(incoming.ActiveRowsInfo)

	if incomingUpdatedAt > existingUpdatedAt {
		return incoming.ActiveRows, incoming.ActiveRowsInfo
	}
	return existing.ActiveRows, existing.ActiveRowsInfo
}

func mergeStreak(existing, incoming models.StreakInfo) models.StreakInfo {
	if incoming.UpdatedAt >= existing.UpdatedAt {
		return incoming
	}
	return existing
}

func mergeSRSCards(existing, incoming []models.SRSCard) []models.SRSCard {
	merged := make(map[string]models.SRSCard)
	for _, c := range existing {
		merged[c.Char] = c
	}
	for _, c := range incoming {
		if ex, ok := merged[c.Char]; ok {
			if c.UpdatedAt >= ex.UpdatedAt {
				merged[c.Char] = c
			}
		} else {
			merged[c.Char] = c
		}
	}
	out := make([]models.SRSCard, 0, len(merged))
	for _, c := range merged {
		out = append(out, c)
	}
	return out
}

func mergeAnkiDecks(existing, incoming []models.AnkiDeck, deletedSet map[string]bool) []models.AnkiDeck {
	merged := make(map[string]models.AnkiDeck)
	for _, d := range existing {
		if !deletedSet[d.ID] {
			merged[d.ID] = d
		}
	}
	for _, d := range incoming {
		if !deletedSet[d.ID] {
			if ex, ok := merged[d.ID]; ok {
				if d.UpdatedAt >= ex.UpdatedAt {
					merged[d.ID] = d
				}
			} else {
				merged[d.ID] = d
			}
		}
	}
	out := make([]models.AnkiDeck, 0, len(merged))
	for _, d := range merged {
		out = append(out, d)
	}
	return out
}

func mergeAnkiCards(existing, incoming []models.AnkiCard, deletedSet map[string]bool) []models.AnkiCard {
	merged := make(map[string]models.AnkiCard)
	for _, c := range existing {
		if !deletedSet[c.ID] && !deletedSet[c.DeckID] {
			merged[c.ID] = c
		}
	}
	for _, c := range incoming {
		if !deletedSet[c.ID] && !deletedSet[c.DeckID] {
			if ex, ok := merged[c.ID]; ok {
				if c.UpdatedAt >= ex.UpdatedAt {
					merged[c.ID] = c
				}
			} else {
				merged[c.ID] = c
			}
		}
	}
	out := make([]models.AnkiCard, 0, len(merged))
	for _, c := range merged {
		out = append(out, c)
	}
	return out
}

func getUpdatedAt(info map[string]any) float64 {
	if info == nil {
		return 0
	}
	if v, ok := info["updatedAt"].(float64); ok {
		return v
	}
	return 0
}

func unionStrings(a, b []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, value := range append(a, b...) {
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		out = append(out, value)
	}
	return out
}

func makeSet(items []string) map[string]bool {
	out := map[string]bool{}
	for _, item := range items {
		out[item] = true
	}
	return out
}

func IsDestructive(existingRaw []byte, incoming models.SyncState) bool {
	var existing models.SyncState
	if err := json.Unmarshal(existingRaw, &existing); err != nil {
		return false
	}

	existingSubstantial := len(existing.AnkiDecks) > 0 || len(existing.AnkiCards) > 0 || len(existing.SRSCards) > 0
	incomingEmpty := len(incoming.AnkiDecks) == 0 && len(incoming.AnkiCards) == 0 && len(incoming.SRSCards) == 0

	return existingSubstantial && incomingEmpty
}

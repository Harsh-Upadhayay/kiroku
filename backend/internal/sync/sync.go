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

	// Merge SRS Cards
	result.SRSCards = mergeSRSCards(existing.SRSCards, incoming.SRSCards)

	result.AnkiV3Collection = mergeAnkiV3Collection(existing, incoming)

	// An explicit course reset (resetAt) is authoritative: without this the
	// union-style merge would resurrect wiped progress from the other side.
	incomingReset := getNumber(incoming.N5CourseProgress, "resetAt")
	existingReset := getNumber(existing.N5CourseProgress, "resetAt")
	switch {
	case incomingReset > 0 && incomingReset >= getNumber(existing.N5CourseProgress, "updatedAt"):
		result.N5CourseProgress = cloneMap(incoming.N5CourseProgress)
		result.N5SRSCards = cloneMapSlice(incoming.N5SRSCards)
	case existingReset > 0 && existingReset > getNumber(incoming.N5CourseProgress, "updatedAt"):
		result.N5CourseProgress = cloneMap(existing.N5CourseProgress)
		result.N5SRSCards = cloneMapSlice(existing.N5SRSCards)
	default:
		result.N5CourseProgress = mergeN5CourseProgress(existing.N5CourseProgress, incoming.N5CourseProgress)
		result.N5SRSCards = mergeN5SRSCards(existing.N5SRSCards, incoming.N5SRSCards)
	}

	return json.Marshal(result)
}

func cloneMapSlice(input []map[string]any) []map[string]any {
	out := make([]map[string]any, 0, len(input))
	for _, item := range input {
		out = append(out, cloneMap(item))
	}
	return out
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

func mergeAnkiV3Collection(existing, incoming models.SyncState) map[string]any {
	if len(incoming.AnkiV3Collection) == 0 {
		return existing.AnkiV3Collection
	}
	if len(existing.AnkiV3Collection) == 0 {
		return incoming.AnkiV3Collection
	}
	if incoming.Meta.GeneratedAt >= existing.Meta.GeneratedAt {
		return incoming.AnkiV3Collection
	}
	return existing.AnkiV3Collection
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

func mergeN5SRSCards(existing, incoming []map[string]any) []map[string]any {
	merged := map[string]map[string]any{}
	for _, card := range existing {
		id := getString(card, "id")
		if id == "" {
			continue
		}
		merged[id] = cloneMap(card)
	}
	for _, card := range incoming {
		id := getString(card, "id")
		if id == "" {
			continue
		}
		if existingCard, ok := merged[id]; ok {
			if getNumber(card, "updatedAt") >= getNumber(existingCard, "updatedAt") {
				merged[id] = cloneMap(card)
			}
		} else {
			merged[id] = cloneMap(card)
		}
	}

	out := make([]map[string]any, 0, len(merged))
	for _, card := range merged {
		out = append(out, card)
	}
	return out
}

func mergeN5CourseProgress(existing, incoming map[string]any) map[string]any {
	if len(incoming) == 0 {
		return cloneMap(existing)
	}
	if len(existing) == 0 {
		return cloneMap(incoming)
	}

	result := cloneMap(existing)
	if getNumber(incoming, "updatedAt") >= getNumber(existing, "updatedAt") {
		copyScalar(result, incoming, "contentVersion")
		copyScalar(result, incoming, "contentHash")
		copyScalar(result, incoming, "currentDay")
		copyScalar(result, incoming, "clientId")
		copyScalar(result, incoming, "resetAt")
		result["updatedAt"] = math.Max(getNumber(existing, "updatedAt"), getNumber(incoming, "updatedAt"))
	}

	result["unlockedDay"] = math.Max(getNumber(existing, "unlockedDay"), getNumber(incoming, "unlockedDay"))
	result["completedDays"] = unionNumberValues(getSlice(existing, "completedDays"), getSlice(incoming, "completedDays"))
	result["learnedVocabIds"] = unionStringValues(getSlice(existing, "learnedVocabIds"), getSlice(incoming, "learnedVocabIds"))
	result["learnedKanjiIds"] = unionStringValues(getSlice(existing, "learnedKanjiIds"), getSlice(incoming, "learnedKanjiIds"))
	result["dayStates"] = mergeObjectMapByUpdatedAt(getMap(existing, "dayStates"), getMap(incoming, "dayStates"))
	result["checkpointReports"] = mergeObjectMapByUpdatedAt(getMap(existing, "checkpointReports"), getMap(incoming, "checkpointReports"))
	result["productionAnswers"] = mergeProductionAnswers(getMap(existing, "productionAnswers"), getMap(incoming, "productionAnswers"))
	result["dueCountTrend"] = mergeDueTrend(getSlice(existing, "dueCountTrend"), getSlice(incoming, "dueCountTrend"))
	result["streak"] = mergeN5Streak(getMap(existing, "streak"), getMap(incoming, "streak"))

	return result
}

func mergeObjectMapByUpdatedAt(existing, incoming map[string]any) map[string]any {
	result := cloneMap(existing)
	for key, incomingValue := range incoming {
		incomingMap, ok := incomingValue.(map[string]any)
		if !ok {
			result[key] = incomingValue
			continue
		}
		existingMap, _ := result[key].(map[string]any)
		if getNumber(incomingMap, "updatedAt") >= getNumber(existingMap, "updatedAt") {
			result[key] = cloneMap(incomingMap)
		}
	}
	return result
}

func mergeProductionAnswers(existing, incoming map[string]any) map[string]any {
	result := cloneMap(existing)
	for day, incomingValue := range incoming {
		incomingPrompts, ok := incomingValue.(map[string]any)
		if !ok {
			continue
		}
		existingPrompts, _ := result[day].(map[string]any)
		mergedPrompts := cloneMap(existingPrompts)
		for promptID, incomingAnswer := range incomingPrompts {
			incomingMap, ok := incomingAnswer.(map[string]any)
			if !ok {
				continue
			}
			existingMap, _ := mergedPrompts[promptID].(map[string]any)
			mergedPrompts[promptID] = chooseProductionAnswer(existingMap, incomingMap)
		}
		result[day] = mergedPrompts
	}
	return result
}

func chooseProductionAnswer(existing, incoming map[string]any) map[string]any {
	existingText := getString(existing, "text")
	incomingText := getString(incoming, "text")
	switch {
	case existingText == "" && incomingText != "":
		return cloneMap(incoming)
	case existingText != "" && incomingText == "":
		return cloneMap(existing)
	case len([]rune(incomingText)) > len([]rune(existingText)):
		return cloneMap(incoming)
	case len([]rune(existingText)) > len([]rune(incomingText)):
		return cloneMap(existing)
	case getNumber(incoming, "updatedAt") >= getNumber(existing, "updatedAt"):
		return cloneMap(incoming)
	default:
		return cloneMap(existing)
	}
}

func mergeDueTrend(existing, incoming []any) []any {
	byDate := map[string]map[string]any{}
	for _, value := range existing {
		point, ok := value.(map[string]any)
		if !ok {
			continue
		}
		date := getString(point, "date")
		if date != "" {
			byDate[date] = cloneMap(point)
		}
	}
	for _, value := range incoming {
		point, ok := value.(map[string]any)
		if !ok {
			continue
		}
		date := getString(point, "date")
		if date == "" {
			continue
		}
		if existingPoint, ok := byDate[date]; !ok || getNumber(point, "updatedAt") >= getNumber(existingPoint, "updatedAt") {
			byDate[date] = cloneMap(point)
		}
	}
	out := make([]any, 0, len(byDate))
	for _, point := range byDate {
		out = append(out, point)
	}
	return out
}

func mergeN5Streak(existing, incoming map[string]any) map[string]any {
	result := cloneMap(existing)
	if len(result) == 0 {
		result = map[string]any{}
	}
	result["highest"] = math.Max(getNumber(existing, "highest"), getNumber(incoming, "highest"))
	if getNumber(incoming, "updatedAt") >= getNumber(existing, "updatedAt") {
		copyScalar(result, incoming, "current")
		copyScalar(result, incoming, "lastCompletedDate")
		copyScalar(result, incoming, "updatedAt")
	}
	return result
}

func unionStringValues(a, b []any) []any {
	seen := map[string]bool{}
	out := []any{}
	for _, value := range append(a, b...) {
		text, ok := value.(string)
		if !ok || text == "" || seen[text] {
			continue
		}
		seen[text] = true
		out = append(out, text)
	}
	return out
}

func unionNumberValues(a, b []any) []any {
	seen := map[float64]bool{}
	out := []any{}
	for _, value := range append(a, b...) {
		number, ok := asNumber(value)
		if !ok || seen[number] {
			continue
		}
		seen[number] = true
		out = append(out, number)
	}
	return out
}

func getMap(source map[string]any, key string) map[string]any {
	if source == nil {
		return nil
	}
	if value, ok := source[key].(map[string]any); ok {
		return value
	}
	return nil
}

func getSlice(source map[string]any, key string) []any {
	if source == nil {
		return nil
	}
	if value, ok := source[key].([]any); ok {
		return value
	}
	return nil
}

func getString(source map[string]any, key string) string {
	if source == nil {
		return ""
	}
	if value, ok := source[key].(string); ok {
		return value
	}
	return ""
}

func getNumber(source map[string]any, key string) float64 {
	if source == nil {
		return 0
	}
	value, ok := asNumber(source[key])
	if !ok {
		return 0
	}
	return value
}

func asNumber(value any) (float64, bool) {
	switch typed := value.(type) {
	case float64:
		return typed, true
	case int:
		return float64(typed), true
	case int64:
		return float64(typed), true
	default:
		return 0, false
	}
}

func copyScalar(target, source map[string]any, key string) {
	if source == nil {
		return
	}
	if value, ok := source[key]; ok {
		target[key] = value
	}
}

func cloneMap(input map[string]any) map[string]any {
	if input == nil {
		return nil
	}
	out := make(map[string]any, len(input))
	for key, value := range input {
		out[key] = value
	}
	return out
}

func IsDestructive(existingRaw []byte, incoming models.SyncState) bool {
	var existing models.SyncState
	if err := json.Unmarshal(existingRaw, &existing); err != nil {
		return false
	}

	existingSubstantial := len(existing.SRSCards) > 0 || len(existing.AnkiV3Collection) > 0 || len(existing.N5CourseProgress) > 0 || len(existing.N5SRSCards) > 0
	incomingEmpty := len(incoming.SRSCards) == 0 && len(incoming.AnkiV3Collection) == 0 && len(incoming.N5CourseProgress) == 0 && len(incoming.N5SRSCards) == 0

	return existingSubstantial && incomingEmpty
}

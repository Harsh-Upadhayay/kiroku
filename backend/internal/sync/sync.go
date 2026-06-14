// Package sync merges two snapshots of a user's study state into one. It is the conflict
// resolution layer for cross-device sync.
//
// There is no single merge rule — each field has its own strategy:
//   - newest-timestamp-wins (most fields, keyed on an "updatedAt"): mergeStreak, mergeSRSCards
//   - set-union (ids/days that only ever accumulate): unionStrings, unionNumberValues
//   - max (monotonic counters like unlockedDay / streak highest): math.Max
//   - bespoke (e.g. production answers prefer the longer text): chooseProductionAnswer
//
// An explicit course reset (a "resetAt" timestamp) overrides the per-field merge so a wipe
// on one device isn't resurrected from the other. See MergeState for the top-level flow and
// keys.go for the field-name constants.
package sync

import (
	"encoding/json"
	"kiroku-api/internal/models"
	"math"
	"time"
)

// MergeState merges the incoming state JSON into the existing state JSON and returns the
// combined result. Both inputs are raw JSON of a models.SyncState.
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
	incomingReset := getNumber(incoming.N5CourseProgress, keyResetAt)
	existingReset := getNumber(existing.N5CourseProgress, keyResetAt)
	switch {
	case incomingReset > 0 && incomingReset >= getNumber(existing.N5CourseProgress, keyUpdatedAt):
		result.N5CourseProgress = cloneMap(incoming.N5CourseProgress)
		result.N5SRSCards = cloneMapSlice(incoming.N5SRSCards)
	case existingReset > 0 && existingReset > getNumber(incoming.N5CourseProgress, keyUpdatedAt):
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

// mergeByUpdatedAt merges two slices of items that are each uniquely identified by a
// string key and versioned by an "updated at" timestamp. Existing items seed the result;
// each incoming item then wins only if its timestamp is newer-or-equal to the item it
// collides with (so ties favor the incoming side). When skipEmptyKey is true, items whose
// key is "" are dropped. clone is applied to every retained item — pass an identity
// function for value types, or cloneMap for reference types that must not be aliased.
//
// This one generic replaces the near-identical kana-SRS and N5-SRS merge loops.
func mergeByUpdatedAt[T any](existing, incoming []T, key func(T) string, updatedAt func(T) float64, clone func(T) T, skipEmptyKey bool) []T {
	merged := make(map[string]T, len(existing)+len(incoming))
	for _, item := range existing {
		k := key(item)
		if skipEmptyKey && k == "" {
			continue
		}
		merged[k] = clone(item)
	}
	for _, item := range incoming {
		k := key(item)
		if skipEmptyKey && k == "" {
			continue
		}
		if current, ok := merged[k]; ok && updatedAt(item) < updatedAt(current) {
			continue
		}
		merged[k] = clone(item)
	}
	out := make([]T, 0, len(merged))
	for _, item := range merged {
		out = append(out, item)
	}
	return out
}

// mergeSRSCards merges kana SRS cards keyed by their character. Cards are value types, so
// the clone step is just identity.
func mergeSRSCards(existing, incoming []models.SRSCard) []models.SRSCard {
	return mergeByUpdatedAt(existing, incoming,
		func(c models.SRSCard) string { return c.Char },
		func(c models.SRSCard) float64 { return c.UpdatedAt },
		func(c models.SRSCard) models.SRSCard { return c },
		false,
	)
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
	if v, ok := info[keyUpdatedAt].(float64); ok {
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

// mergeN5SRSCards merges N5 SRS cards keyed by their "id". Cards are maps, so each retained
// card is cloned to avoid aliasing the input slices. Cards without an id are dropped.
func mergeN5SRSCards(existing, incoming []map[string]any) []map[string]any {
	return mergeByUpdatedAt(existing, incoming,
		func(c map[string]any) string { return getString(c, keyID) },
		func(c map[string]any) float64 { return getNumber(c, keyUpdatedAt) },
		cloneMap,
		true,
	)
}

func mergeN5CourseProgress(existing, incoming map[string]any) map[string]any {
	if len(incoming) == 0 {
		return cloneMap(existing)
	}
	if len(existing) == 0 {
		return cloneMap(incoming)
	}

	result := cloneMap(existing)
	// Scalar metadata follows whichever side was updated most recently.
	if getNumber(incoming, keyUpdatedAt) >= getNumber(existing, keyUpdatedAt) {
		copyScalar(result, incoming, keyContentVersion)
		copyScalar(result, incoming, keyContentHash)
		copyScalar(result, incoming, keyCurrentDay)
		copyScalar(result, incoming, keyClientID)
		copyScalar(result, incoming, keyResetAt)
		result[keyUpdatedAt] = math.Max(getNumber(existing, keyUpdatedAt), getNumber(incoming, keyUpdatedAt))
	}

	// Progress collections accumulate across devices, so they use max / set-union /
	// per-entry timestamp merges rather than a single winner.
	result[keyUnlockedDay] = math.Max(getNumber(existing, keyUnlockedDay), getNumber(incoming, keyUnlockedDay))
	result[keyCompletedDays] = unionNumberValues(getSlice(existing, keyCompletedDays), getSlice(incoming, keyCompletedDays))
	result[keyLearnedVocabIDs] = unionStringValues(getSlice(existing, keyLearnedVocabIDs), getSlice(incoming, keyLearnedVocabIDs))
	result[keyLearnedKanjiIDs] = unionStringValues(getSlice(existing, keyLearnedKanjiIDs), getSlice(incoming, keyLearnedKanjiIDs))
	result[keyLearnedGrammarIDs] = unionStringValues(getSlice(existing, keyLearnedGrammarIDs), getSlice(incoming, keyLearnedGrammarIDs))
	result[keyDayStates] = mergeObjectMapByUpdatedAt(getMap(existing, keyDayStates), getMap(incoming, keyDayStates))
	result[keyCheckpointReports] = mergeObjectMapByUpdatedAt(getMap(existing, keyCheckpointReports), getMap(incoming, keyCheckpointReports))
	result[keyProductionAnswers] = mergeProductionAnswers(getMap(existing, keyProductionAnswers), getMap(incoming, keyProductionAnswers))
	result[keyDueCountTrend] = mergeDueTrend(getSlice(existing, keyDueCountTrend), getSlice(incoming, keyDueCountTrend))
	result[keyStreak] = mergeN5Streak(getMap(existing, keyStreak), getMap(incoming, keyStreak))

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
		if getNumber(incomingMap, keyUpdatedAt) >= getNumber(existingMap, keyUpdatedAt) {
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
	existingText := getString(existing, keyText)
	incomingText := getString(incoming, keyText)
	switch {
	case existingText == "" && incomingText != "":
		return cloneMap(incoming)
	case existingText != "" && incomingText == "":
		return cloneMap(existing)
	case len([]rune(incomingText)) > len([]rune(existingText)):
		return cloneMap(incoming)
	case len([]rune(existingText)) > len([]rune(incomingText)):
		return cloneMap(existing)
	case getNumber(incoming, keyUpdatedAt) >= getNumber(existing, keyUpdatedAt):
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
		date := getString(point, keyDate)
		if date != "" {
			byDate[date] = cloneMap(point)
		}
	}
	for _, value := range incoming {
		point, ok := value.(map[string]any)
		if !ok {
			continue
		}
		date := getString(point, keyDate)
		if date == "" {
			continue
		}
		if existingPoint, ok := byDate[date]; !ok || getNumber(point, keyUpdatedAt) >= getNumber(existingPoint, keyUpdatedAt) {
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
	result[keyHighest] = math.Max(getNumber(existing, keyHighest), getNumber(incoming, keyHighest))
	if getNumber(incoming, keyUpdatedAt) >= getNumber(existing, keyUpdatedAt) {
		copyScalar(result, incoming, keyCurrent)
		copyScalar(result, incoming, keyLastCompletedDate)
		copyScalar(result, incoming, keyUpdatedAt)
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
	out := make(map[string]any, len(input))
	for key, value := range input {
		out[key] = value
	}
	return out
}

// IsDestructive reports whether accepting incoming would wipe meaningful data the server
// already has. It guards against an empty push (e.g. a fresh device that hasn't loaded data
// yet) clobbering the user's kana SRS cards or Anki collection. N5 progress is deliberately
// not guarded here — its own resetAt + per-field merge handles an empty push safely.
func IsDestructive(existingRaw []byte, incoming models.SyncState) bool {
	var existing models.SyncState
	if err := json.Unmarshal(existingRaw, &existing); err != nil {
		return false
	}

	// Only guard kana SRS cards and Anki data — N5 progress has its own merge
	// logic (resetAt + per-field merging) that safely handles an empty incoming
	// push (e.g. first login on a new device before N5 data is uploaded).
	existingSubstantial := len(existing.SRSCards) > 0 || len(existing.AnkiV3Collection) > 0
	incomingEmpty := len(incoming.SRSCards) == 0 && len(incoming.AnkiV3Collection) == 0

	return existingSubstantial && incomingEmpty
}

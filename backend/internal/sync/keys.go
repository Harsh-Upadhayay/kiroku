package sync

// State JSON field names.
//
// The N5 course progress and SRS data are merged as loosely-typed maps
// (map[string]any), so individual fields are accessed by string key. Collecting those
// keys here as named constants keeps the merge code readable and makes a typo a compile
// error instead of a silently-skipped field.
const (
	// Common bookkeeping fields present on most merge-able objects.
	keyUpdatedAt = "updatedAt"
	keyResetAt   = "resetAt"

	// N5 course progress top-level fields.
	keyContentVersion    = "contentVersion"
	keyContentHash       = "contentHash"
	keyCurrentDay        = "currentDay"
	keyClientID          = "clientId"
	keyUnlockedDay       = "unlockedDay"
	keyCompletedDays     = "completedDays"
	keyLearnedVocabIDs   = "learnedVocabIds"
	keyLearnedKanjiIDs   = "learnedKanjiIds"
	keyLearnedGrammarIDs = "learnedGrammarIds"
	keyDayStates         = "dayStates"
	keyCheckpointReports = "checkpointReports"
	keyProductionAnswers = "productionAnswers"
	keyDueCountTrend     = "dueCountTrend"
	keyStreak            = "streak"

	// N5 streak sub-object fields.
	keyHighest           = "highest"
	keyCurrent           = "current"
	keyLastCompletedDate = "lastCompletedDate"

	// Item-identity fields used when merging collections of objects.
	keyID   = "id"
	keyText = "text"
	keyDate = "date"
)

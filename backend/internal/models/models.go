// Package models holds the data structures shared across the API: request/response bodies
// and the user "sync state". The JSON tags here define the wire contract with the frontend,
// so treat renames as breaking changes.
package models

// User is the full user record as stored. PasswordHash is never sent to clients; use
// UserResponse for responses.
type User struct {
	Email        string `json:"email"`
	PasswordHash string `json:"passwordHash"`
	Joined       int64  `json:"joined"`
}

// UserResponse is the public view of a user (no password hash).
type UserResponse struct {
	Email  string `json:"email"`
	Joined int64  `json:"joined"`
}

// APIResponse is the envelope every JSON endpoint returns. On success Data carries the
// payload; on failure Error carries a human-readable message.
type APIResponse struct {
	Success bool   `json:"success"`
	Error   string `json:"error,omitempty"`
	Data    any    `json:"data,omitempty"`
}

// SyncState is the per-user study state synchronized across devices. The strongly-typed
// fields (kana SRS, streak) are merged field-by-field; the map[string]any fields
// (Anki/N5 progress) are open-ended blobs the frontend owns and the server merges
// generically. See package sync for the merge rules.
type SyncState struct {
	Meta           Meta           `json:"_meta"`
	ActiveRows     []string       `json:"active_rows"`
	ActiveRowsInfo map[string]any `json:"active_rows_info"`
	StreakInfo     StreakInfo     `json:"streak_info"`
	SRSCards       []SRSCard      `json:"srs_cards_list"`
	DeletedDeckIDs []string       `json:"deleted_deck_ids"`
	// AnkiV3Collection holds collection metadata (decks, note types, media manifest, …). Since
	// the delta-sync change the big arrays live in the per-record lists below; older clients
	// still send them inside this blob and the merge seeds the lists from it (see package sync).
	AnkiV3Collection map[string]any `json:"anki_v3_collection,omitempty"`
	// Per-record Anki data, merged individually so a client pushes only what changed. Cards and
	// notes are keyed by "id" and versioned by "updatedAt" (newest wins); review logs are
	// immutable and unioned by "id". DeletedCardIDs are tombstones that suppress resurrection.
	AnkiCardsList    []map[string]any `json:"anki_cards_list,omitempty"`
	AnkiNotesList    []map[string]any `json:"anki_notes_list,omitempty"`
	AnkiRevlogsList  []map[string]any `json:"anki_revlogs_list,omitempty"`
	DeletedCardIDs   []string         `json:"deleted_card_ids,omitempty"`
	N5CourseProgress map[string]any   `json:"n5_course_progress,omitempty"`
	N5SRSCards       []map[string]any `json:"n5_srs_cards,omitempty"`
	LookupDeck       []map[string]any `json:"lookup_deck,omitempty"`
	VocabWords       []map[string]any `json:"vocab_words,omitempty"`
	VocabSheets      []map[string]any `json:"vocab_sheets,omitempty"` // legacy — read-only for migration
}

type Meta struct {
	SchemaVersion float64 `json:"schemaVersion"`
	GeneratedAt   float64 `json:"generatedAt"`
	MergedAt      int64   `json:"mergedAt,omitempty"`
	// ClientID identifies the device that produced this state. It is read from incoming
	// pushes to tag the change-notification event with its origin (see handlers.SyncPush);
	// the merge deliberately does not carry it into the stored state.
	ClientID string `json:"clientId,omitempty"`
}

type StreakInfo struct {
	Current   float64 `json:"current"`
	Highest   float64 `json:"highest"`
	UpdatedAt float64 `json:"updatedAt"`
}

type SRSCard struct {
	Char       string  `json:"char"`
	Box        float64 `json:"box"`
	Streak     float64 `json:"streak"`
	NextReview float64 `json:"nextReview"`
	UpdatedAt  float64 `json:"updatedAt"`
	// Allow other fields for flexibility
	Other map[string]any `json:"-"`
}

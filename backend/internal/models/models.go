package models

type User struct {
	Email        string `json:"email"`
	PasswordHash string `json:"passwordHash"`
	Joined       int64  `json:"joined"`
}

type UserResponse struct {
	Email  string `json:"email"`
	Joined int64  `json:"joined"`
}

type APIResponse struct {
	Success bool   `json:"success"`
	Error   string `json:"error,omitempty"`
	Data    any    `json:"data,omitempty"`
}

type SyncState struct {
	Meta             Meta           `json:"_meta"`
	ActiveRows       []string       `json:"active_rows"`
	ActiveRowsInfo   map[string]any `json:"active_rows_info"`
	StreakInfo       StreakInfo     `json:"streak_info"`
	SRSCards         []SRSCard      `json:"srs_cards_list"`
	DeletedDeckIDs   []string       `json:"deleted_deck_ids"`
	AnkiV3Collection map[string]any `json:"anki_v3_collection,omitempty"`
}

type Meta struct {
	SchemaVersion float64 `json:"schemaVersion"`
	GeneratedAt   float64 `json:"generatedAt"`
	MergedAt      int64   `json:"mergedAt,omitempty"`
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

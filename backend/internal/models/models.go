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
	Meta           Meta             `json:"_meta"`
	ActiveRows     []string         `json:"active_rows"`
	ActiveRowsInfo map[string]any   `json:"active_rows_info"`
	StreakInfo     StreakInfo       `json:"streak_info"`
	SRSCards       []SRSCard        `json:"srs_cards_list"`
	DeletedDeckIDs []string         `json:"deleted_deck_ids"`
	AnkiDecks      []AnkiDeck       `json:"anki_decks"`
	AnkiCards      []AnkiCard       `json:"anki_cards"`
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

type AnkiDeck struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	UpdatedAt float64 `json:"updatedAt,omitempty"`
}

type AnkiCard struct {
	ID                 string   `json:"id"`
	DeckID             string   `json:"deckId"`
	Front              string   `json:"front"`
	Back               string   `json:"back"`
	Reps               float64  `json:"reps"`
	Lapses             float64  `json:"lapses"`
	LastReviewed       float64  `json:"lastReviewed"`
	TotalAnswerSeconds float64  `json:"totalAnswerSeconds"`
	UpdatedAt          float64  `json:"updatedAt"`
	Tags               []string `json:"tags,omitempty"`
	// Other fields from import
	NoteID      string         `json:"noteId,omitempty"`
	ModelName   string         `json:"modelName,omitempty"`
	FieldOrder  []string       `json:"fieldOrder,omitempty"`
	Fields      map[string]string `json:"fields,omitempty"`
	Mnemonic    *string        `json:"mnemonic,omitempty"`
	StrokeInfo  *string        `json:"strokeInfo,omitempty"`
	StrokeCount any            `json:"strokeCount,omitempty"`
}

// Package anki parses Anki ".apkg" study packages into a structured, JSON-friendly
// representation the rest of the app can consume.
//
// An .apkg file is just a ZIP archive that contains a SQLite database (the
// "collection") plus a "media" manifest and the referenced media blobs. The import
// pipeline lives across a few files, each with a single responsibility:
//
//   - import.go     – the public entry points (ImportPackage/ImportPackageFile) and orchestration.
//   - collection.go – locating/decompressing the SQLite DB and reading deck/model metadata.
//   - queries.go    – reading the notes/cards/revlog tables out of that SQLite DB.
//   - media.go      – hashing media blobs and the in-memory media cache.
//   - template.go   – rendering Anki's mustache-like card templates to plain text.
//   - coerce.go     – small helpers for pulling typed values out of decoded JSON.
//
// types.go (this file) holds the data model returned to callers. The JSON tags are
// part of the API contract, so don't rename them without updating clients.
package anki

// ImportResult is the top-level value returned by an import. ImportID identifies the
// import for subsequent media lookups (see ImportedMedia).
type ImportResult struct {
	ImportID      string       `json:"importId"`
	Collection    Collection   `json:"collection"`
	MediaManifest []MediaRef   `json:"mediaManifest"`
	Report        ImportReport `json:"report"`
}

// Collection is the fully parsed contents of one .apkg file.
type Collection struct {
	ID          string       `json:"id"`
	Name        string       `json:"name"`
	CreatedAt   int64        `json:"createdAt"`
	Decks       []Deck       `json:"decks"`
	DeckConfigs []DeckConfig `json:"deckConfigs"`
	NoteTypes   []NoteType   `json:"noteTypes"`
	Notes       []Note       `json:"notes"`
	Cards       []Card       `json:"cards"`
	ReviewLogs  []ReviewLog  `json:"reviewLogs"`
}

type Deck struct {
	ID          string         `json:"id"`
	Name        string         `json:"name"`
	ParentID    string         `json:"parentId,omitempty"`
	ConfigID    string         `json:"configId,omitempty"`
	Description string         `json:"description,omitempty"`
	Dynamic     bool           `json:"dynamic"`
	Mod         int64          `json:"mod,omitempty"`
	USN         int64          `json:"usn,omitempty"`
	Raw         map[string]any `json:"raw,omitempty"`
}

type DeckConfig struct {
	ID   string         `json:"id"`
	Name string         `json:"name"`
	Raw  map[string]any `json:"raw"`
}

// NoteType (Anki calls it a "model") describes the fields and card templates a Note uses.
type NoteType struct {
	ID        string         `json:"id"`
	Name      string         `json:"name"`
	Type      int64          `json:"type"`
	CSS       string         `json:"css"`
	LatexPre  string         `json:"latexPre,omitempty"`
	LatexPost string         `json:"latexPost,omitempty"`
	Fields    []Field        `json:"fields"`
	Templates []Template     `json:"templates"`
	Raw       map[string]any `json:"raw,omitempty"`
}

type Field struct {
	Name        string `json:"name"`
	Ord         int64  `json:"ord"`
	Sticky      bool   `json:"sticky,omitempty"`
	RTL         bool   `json:"rtl,omitempty"`
	Font        string `json:"font,omitempty"`
	Size        int64  `json:"size,omitempty"`
	Description string `json:"description,omitempty"`
}

type Template struct {
	Name   string `json:"name"`
	Ord    int64  `json:"ord"`
	QFmt   string `json:"qfmt"`
	AFmt   string `json:"afmt"`
	DeckID string `json:"deckId,omitempty"`
}

type Note struct {
	ID         string            `json:"id"`
	GUID       string            `json:"guid"`
	NoteTypeID string            `json:"noteTypeId"`
	SortField  string            `json:"sortField,omitempty"`
	Tags       []string          `json:"tags"`
	Fields     map[string]string `json:"fields"`
	FieldOrder []string          `json:"fieldOrder"`
	RawFields  []string          `json:"rawFields"`
	Mod        int64             `json:"mod,omitempty"`
	USN        int64             `json:"usn,omitempty"`
}

type Card struct {
	ID             string         `json:"id"`
	NoteID         string         `json:"noteId"`
	DeckID         string         `json:"deckId"`
	Ord            int64          `json:"ord"`
	Type           int64          `json:"type"`
	Queue          int64          `json:"queue"`
	Due            int64          `json:"due"`
	Interval       int64          `json:"interval"`
	Factor         int64          `json:"factor"`
	Reps           int64          `json:"reps"`
	Lapses         int64          `json:"lapses"`
	Left           int64          `json:"left,omitempty"`
	OriginalDeckID string         `json:"originalDeckId,omitempty"`
	Flags          int64          `json:"flags,omitempty"`
	Data           string         `json:"data,omitempty"`
	TemplateName   string         `json:"templateName,omitempty"`
	Front          string         `json:"front"`
	Back           string         `json:"back"`
	Raw            map[string]any `json:"raw,omitempty"`
}

type ReviewLog struct {
	ID       string `json:"id"`
	CardID   string `json:"cardId"`
	USN      int64  `json:"usn"`
	Ease     int64  `json:"ease"`
	Interval int64  `json:"interval"`
	LastIvl  int64  `json:"lastInterval"`
	Factor   int64  `json:"factor"`
	Time     int64  `json:"time"`
	Type     int64  `json:"type"`
}

type MediaRef struct {
	Hash        string `json:"hash"`
	FileName    string `json:"fileName"`
	EntryName   string `json:"entryName"`
	ContentType string `json:"contentType"`
	Bytes       int64  `json:"bytes"`
}

// ImportReport summarizes what was imported and surfaces any non-fatal warnings.
type ImportReport struct {
	PackageKind string   `json:"packageKind"`
	Warnings    []string `json:"warnings"`
	Decks       int      `json:"decks"`
	DeckConfigs int      `json:"deckConfigs"`
	NoteTypes   int      `json:"noteTypes"`
	Notes       int      `json:"notes"`
	Cards       int      `json:"cards"`
	ReviewLogs  int      `json:"reviewLogs"`
	MediaFiles  int      `json:"mediaFiles"`
	Unsupported []string `json:"unsupported,omitempty"`
}

// cachedMedia is one decoded media blob held in the in-memory import cache (see media.go).
type cachedMedia struct {
	fileName    string
	contentType string
	bytes       []byte
}

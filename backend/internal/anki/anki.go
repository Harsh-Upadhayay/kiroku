package anki

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"html"
	"io"
	"mime"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/klauspost/compress/zstd"
	_ "modernc.org/sqlite"
)

type ImportResult struct {
	ImportID      string       `json:"importId"`
	Collection    Collection   `json:"collection"`
	MediaManifest []MediaRef   `json:"mediaManifest"`
	Report        ImportReport `json:"report"`
}

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

type cachedMedia struct {
	fileName    string
	contentType string
	bytes       []byte
}

var importMediaCache = struct {
	sync.RWMutex
	items map[string]map[string]cachedMedia
}{items: map[string]map[string]cachedMedia{}}

func ImportedMedia(importID, hash string) (string, string, []byte, bool) {
	importMediaCache.RLock()
	defer importMediaCache.RUnlock()
	byHash := importMediaCache.items[importID]
	item, ok := byHash[hash]
	return item.fileName, item.contentType, item.bytes, ok
}

func ImportAPKG(r io.Reader, size int64) (*ImportResult, error) {
	raw, err := io.ReadAll(r)
	if err != nil {
		return nil, err
	}
	return ImportPackage(raw, "apkg")
}

func ImportPackage(raw []byte, packageKind string) (*ImportResult, error) {
	reader, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		return nil, err
	}

	collection, collectionKind, err := readCollection(reader)
	if err != nil {
		return nil, err
	}

	temp, err := os.CreateTemp("", "kiroku-anki-*.sqlite")
	if err != nil {
		return nil, err
	}
	tempPath := temp.Name()
	defer os.Remove(tempPath)
	if _, err = temp.Write(collection); err != nil {
		temp.Close()
		return nil, err
	}
	temp.Close()

	apkgDB, err := sql.Open("sqlite", tempPath)
	if err != nil {
		return nil, err
	}
	defer apkgDB.Close()

	importID := uuid.NewString()
	warnings := []string{}
	decks, deckConfigs, noteTypes, warnings := readMetadata(apkgDB, warnings)
	notes, noteByID, err := readNotes(apkgDB, noteTypes)
	if err != nil {
		return nil, err
	}
	cards, err := readCards(apkgDB, decks, noteTypes, noteByID)
	if err != nil {
		return nil, err
	}
	reviewLogs, err := readReviewLogs(apkgDB)
	if err != nil {
		warnings = append(warnings, "review log import failed: "+err.Error())
	}
	mediaManifest, mediaCache, mediaWarnings := readMedia(reader)
	warnings = append(warnings, mediaWarnings...)
	cacheImportedMedia(importID, mediaCache)

	collectionName := packageKind
	if len(decks) > 0 {
		collectionName = decks[0].Name
	}
	coll := Collection{
		ID:          "collection-" + importID,
		Name:        collectionName,
		CreatedAt:   time.Now().UnixMilli(),
		Decks:       decks,
		DeckConfigs: deckConfigs,
		NoteTypes:   noteTypes,
		Notes:       notes,
		Cards:       cards,
		ReviewLogs:  reviewLogs,
	}

	report := ImportReport{
		PackageKind: packageKind + "/" + collectionKind,
		Warnings:    warnings,
		Decks:       len(decks),
		DeckConfigs: len(deckConfigs),
		NoteTypes:   len(noteTypes),
		Notes:       len(notes),
		Cards:       len(cards),
		ReviewLogs:  len(reviewLogs),
		MediaFiles:  len(mediaManifest),
	}

	return &ImportResult{
		ImportID:      importID,
		Collection:    coll,
		MediaManifest: mediaManifest,
		Report:        report,
	}, nil
}

func readCollection(zipReader *zip.Reader) ([]byte, string, error) {
	for _, candidate := range []struct {
		name       string
		compressed bool
	}{
		{"collection.anki21b", true},
		{"collection.anki2b", true},
		{"collection.anki21", false},
		{"collection.anki2", false},
	} {
		raw, err := readZipFile(zipReader, []string{candidate.name})
		if err != nil {
			continue
		}
		if !candidate.compressed {
			return raw, candidate.name, nil
		}
		decoder, err := zstd.NewReader(bytes.NewReader(raw))
		if err != nil {
			return nil, candidate.name, err
		}
		defer decoder.Close()
		decoded, err := io.ReadAll(decoder)
		if err != nil {
			return nil, candidate.name, err
		}
		return decoded, candidate.name, nil
	}
	return nil, "", os.ErrNotExist
}

func readMetadata(db *sql.DB, warnings []string) ([]Deck, []DeckConfig, []NoteType, []string) {
	var decksRaw, deckConfigsRaw, modelsRaw string
	row := db.QueryRow(`SELECT decks, dconf, models FROM col LIMIT 1`)
	if err := row.Scan(&decksRaw, &deckConfigsRaw, &modelsRaw); err != nil {
		warnings = append(warnings, "collection metadata unavailable: "+err.Error())
		return nil, nil, nil, warnings
	}

	decks := readDecks(decksRaw)
	deckConfigs := readDeckConfigs(deckConfigsRaw)
	noteTypes := readNoteTypes(modelsRaw)
	sort.Slice(decks, func(i, j int) bool { return decks[i].Name < decks[j].Name })
	sort.Slice(noteTypes, func(i, j int) bool { return noteTypes[i].Name < noteTypes[j].Name })
	return decks, deckConfigs, noteTypes, warnings
}

func readDecks(raw string) []Deck {
	var payload map[string]map[string]any
	if json.Unmarshal([]byte(raw), &payload) != nil {
		return nil
	}
	out := make([]Deck, 0, len(payload))
	for id, deckRaw := range payload {
		name := stringValue(deckRaw["name"])
		parentID := ""
		if strings.Contains(name, "::") {
			parentName := name[:strings.LastIndex(name, "::")]
			for otherID, other := range payload {
				if stringValue(other["name"]) == parentName {
					parentID = otherID
					break
				}
			}
		}
		out = append(out, Deck{
			ID:          id,
			Name:        fallback(name, "Imported Deck"),
			ParentID:    parentID,
			ConfigID:    numberString(deckRaw["conf"]),
			Description: stringValue(deckRaw["desc"]),
			Dynamic:     intValue(deckRaw["dyn"]) != 0,
			Mod:         intValue(deckRaw["mod"]),
			USN:         intValue(deckRaw["usn"]),
			Raw:         deckRaw,
		})
	}
	return out
}

func readDeckConfigs(raw string) []DeckConfig {
	var payload map[string]map[string]any
	if json.Unmarshal([]byte(raw), &payload) != nil {
		return nil
	}
	out := make([]DeckConfig, 0, len(payload))
	for id, cfg := range payload {
		out = append(out, DeckConfig{ID: id, Name: fallback(stringValue(cfg["name"]), "Default"), Raw: cfg})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

func readNoteTypes(raw string) []NoteType {
	var payload map[string]map[string]any
	if json.Unmarshal([]byte(raw), &payload) != nil {
		return nil
	}
	out := make([]NoteType, 0, len(payload))
	for id, model := range payload {
		fields := []Field{}
		if rawFields, ok := model["flds"].([]any); ok {
			for i, item := range rawFields {
				fieldRaw, _ := item.(map[string]any)
				fields = append(fields, Field{
					Name:        fallback(stringValue(fieldRaw["name"]), fmt.Sprintf("Field %d", i+1)),
					Ord:         coalesceInt(fieldRaw["ord"], int64(i)),
					Sticky:      boolValue(fieldRaw["sticky"]),
					RTL:         boolValue(fieldRaw["rtl"]),
					Font:        stringValue(fieldRaw["font"]),
					Size:        intValue(fieldRaw["size"]),
					Description: stringValue(fieldRaw["description"]),
				})
			}
		}
		templates := []Template{}
		if rawTemplates, ok := model["tmpls"].([]any); ok {
			for i, item := range rawTemplates {
				templateRaw, _ := item.(map[string]any)
				templates = append(templates, Template{
					Name:   fallback(stringValue(templateRaw["name"]), fmt.Sprintf("Card %d", i+1)),
					Ord:    coalesceInt(templateRaw["ord"], int64(i)),
					QFmt:   stringValue(templateRaw["qfmt"]),
					AFmt:   stringValue(templateRaw["afmt"]),
					DeckID: numberString(templateRaw["did"]),
				})
			}
		}
		out = append(out, NoteType{
			ID:        id,
			Name:      fallback(stringValue(model["name"]), "Imported Note"),
			Type:      intValue(model["type"]),
			CSS:       stringValue(model["css"]),
			LatexPre:  stringValue(model["latexPre"]),
			LatexPost: stringValue(model["latexPost"]),
			Fields:    fields,
			Templates: templates,
			Raw:       model,
		})
	}
	return out
}

func readNotes(db *sql.DB, noteTypes []NoteType) ([]Note, map[string]Note, error) {
	modelByID := map[string]NoteType{}
	for _, model := range noteTypes {
		modelByID[model.ID] = model
	}
	rows, err := db.Query(`SELECT id, guid, mid, mod, usn, tags, flds, sfld FROM notes`)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()

	notes := []Note{}
	byID := map[string]Note{}
	for rows.Next() {
		var id, guid, mid, tags, flds, sfld string
		var mod, usn int64
		if err := rows.Scan(&id, &guid, &mid, &mod, &usn, &tags, &flds, &sfld); err != nil {
			return nil, nil, err
		}
		rawFields := strings.Split(flds, "\x1f")
		model := modelByID[mid]
		fieldOrder := make([]string, 0, len(rawFields))
		fields := map[string]string{}
		for i, value := range rawFields {
			name := fmt.Sprintf("Field %d", i+1)
			if i < len(model.Fields) {
				name = model.Fields[i].Name
			}
			fieldOrder = append(fieldOrder, name)
			fields[name] = value
		}
		note := Note{
			ID:         id,
			GUID:       guid,
			NoteTypeID: mid,
			SortField:  sfld,
			Tags:       splitTags(tags),
			Fields:     fields,
			FieldOrder: fieldOrder,
			RawFields:  rawFields,
			Mod:        mod,
			USN:        usn,
		}
		notes = append(notes, note)
		byID[id] = note
	}
	return notes, byID, rows.Err()
}

func readCards(db *sql.DB, decks []Deck, noteTypes []NoteType, notes map[string]Note) ([]Card, error) {
	modelByID := map[string]NoteType{}
	for _, model := range noteTypes {
		modelByID[model.ID] = model
	}
	rows, err := db.Query(`SELECT id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, left, odid, flags, data FROM cards`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	cards := []Card{}
	for rows.Next() {
		var id, nid, did, data string
		var ord, mod, usn, typ, queue, due, ivl, factor, reps, lapses, left, odid, flags int64
		if err := rows.Scan(&id, &nid, &did, &ord, &mod, &usn, &typ, &queue, &due, &ivl, &factor, &reps, &lapses, &left, &odid, &flags, &data); err != nil {
			return nil, err
		}
		note := notes[nid]
		model := modelByID[note.NoteTypeID]
		templateName := ""
		if ord >= 0 && int(ord) < len(model.Templates) {
			templateName = model.Templates[ord].Name
		}
		front, back := previewFrontBack(note, model, ord)
		cards = append(cards, Card{
			ID:             id,
			NoteID:         nid,
			DeckID:         did,
			Ord:            ord,
			Type:           typ,
			Queue:          queue,
			Due:            due,
			Interval:       ivl,
			Factor:         factor,
			Reps:           reps,
			Lapses:         lapses,
			Left:           left,
			OriginalDeckID: zeroEmpty(odid),
			Flags:          flags,
			Data:           data,
			TemplateName:   templateName,
			Front:          front,
			Back:           back,
			Raw: map[string]any{
				"mod": mod,
				"usn": usn,
			},
		})
	}
	return cards, rows.Err()
}

func readReviewLogs(db *sql.DB) ([]ReviewLog, error) {
	rows, err := db.Query(`SELECT id, cid, usn, ease, ivl, lastIvl, factor, time, type FROM revlog`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ReviewLog{}
	for rows.Next() {
		var id, cid string
		var usn, ease, ivl, lastIvl, factor, reviewTime, typ int64
		if err := rows.Scan(&id, &cid, &usn, &ease, &ivl, &lastIvl, &factor, &reviewTime, &typ); err != nil {
			return nil, err
		}
		out = append(out, ReviewLog{ID: id, CardID: cid, USN: usn, Ease: ease, Interval: ivl, LastIvl: lastIvl, Factor: factor, Time: reviewTime, Type: typ})
	}
	return out, rows.Err()
}

func readMedia(zipReader *zip.Reader) ([]MediaRef, map[string]cachedMedia, []string) {
	warnings := []string{}
	raw, err := readZipFile(zipReader, []string{"media"})
	if err != nil {
		return nil, nil, nil
	}
	var media map[string]string
	if err := json.Unmarshal(raw, &media); err != nil {
		warnings = append(warnings, "media map could not be parsed: "+err.Error())
		return nil, nil, warnings
	}
	manifest := []MediaRef{}
	cache := map[string]cachedMedia{}
	for entryName, fileName := range media {
		if fileName == "" {
			continue
		}
		bytes, err := readZipFile(zipReader, []string{entryName})
		if err != nil {
			warnings = append(warnings, fmt.Sprintf("media entry %s (%s) missing", entryName, fileName))
			continue
		}
		sum := sha256.Sum256(bytes)
		hash := hex.EncodeToString(sum[:])
		contentType := mimeTypeFor(fileName)
		manifest = append(manifest, MediaRef{Hash: hash, FileName: fileName, EntryName: entryName, ContentType: contentType, Bytes: int64(len(bytes))})
		cache[hash] = cachedMedia{fileName: fileName, contentType: contentType, bytes: bytes}
	}
	sort.Slice(manifest, func(i, j int) bool { return manifest[i].FileName < manifest[j].FileName })
	return manifest, cache, warnings
}

func cacheImportedMedia(importID string, media map[string]cachedMedia) {
	importMediaCache.Lock()
	defer importMediaCache.Unlock()
	importMediaCache.items[importID] = media
}

func previewFrontBack(note Note, model NoteType, ord int64) (string, string) {
	if ord >= 0 && int(ord) < len(model.Templates) {
		tmpl := model.Templates[ord]
		front := cleanHTML(renderSimpleTemplate(tmpl.QFmt, note))
		back := cleanHTML(renderSimpleTemplate(tmpl.AFmt, note))
		if front != "" && back != "" {
			return front, back
		}
	}
	plainFields := []string{}
	for _, name := range note.FieldOrder {
		plain := cleanHTML(note.Fields[name])
		if plain != "" && !regexp.MustCompile(`^\d+$`).MatchString(plain) {
			plainFields = append(plainFields, plain)
		}
	}
	return pickFrontBack(plainFields)
}

func renderSimpleTemplate(format string, note Note) string {
	positiveRe := regexp.MustCompile(`(?s)\{\{#([^}]+)\}\}(.*?)\{\{/([^}]+)\}\}`)
	negativeRe := regexp.MustCompile(`(?s)\{\{\^([^}]+)\}\}(.*?)\{\{/([^}]+)\}\}`)
	out := positiveRe.ReplaceAllStringFunc(format, func(match string) string {
		parts := positiveRe.FindStringSubmatch(match)
		if len(parts) != 4 {
			return match
		}
		if parts[1] != parts[3] {
			return match
		}
		if strings.TrimSpace(note.Fields[parts[1]]) == "" {
			return ""
		}
		return parts[2]
	})
	out = negativeRe.ReplaceAllStringFunc(out, func(match string) string {
		parts := negativeRe.FindStringSubmatch(match)
		if len(parts) != 4 {
			return match
		}
		if parts[1] != parts[3] {
			return match
		}
		if strings.TrimSpace(note.Fields[parts[1]]) != "" {
			return ""
		}
		return parts[2]
	})
	out = strings.ReplaceAll(out, "{{FrontSide}}", "")
	re := regexp.MustCompile(`\{\{(?:[^}:]+:)*([^}]+)\}\}`)
	return re.ReplaceAllStringFunc(out, func(match string) string {
		parts := re.FindStringSubmatch(match)
		if len(parts) != 2 {
			return match
		}
		return note.Fields[strings.TrimSpace(parts[1])]
	})
}

func readZipFile(zipReader *zip.Reader, names []string) ([]byte, error) {
	for _, file := range zipReader.File {
		for _, name := range names {
			if file.Name == name {
				rc, err := file.Open()
				if err != nil {
					return nil, err
				}
				defer rc.Close()
				return io.ReadAll(rc)
			}
		}
	}
	return nil, os.ErrNotExist
}

func mimeTypeFor(fileName string) string {
	ext := strings.ToLower(filepath.Ext(fileName))
	if m := mime.TypeByExtension(ext); m != "" {
		return m
	}
	switch ext {
	case ".mp3":
		return "audio/mpeg"
	case ".m4a":
		return "audio/mp4"
	case ".mp4":
		return "video/mp4"
	case ".webm":
		return "video/webm"
	}
	return "application/octet-stream"
}

func cleanHTML(input string) string {
	noSound := regexp.MustCompile(`(?i)\[sound:[^\]]+\]`).ReplaceAllString(input, "")
	noBreaks := regexp.MustCompile(`(?i)<br\s*/?>|</p>|</div>`).ReplaceAllString(noSound, "\n")
	noTags := regexp.MustCompile(`<[^>]+>`).ReplaceAllString(noBreaks, "")
	return strings.TrimSpace(html.UnescapeString(noTags))
}

func pickFrontBack(fields []string) (string, string) {
	if len(fields) == 0 {
		return "", ""
	}
	japanese := []string{}
	english := []string{}
	for _, field := range fields {
		if regexp.MustCompile(`[\x{4e00}-\x{9faf}\x{3040}-\x{309f}\x{30a0}-\x{30ff}\x{ff00}-\x{ff9f}]`).MatchString(field) {
			japanese = append(japanese, field)
		} else {
			english = append(english, field)
		}
	}
	if len(japanese) > 0 {
		back := first(english)
		if back == "" && len(japanese) > 1 {
			back = japanese[1]
		}
		if back == "" {
			back = japanese[0]
		}
		return japanese[0], back
	}
	return fields[0], secondOrFirst(fields)
}

func fallback(value, fallbackValue string) string {
	if strings.TrimSpace(value) == "" {
		return fallbackValue
	}
	return value
}

func first(values []string) string {
	if len(values) == 0 {
		return ""
	}
	return values[0]
}

func secondOrFirst(values []string) string {
	if len(values) > 1 {
		return values[1]
	}
	return first(values)
}

func splitTags(input string) []string {
	return strings.Fields(input)
}

func stringValue(value any) string {
	if value == nil {
		return ""
	}
	return fmt.Sprintf("%v", value)
}

func intValue(value any) int64 {
	switch v := value.(type) {
	case int64:
		return v
	case int:
		return int64(v)
	case float64:
		return int64(v)
	case json.Number:
		n, _ := v.Int64()
		return n
	case string:
		n, _ := strconv.ParseInt(v, 10, 64)
		return n
	default:
		return 0
	}
}

func coalesceInt(value any, fallbackValue int64) int64 {
	if value == nil {
		return fallbackValue
	}
	return intValue(value)
}

func boolValue(value any) bool {
	switch v := value.(type) {
	case bool:
		return v
	case float64:
		return v != 0
	case int64:
		return v != 0
	case string:
		return v == "true" || v == "1"
	default:
		return false
	}
}

func numberString(value any) string {
	n := intValue(value)
	if n == 0 {
		return ""
	}
	return strconv.FormatInt(n, 10)
}

func zeroEmpty(value int64) string {
	if value == 0 {
		return ""
	}
	return strconv.FormatInt(value, 10)
}

func DataURL(fileName string, bytes []byte) string {
	return fmt.Sprintf("data:%s;base64,%s", mimeTypeFor(fileName), base64.StdEncoding.EncodeToString(bytes))
}

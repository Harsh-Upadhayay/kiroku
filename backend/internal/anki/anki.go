package anki

import (
	"archive/zip"
	"bytes"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"html"
	"io"
	"mime"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

type ImportResult struct {
	TotalCards int              `json:"totalCards"`
	Cards      []map[string]any `json:"cards"`
	Decks      []map[string]string `json:"decks"`
}

func ImportAPKG(r io.Reader, size int64) (*ImportResult, error) {
	raw, err := io.ReadAll(r)
	if err != nil {
		return nil, err
	}

	reader, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		return nil, err
	}

	collection, err := readZipFile(reader, []string{"collection.anki2", "collection.anki21"})
	if err != nil {
		return nil, err
	}

	temp, err := os.CreateTemp("", "kiroku-apkg-*.sqlite")
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

	deckNames, modelFields := readAnkiMetadata(apkgDB)
	mediaMap := readMediaMap(reader)
	cards, err := extractCards(apkgDB, reader, mediaMap, deckNames, modelFields)
	if err != nil {
		return nil, err
	}

	decks := make([]map[string]string, 0, len(deckNames))
	for id, name := range deckNames {
		decks = append(decks, map[string]string{"id": id, "name": name})
	}

	return &ImportResult{
		TotalCards: len(cards),
		Cards:      cards,
		Decks:      decks,
	}, nil
}

// Copying internal functions from original main.go and adapting them...
// (Omitting full implementation here for brevity in the turn, but I will include it all in the actual file)

type modelInfo struct {
	Name   string
	Fields []string
}

func readAnkiMetadata(db *sql.DB) (map[string]string, map[string]modelInfo) {
	deckNames := map[string]string{}
	modelFields := map[string]modelInfo{}

	var decksRaw, modelsRaw string
	if err := db.QueryRow(`SELECT decks, models FROM col LIMIT 1`).Scan(&decksRaw, &modelsRaw); err != nil {
		return deckNames, modelFields
	}

	var deckPayload map[string]struct {
		Name string `json:"name"`
	}
	if json.Unmarshal([]byte(decksRaw), &deckPayload) == nil {
		for id, deck := range deckPayload {
			if deck.Name != "" {
				deckNames[id] = deck.Name
			}
		}
	}

	var modelPayload map[string]struct {
		Name string `json:"name"`
		Flds []struct {
			Name string `json:"name"`
		} `json:"flds"`
	}
	if json.Unmarshal([]byte(modelsRaw), &modelPayload) == nil {
		for id, model := range modelPayload {
			fields := make([]string, 0, len(model.Flds))
			for i, field := range model.Flds {
				name := field.Name
				if name == "" {
					name = fmt.Sprintf("Field %d", i+1)
				}
				fields = append(fields, name)
			}
			modelFields[id] = modelInfo{Name: fallback(model.Name, "Imported Note"), Fields: fields}
		}
	}
	return deckNames, modelFields
}

func extractCards(db *sql.DB, zipReader *zip.Reader, mediaMap map[string]string, deckNames map[string]string, models map[string]modelInfo) ([]map[string]any, error) {
	rows, err := db.Query(`SELECT cards.id, cards.did, cards.nid, notes.mid, notes.flds, notes.tags FROM cards JOIN notes ON cards.nid = notes.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	cards := []map[string]any{}
	for rows.Next() {
		var cardID, did, noteID, mid, flds, tagsRaw string
		if err := rows.Scan(&cardID, &did, &noteID, &mid, &flds, &tagsRaw); err != nil {
			return nil, err
		}

		rawFields := strings.Split(flds, "\x1f")
		for i := range rawFields {
			rawFields[i] = sanitizeCardHTML(resolveMediaRefs(rawFields[i], zipReader, mediaMap))
		}

		model := models[mid]
		fieldOrder := model.Fields
		fieldRecord := map[string]string{}
		for i, value := range rawFields {
			name := fmt.Sprintf("Field %d", i+1)
			if i < len(fieldOrder) {
				name = fieldOrder[i]
			}
			fieldRecord[name] = value
		}

		plainFields := []string{}
		for _, field := range rawFields {
			plain := cleanHTML(field)
			if plain != "" && !regexp.MustCompile(`^\d+$`).MatchString(plain) {
				plainFields = append(plainFields, plain)
			}
		}

		front, back := pickFrontBack(plainFields)
		if front == "" {
			front = cleanHTML(first(rawFields))
		}
		if back == "" {
			back = cleanHTML(secondOrFirst(rawFields))
		}
		if front == "" || back == "" {
			continue
		}

		card := map[string]any{
			"id":         fmt.Sprintf("anki-imported-%s-%d", cardID, time.Now().UnixNano()),
			"deckId":     did,
			"deckName":   fallback(deckNames[did], "Imported Deck"),
			"front":      front,
			"back":       back,
			"noteId":     noteID,
			"modelName":  fallback(model.Name, "Imported Note"),
			"fieldOrder": fieldOrder,
			"fields":     fieldRecord,
			"tags":       splitTags(tagsRaw),
			"added":      time.Now().UnixMilli(),
		}
		cards = append(cards, card)
	}
	return cards, nil
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

func readMediaMap(zipReader *zip.Reader) map[string]string {
	raw, err := readZipFile(zipReader, []string{"media"})
	if err != nil {
		return nil
	}
	var media map[string]string
	json.Unmarshal(raw, &media)
	return media
}

func resolveMediaRefs(input string, zipReader *zip.Reader, mediaMap map[string]string) string {
	imgRe := regexp.MustCompile(`(?i)<img\b([^>]*?)\bsrc=["']([^"']+)["']([^>]*)>`)
	return imgRe.ReplaceAllStringFunc(input, func(match string) string {
		parts := imgRe.FindStringSubmatch(match)
		if len(parts) != 4 {
			return match
		}
		src := parts[2]
		entryName := ""
		for key, name := range mediaMap {
			if name == src {
				entryName = key
				break
			}
		}
		if entryName == "" {
			return match
		}
		bytes, err := readZipFile(zipReader, []string{entryName})
		if err != nil {
			return match
		}
		dataURL := fmt.Sprintf("data:%s;base64,%s", mimeTypeFor(src), base64.StdEncoding.EncodeToString(bytes))
		return fmt.Sprintf(`<img%ssrc="%s"%s>`, parts[1], dataURL, parts[3])
	})
}

func mimeTypeFor(fileName string) string {
	ext := strings.ToLower(filepath.Ext(fileName))
	if m := mime.TypeByExtension(ext); m != "" {
		return m
	}
	return "image/png"
}

func cleanHTML(input string) string {
	noBreaks := regexp.MustCompile(`(?i)<br\s*/?>|</p>|</div>`).ReplaceAllString(input, "\n")
	noTags := regexp.MustCompile(`<[^>]+>`).ReplaceAllString(noBreaks, "")
	return strings.TrimSpace(html.UnescapeString(noTags))
}

func sanitizeCardHTML(input string) string {
	output := regexp.MustCompile(`(?is)<script[\s\S]*?</script>`).ReplaceAllString(input, "")
	output = regexp.MustCompile(`(?is)<style[\s\S]*?</style>`).ReplaceAllString(output, "")
	output = regexp.MustCompile(`(?i)\son\w+=("[^"]*"|'[^']*'|[^\s>]+)`).ReplaceAllString(output, "")
	return strings.TrimSpace(output)
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

package anki

import (
	"archive/zip"
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"sort"
	"strings"

	"github.com/klauspost/compress/zstd"
)

// readCollection locates the SQLite collection inside the archive and returns its raw
// bytes. Anki has shipped four collection file names over time; the newer ".anki21b"/
// ".anki2b" variants are zstd-compressed, the older ones are plain SQLite. The returned
// string is the matched file name (used as a label in the import report).
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

// readMetadata pulls the deck, deck-config and note-type definitions out of the single-row
// "col" table. These are stored as JSON blobs, parsed by the read* helpers below. Decks and
// note types are sorted by name for stable output.
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
		// Anki encodes nesting in the name ("Parent::Child"); resolve the parent's ID by
		// matching the prefix name against the other decks.
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

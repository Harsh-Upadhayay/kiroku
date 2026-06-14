package anki

import (
	"database/sql"
	"fmt"
	"strings"
)

// fieldSeparator is the ASCII "unit separator" byte Anki uses to join a note's field
// values into the single "flds" column.
const fieldSeparator = "\x1f"

// readNotes reads the notes table. Each note's fields arrive as one separator-joined
// string; we split it and pair each value with its field name from the note's model
// (falling back to "Field N" when the model has fewer fields than the stored note).
// It returns the notes slice plus a by-ID lookup used later when building cards.
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
		rawFields := strings.Split(flds, fieldSeparator)
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

// readCards reads the cards table and, for each card, renders a plain-text front/back
// preview from its note and template (see previewFrontBack in template.go).
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

// readReviewLogs reads the revlog table (the per-review history). It is best-effort:
// callers treat an error here as a warning rather than a failed import.
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

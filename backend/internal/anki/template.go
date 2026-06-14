package anki

import (
	"html"
	"regexp"
	"strings"
)

// Regexes are compiled once at package load rather than per call. Several of these run on
// every note/card during an import, so hoisting them out of the hot path matters.
var (
	// reConditionalSection matches Anki's "{{#Field}}...{{/Field}}" (show if non-empty).
	reConditionalSection = regexp.MustCompile(`(?s)\{\{#([^}]+)\}\}(.*?)\{\{/([^}]+)\}\}`)
	// reInvertedSection matches "{{^Field}}...{{/Field}}" (show if empty).
	reInvertedSection = regexp.MustCompile(`(?s)\{\{\^([^}]+)\}\}(.*?)\{\{/([^}]+)\}\}`)
	// reFieldRef matches a plain "{{Field}}" reference, ignoring any "filter:" prefixes.
	reFieldRef = regexp.MustCompile(`\{\{(?:[^}:]+:)*([^}]+)\}\}`)
	// reDigitsOnly detects field values that are only digits (skipped when guessing previews).
	reDigitsOnly = regexp.MustCompile(`^\d+$`)
	// reSoundTag, reBlockBreak, reHTMLTag are used by cleanHTML to strip markup.
	reSoundTag   = regexp.MustCompile(`(?i)\[sound:[^\]]+\]`)
	reBlockBreak = regexp.MustCompile(`(?i)<br\s*/?>|</p>|</div>`)
	reHTMLTag    = regexp.MustCompile(`<[^>]+>`)
	// reJapanese matches any CJK/kana/fullwidth character (used to guess the "front" field).
	reJapanese = regexp.MustCompile(`[\x{4e00}-\x{9faf}\x{3040}-\x{309f}\x{30a0}-\x{30ff}\x{ff00}-\x{ff9f}]`)
)

// previewFrontBack produces a plain-text front/back preview for a card. It first tries to
// render the note's template; if that yields nothing usable it falls back to a heuristic
// that picks two of the note's non-empty, non-numeric fields (see pickFrontBack).
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
		if plain != "" && !reDigitsOnly.MatchString(plain) {
			plainFields = append(plainFields, plain)
		}
	}
	return pickFrontBack(plainFields)
}

// renderSimpleTemplate implements the small subset of Anki's mustache-like template syntax
// the previews need: conditional sections ({{#Field}}/{{^Field}}) and field substitution
// ({{Field}}, optionally with "filter:" prefixes). {{FrontSide}} is dropped because the
// preview renders question and answer independently.
func renderSimpleTemplate(format string, note Note) string {
	out := reConditionalSection.ReplaceAllStringFunc(format, func(match string) string {
		parts := reConditionalSection.FindStringSubmatch(match)
		if len(parts) != 4 {
			return match
		}
		if parts[1] != parts[3] { // opening/closing field names must match
			return match
		}
		if strings.TrimSpace(note.Fields[parts[1]]) == "" {
			return ""
		}
		return parts[2]
	})
	out = reInvertedSection.ReplaceAllStringFunc(out, func(match string) string {
		parts := reInvertedSection.FindStringSubmatch(match)
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
	return reFieldRef.ReplaceAllStringFunc(out, func(match string) string {
		parts := reFieldRef.FindStringSubmatch(match)
		if len(parts) != 2 {
			return match
		}
		return note.Fields[strings.TrimSpace(parts[1])]
	})
}

// cleanHTML reduces an HTML field value to readable plain text: it removes [sound:...]
// tags, turns block-level breaks into newlines, strips remaining tags, and unescapes entities.
func cleanHTML(input string) string {
	noSound := reSoundTag.ReplaceAllString(input, "")
	noBreaks := reBlockBreak.ReplaceAllString(noSound, "\n")
	noTags := reHTMLTag.ReplaceAllString(noBreaks, "")
	return strings.TrimSpace(html.UnescapeString(noTags))
}

// pickFrontBack guesses which field is the prompt and which is the answer when template
// rendering fails. Anki packages don't label fields, so the heuristic assumes a Japanese
// study deck: the first field containing Japanese text becomes the front, and an English
// (non-Japanese) field becomes the back.
func pickFrontBack(fields []string) (string, string) {
	if len(fields) == 0 {
		return "", ""
	}
	japanese := []string{}
	english := []string{}
	for _, field := range fields {
		if reJapanese.MatchString(field) {
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

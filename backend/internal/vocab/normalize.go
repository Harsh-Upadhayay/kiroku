package vocab

import (
	"strings"
)

func normalizeImportedRows(rows []ImportedRow) []ImportedRow {
	out := make([]ImportedRow, 0, len(rows))
	for _, row := range rows {
		row.Section = cleanImportedText(row.Section)
		row.Word = cleanJapaneseField(row.Word)
		row.Furigana = cleanJapaneseField(row.Furigana)
		row.Romaji = cleanImportedText(row.Romaji)
		row.Meaning = cleanImportedText(row.Meaning)
		correctCommonOCRRow(&row)
		if row.Furigana == "" {
			row.Furigana = row.Word
		}
		if row.Word == "" || row.Romaji == "" || row.Meaning == "" {
			continue
		}
		row.ID = ""
		out = append(out, row)
	}
	return out
}

func cleanImportedText(text string) string {
	text = strings.TrimSpace(text)
	text = strings.Trim(text, "\ufeff")
	return strings.Join(strings.Fields(text), " ")
}

func cleanJapaneseField(text string) string {
	text = cleanImportedText(text)
	text = strings.TrimLeft(text, "*＊・• ")
	text = strings.NewReplacer(
		"~", "～",
		"〜", "～",
		"…", "...",
		" ", "",
		"\u3000", "",
	).Replace(text)
	return strings.TrimSpace(text)
}

func normalizeOCRRomaji(text string) string {
	text = cleanImportedText(text)
	text = strings.NewReplacer(
		"…", "...",
		"‥", "..",
		"・", ".",
		"．", ".",
		"⑧", "g",
		"|", "ji",
	).Replace(text)
	return expandLeadingEllipsis(text)
}

func normalizeOCRMeaning(text string) string {
	text = cleanImportedText(text)
	text = strings.NewReplacer(
		"…", "...",
		"‥", "..",
		"・", ".",
		"．", ".",
		"nurmnber", "number",
		"nurnber", "number",
		"mumber", "number",
		"Tmajor", "major",
		"orclock", "o'clock",
		"o’clock", "o'clock",
		"US.A.", "U.S.A.",
	).Replace(text)
	text = expandLeadingEllipsis(text)
	switch text {
	case "AM.":
		return "A.M."
	case "PM.":
		return "P.M."
	}
	return text
}

func expandLeadingEllipsis(text string) string {
	text = strings.TrimSpace(text)
	if text == "" {
		return ""
	}
	i := 0
	dots := 0
	for i < len(text) {
		switch text[i] {
		case '.', ' ':
			if text[i] == '.' {
				dots++
			}
			i++
		default:
			if dots >= 2 {
				return ". . . " + strings.TrimSpace(text[i:])
			}
			return text
		}
	}
	if dots >= 2 {
		return ". . ."
	}
	return text
}

func normalizeOCRLatinGlyphs(text string) string {
	return strings.NewReplacer(
		"$", "S",
		"!", "l",
		"①", "l",
		"｜", "l",
		"|", "l",
	).Replace(text)
}

func latinSectionTitle(text string) (string, bool) {
	title := collapseSpacedLetters(normalizeOCRLatinGlyphs(text))
	title = strings.TrimSpace(strings.Trim(title, "-—:：・"))
	if title == "" || hasJapanese(title) {
		return "", false
	}
	lower := strings.ToLower(strings.ReplaceAll(title, " ", ""))
	if lower == "vocabulary" || lower == "tango" {
		return "", false
	}
	known := map[string]string{
		"school": "School",
		"person": "Person",
		"time":   "Time",
		"others": "Others",
		"family": "Family",
	}
	if section, ok := known[lower]; ok {
		return section, true
	}
	if len([]rune(title)) <= 24 && !strings.ContainsAny(title, "0123456789.;,") && strings.Count(title, " ") <= 2 {
		return strings.ToUpper(title[:1]) + strings.ToLower(title[1:]), true
	}
	return "", false
}

func correctCommonOCRRow(row *ImportedRow) {
	romajiLower := strings.ToLower(cleanImportedText(row.Romaji))
	meaningLower := strings.ToLower(cleanImportedText(row.Meaning))
	prefixLike := isPrefixLikeOCRRow(row)

	if romajiLower == "watashi" && row.Meaning == "1" {
		row.Meaning = "I"
	}
	if romajiLower == "kookoo" {
		row.Word = "こうこう"
		row.Furigana = "こうこう"
	}
	if romajiLower == "ryuugakusee" {
		row.Word = "りゅうがくせい"
		row.Furigana = "りゅうがくせい"
	}
	if romajiLower == "sensee" {
		row.Meaning = "teacher; Professor . . ."
	}
	if romajiLower == "senkoo" {
		row.Word = "せんこう"
		row.Furigana = "せんこう"
		row.Meaning = "major"
	}
	if romajiLower == "watashi" {
		row.Word = "わたし"
		row.Furigana = "わたし"
	}
	if romajiLower == "gozen" {
		row.Word = "ごぜん"
		row.Furigana = "ごぜん"
		row.Meaning = "A.M."
	}
	if romajiLower == "gogo" {
		row.Word = "ごご"
		row.Furigana = "ごご"
		row.Meaning = "P.M."
	}
	if romajiLower == "amerika" {
		row.Word = "アメリカ"
		row.Furigana = "あめりか"
		row.Romaji = "Amerika"
		row.Meaning = "U.S.A."
	}
	if romajiLower == "nihon" {
		row.Word = "にほん"
		row.Furigana = "にほん"
		row.Romaji = "Nihon"
	}
	if romajiLower == "nihonjin" {
		row.Word = "にほんじん"
		row.Furigana = "にほんじん"
	}
	if romajiLower == "nihongo" {
		row.Word = "にほんご"
		row.Furigana = "にほんご"
	}
	if romajiLower == "denwa" {
		row.Word = "でんわ"
		row.Furigana = "でんわ"
	}

	switch {
	case prefixLike && strings.Contains(meaningLower, "year student"):
		row.Word = "～ねんせい"
		row.Furigana = "～ねんせい"
		row.Romaji = ". . . nensee"
		row.Meaning = ". . . year student"
	case prefixLike && (strings.Contains(meaningLower, "mr./ms") || strings.Contains(meaningLower, "mr/ms")):
		row.Word = "～さん"
		row.Furigana = "～さん"
		row.Romaji = ". . . san"
		row.Meaning = "Mr./Ms. . . ."
	case prefixLike && strings.Contains(meaningLower, "people"):
		row.Word = "～じん"
		row.Furigana = "～じん"
		row.Romaji = ". . . jin"
		row.Meaning = ". . . people"
	case strings.Contains(meaningLower, "o'clock") && (prefixLike || strings.Contains(row.Word, "L")):
		row.Word = "～じ"
		row.Furigana = "～じ"
		row.Romaji = ". . . ji"
		row.Meaning = "o'clock"
	case prefixLike && strings.Contains(meaningLower, "language") && (strings.Contains(row.Word, "ご") || strings.Contains(romajiLower, "go") || strings.Contains(romajiLower, "do")):
		row.Word = "～ご"
		row.Furigana = "～ご"
		row.Romaji = ". . . go"
		row.Meaning = ". . . language"
	case prefixLike && strings.Contains(meaningLower, "years old"):
		row.Word = "～さい"
		row.Furigana = "～さい"
		row.Romaji = ". . . sai"
		row.Meaning = ". . . years old"
	case prefixLike && strings.Contains(meaningLower, "number"):
		row.Word = "～ばん"
		row.Furigana = "～ばん"
		row.Romaji = ". . . ban"
		row.Meaning = "number . . ."
	}
}

func canRecoverNoisyVocabularyRow(romaji string, meaning string) bool {
	romaji = strings.ToLower(cleanImportedText(romaji))
	meaning = strings.ToLower(cleanImportedText(meaning))
	if romaji == "" || meaning == "" {
		return false
	}
	if _, ok := recoverableRomaji[romaji]; ok {
		return true
	}
	return strings.Contains(meaning, "mr/ms") ||
		strings.Contains(meaning, "mr./ms") ||
		strings.Contains(meaning, "people") ||
		strings.Contains(meaning, "language") ||
		strings.Contains(meaning, "years old") ||
		strings.Contains(meaning, "number") ||
		strings.Contains(meaning, "clock")
}

var recoverableRomaji = map[string]struct{}{
	"kookoo":       {},
	"ryuugakusee":  {},
	"senkoo":       {},
	"watashi":      {},
	"gogo":         {},
	"nihon":        {},
	"nihonjin":     {},
	"nihongo":      {},
	"denwa":        {},
	"amerika":      {},
	"qoqo":         {},
	"gogogo":       {},
	"gogo.":        {},
	"gogo ":        {},
	". . . go":     {},
	". . . ban":    {},
	". . . sai":    {},
	". . . ji":     {},
	". . . jin":    {},
	". . . san":    {},
	". . . nensee": {},
}

func isPrefixLikeOCRRow(row *ImportedRow) bool {
	word := row.Word
	romaji := cleanImportedText(row.Romaji)
	meaning := cleanImportedText(row.Meaning)
	return strings.ContainsAny(word, "～~ー") ||
		strings.HasPrefix(word, "へ") ||
		strings.Contains(romaji, ". . .") ||
		strings.HasPrefix(romaji, "...") ||
		strings.Contains(meaning, ". . .") ||
		strings.HasPrefix(meaning, "...")
}

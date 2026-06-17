package vocab

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode"
)

var (
	ErrOCRUnavailable = errors.New("local OCR engine unavailable")
	ErrNoRows         = errors.New("no vocabulary rows found")
)

type Config struct {
	Binary        string
	Languages     string
	PSM           int
	Timeout       time.Duration
	OllamaURL     string
	OllamaModel   string
	OllamaTimeout time.Duration
}

type ImportedRow struct {
	ID         string  `json:"id"`
	Section    string  `json:"section,omitempty"`
	Word       string  `json:"word"`
	Furigana   string  `json:"furigana"`
	Romaji     string  `json:"romaji"`
	Meaning    string  `json:"meaning"`
	Confidence float64 `json:"confidence,omitempty"`
}

type ImportResult struct {
	Engine   string        `json:"engine"`
	Rows     []ImportedRow `json:"rows"`
	Warnings []string      `json:"warnings,omitempty"`
}

type ocrToken struct {
	Text                     string
	Left, Top, Width, Height int
	Conf                     float64
	Block, Paragraph, Line   int
}

type ocrLine struct {
	Tokens []ocrToken
	Top    int
}

func ImportImage(ctx context.Context, image []byte, filename string, cfg Config) (ImportResult, error) {
	warnings := []string{}
	if strings.TrimSpace(cfg.OllamaURL) != "" {
		result, err := importImageWithOllama(ctx, image, cfg)
		if err == nil && len(result.Rows) > 0 {
			return result, nil
		}
		if err != nil {
			warnings = append(warnings, "Ollama vision import failed; falling back to local Tesseract OCR.")
		}
	}

	if cfg.Binary == "" {
		cfg.Binary = "tesseract"
	}
	if cfg.Languages == "" {
		cfg.Languages = "jpn+eng"
	}
	if cfg.PSM <= 0 {
		cfg.PSM = 6
	}
	if cfg.Timeout <= 0 {
		cfg.Timeout = 90 * time.Second
	}
	if _, err := exec.LookPath(cfg.Binary); err != nil {
		return ImportResult{}, fmt.Errorf("%w: %s", ErrOCRUnavailable, err)
	}

	ext := strings.ToLower(filepath.Ext(filename))
	if ext == "" || len(ext) > 8 {
		ext = ".img"
	}
	tmp, err := os.CreateTemp("", "kiroku-vocab-*"+ext)
	if err != nil {
		return ImportResult{}, err
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)
	if _, err := tmp.Write(image); err != nil {
		tmp.Close()
		return ImportResult{}, err
	}
	if err := tmp.Close(); err != nil {
		return ImportResult{}, err
	}

	ocrCtx, cancel := context.WithTimeout(ctx, cfg.Timeout)
	defer cancel()
	cmd := exec.CommandContext(
		ocrCtx,
		cfg.Binary,
		tmpName,
		"stdout",
		"-l",
		cfg.Languages,
		"--psm",
		strconv.Itoa(cfg.PSM),
		"tsv",
	)
	cmd.Env = append(os.Environ(), "OMP_THREAD_LIMIT=1")
	output, err := cmd.CombinedOutput()
	if ocrCtx.Err() == context.DeadlineExceeded {
		return ImportResult{}, fmt.Errorf("%w: OCR timed out after %s", ErrOCRUnavailable, cfg.Timeout)
	}
	if err != nil {
		msg := strings.TrimSpace(string(output))
		if msg == "" {
			msg = err.Error()
		}
		return ImportResult{}, fmt.Errorf("%w: %s", ErrOCRUnavailable, msg)
	}

	rows, ocrWarnings := ParseTesseractTSV(string(output))
	warnings = append(warnings, ocrWarnings...)
	if len(rows) == 0 {
		return ImportResult{}, ErrNoRows
	}
	return ImportResult{
		Engine:   fmt.Sprintf("tesseract:%s", cfg.Languages),
		Rows:     rows,
		Warnings: warnings,
	}, nil
}

func ParseTesseractTSV(tsv string) ([]ImportedRow, []string) {
	lines := parseLines(tsv)
	rows := make([]ImportedRow, 0, len(lines))
	warnings := []string{}
	currentSection := ""

	for _, line := range lines {
		if section, ok := sectionFromLine(line.Tokens); ok {
			currentSection = section
			continue
		}
		row, ok := rowFromLine(line.Tokens, currentSection)
		if !ok {
			continue
		}
		rows = append(rows, row)
	}

	if len(rows) == 0 && len(lines) > 0 {
		warnings = append(warnings, "OCR text was detected, but no three-column vocabulary rows were found.")
	}
	return normalizeImportedRows(rows), warnings
}

func parseLines(tsv string) []ocrLine {
	groups := map[string][]ocrToken{}
	for i, rawLine := range strings.Split(tsv, "\n") {
		rawLine = strings.TrimSpace(rawLine)
		if rawLine == "" || i == 0 {
			continue
		}
		cols := strings.Split(rawLine, "\t")
		if len(cols) < 12 {
			continue
		}
		level := atoi(cols[0])
		if level != 5 {
			continue
		}
		text := cleanOCRText(cols[11])
		if text == "" {
			continue
		}
		conf := atof(cols[10])
		if conf < 0 {
			continue
		}
		token := ocrToken{
			Text:      text,
			Left:      atoi(cols[6]),
			Top:       atoi(cols[7]),
			Width:     atoi(cols[8]),
			Height:    atoi(cols[9]),
			Conf:      conf,
			Block:     atoi(cols[2]),
			Paragraph: atoi(cols[3]),
			Line:      atoi(cols[4]),
		}
		key := fmt.Sprintf("%d:%d:%d", token.Block, token.Paragraph, token.Line)
		groups[key] = append(groups[key], token)
	}

	lines := make([]ocrLine, 0, len(groups))
	for _, tokens := range groups {
		sort.Slice(tokens, func(i, j int) bool {
			if tokens[i].Left == tokens[j].Left {
				return tokens[i].Top < tokens[j].Top
			}
			return tokens[i].Left < tokens[j].Left
		})
		top := tokens[0].Top
		for _, token := range tokens[1:] {
			if token.Top < top {
				top = token.Top
			}
		}
		lines = append(lines, ocrLine{Tokens: tokens, Top: top})
	}
	sort.Slice(lines, func(i, j int) bool {
		if abs(lines[i].Top-lines[j].Top) <= 6 {
			return lines[i].Tokens[0].Left < lines[j].Tokens[0].Left
		}
		return lines[i].Top < lines[j].Top
	})
	return lines
}

func sectionFromLine(tokens []ocrToken) (string, bool) {
	if len(tokens) == 0 {
		return "", false
	}
	if hasJapanese(tokens[0].Text) {
		return "", false
	}
	text := joinTokens(tokens)
	if !hasJapanese(text) && lineWidth(tokens) > 300 {
		return "", false
	}
	if title, ok := latinSectionTitle(text); ok {
		return title, true
	}
	if !hasJapanese(text) {
		return "", false
	}
	if strings.Count(text, "(")+strings.Count(text, "（") == 0 {
		return "", false
	}
	title := text
	for _, sep := range []string{"(", "（"} {
		if idx := strings.Index(title, sep); idx >= 0 {
			title = title[:idx]
		}
	}
	title = collapseSpacedLetters(title)
	title = strings.TrimSpace(strings.Trim(title, "-—:：・"))
	if title == "" {
		return "", false
	}
	return title, true
}

func rowFromLine(tokens []ocrToken, section string) (ImportedRow, bool) {
	tokens = trimRowMarkers(tokens)
	if len(tokens) < 3 {
		return ImportedRow{}, false
	}

	wordTokens, romajiTokens, meaningTokens, ok := splitVocabularyColumns(tokens)
	if !ok {
		return ImportedRow{}, false
	}

	word := joinJapaneseTokens(wordTokens)
	romaji := normalizeOCRRomaji(joinTokens(romajiTokens))
	meaning := normalizeOCRMeaning(joinTokens(meaningTokens))
	if !tokensContainJapaneseish(wordTokens) && !canRecoverNoisyVocabularyRow(romaji, meaning) {
		return ImportedRow{}, false
	}
	if word == "" || romaji == "" || meaning == "" {
		return ImportedRow{}, false
	}
	if !looksRomaji(romaji) && !canRecoverNoisyVocabularyRow(romaji, meaning) {
		return ImportedRow{}, false
	}

	confidence := averageConfidence(tokens)
	return ImportedRow{
		Section:    section,
		Word:       word,
		Furigana:   word,
		Romaji:     romaji,
		Meaning:    meaning,
		Confidence: confidence,
	}, true
}

func trimRowMarkers(tokens []ocrToken) []ocrToken {
	for len(tokens) > 0 {
		text := strings.TrimSpace(tokens[0].Text)
		if text != "*" && text != "＊" && text != "•" && text != "・" {
			break
		}
		tokens = tokens[1:]
	}
	return tokens
}

func splitVocabularyColumns(tokens []ocrToken) ([]ocrToken, []ocrToken, []ocrToken, bool) {
	if len(tokens) < 3 {
		return nil, nil, nil, false
	}
	type gapSplit struct {
		index int
		gap   int
	}
	splits := []gapSplit{}
	for i := 0; i < len(tokens)-1; i++ {
		gap := tokens[i+1].Left - (tokens[i].Left + tokens[i].Width)
		if gap >= 35 {
			splits = append(splits, gapSplit{index: i + 1, gap: gap})
		}
	}
	if len(splits) < 2 {
		return nil, nil, nil, false
	}
	sort.Slice(splits, func(i, j int) bool {
		if splits[i].gap == splits[j].gap {
			return splits[i].index < splits[j].index
		}
		return splits[i].gap > splits[j].gap
	})
	first, second := splits[0].index, splits[1].index
	if first > second {
		first, second = second, first
	}
	if first <= 0 || second <= first || second >= len(tokens) {
		return nil, nil, nil, false
	}
	return tokens[:first], tokens[first:second], tokens[second:], true
}

func cleanOCRText(text string) string {
	text = strings.TrimSpace(text)
	text = strings.Trim(text, "[]")
	return strings.TrimSpace(text)
}

func joinTokens(tokens []ocrToken) string {
	parts := make([]string, 0, len(tokens))
	for _, token := range tokens {
		if token.Text != "" {
			parts = append(parts, token.Text)
		}
	}
	return strings.Join(parts, " ")
}

func joinJapaneseTokens(tokens []ocrToken) string {
	var builder strings.Builder
	for _, token := range tokens {
		text := strings.TrimSpace(token.Text)
		if text != "" {
			builder.WriteString(text)
		}
	}
	return strings.TrimSpace(builder.String())
}

func collapseSpacedLetters(text string) string {
	fields := strings.Fields(text)
	if len(fields) == 0 {
		return ""
	}
	allSingleASCII := true
	for i, field := range fields {
		field = normalizeOCRLatinGlyphs(field)
		fields[i] = field
		if len([]rune(field)) != 1 || !hasLatin(field) {
			allSingleASCII = false
			break
		}
	}
	if allSingleASCII {
		return strings.Join(fields, "")
	}
	return strings.Join(fields, " ")
}

func looksRomaji(text string) bool {
	text = strings.ToLower(strings.TrimSpace(text))
	if text == "" {
		return false
	}
	for _, r := range text {
		if r == ' ' || r == '-' || r == '\'' || r == '.' {
			continue
		}
		if r < 'a' || r > 'z' {
			return false
		}
	}
	return true
}

func hasJapanese(text string) bool {
	for _, r := range text {
		if unicode.In(r, unicode.Hiragana, unicode.Katakana, unicode.Han) {
			return true
		}
	}
	return false
}

func tokensContainJapaneseish(tokens []ocrToken) bool {
	for _, token := range tokens {
		text := strings.TrimSpace(token.Text)
		if hasJapanese(text) || strings.ContainsAny(text, "~～〜ーへ") {
			return true
		}
	}
	return false
}

func lineWidth(tokens []ocrToken) int {
	if len(tokens) == 0 {
		return 0
	}
	left := tokens[0].Left
	right := tokens[0].Left + tokens[0].Width
	for _, token := range tokens[1:] {
		if token.Left < left {
			left = token.Left
		}
		if token.Left+token.Width > right {
			right = token.Left + token.Width
		}
	}
	return right - left
}

func hasLatin(text string) bool {
	for _, r := range text {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') {
			return true
		}
	}
	return false
}

func averageConfidence(tokens []ocrToken) float64 {
	if len(tokens) == 0 {
		return 0
	}
	var sum float64
	var count int
	for _, token := range tokens {
		if token.Conf >= 0 {
			sum += token.Conf
			count++
		}
	}
	if count == 0 {
		return 0
	}
	return sum / float64(count)
}

func atoi(text string) int {
	n, _ := strconv.Atoi(strings.TrimSpace(text))
	return n
}

func atof(text string) float64 {
	n, _ := strconv.ParseFloat(strings.TrimSpace(text), 64)
	return n
}

func abs(n int) int {
	if n < 0 {
		return -n
	}
	return n
}

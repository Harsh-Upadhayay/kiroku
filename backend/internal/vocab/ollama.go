package vocab

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

const defaultOllamaVocabModel = "qwen2.5vl:3b"

const ollamaVocabPrompt = `You extract Japanese textbook vocabulary tables from images.

Return only valid JSON with this exact shape:
{"rows":[{"section":"School","word":"だいがく","furigana":"だいがく","romaji":"daigaku","meaning":"college; university"}]}

Rules:
- Extract every visible vocabulary row in reading order.
- Do not include page headers, the title, audio labels, section headings, notes, or footnotes as rows.
- Preserve section names such as School, Person, Time, Others, Family.
- The word field is the Japanese vocabulary item exactly as printed, including kanji, katakana, hiragana, and prefix forms such as ～ねんせい.
- The furigana field is the printed reading. If no separate reading is printed and the word is kana-only, use the word itself. If a katakana word has small furigana above it, use that furigana.
- Preserve romaji casing and spacing exactly enough to match the page, including entries such as Nihon, Amerika, niji han, and . . . nensee.
- Preserve English punctuation and ellipses, including semicolons and entries like . . . year student.
- Leave confidence/id fields out.`

type ollamaGenerateRequest struct {
	Model   string         `json:"model"`
	Prompt  string         `json:"prompt"`
	Images  []string       `json:"images,omitempty"`
	Format  string         `json:"format,omitempty"`
	Stream  bool           `json:"stream"`
	Options map[string]any `json:"options,omitempty"`
}

type ollamaGenerateResponse struct {
	Response string `json:"response"`
	Error    string `json:"error,omitempty"`
}

type ollamaVocabularyPayload struct {
	Rows []ollamaVocabularyRow `json:"rows"`
}

type ollamaVocabularyRow struct {
	Section     string `json:"section"`
	Word        string `json:"word"`
	Furigana    string `json:"furigana"`
	Reading     string `json:"reading"`
	Romaji      string `json:"romaji"`
	Meaning     string `json:"meaning"`
	English     string `json:"english"`
	Translation string `json:"translation"`
}

func importImageWithOllama(ctx context.Context, image []byte, cfg Config) (ImportResult, error) {
	model := strings.TrimSpace(cfg.OllamaModel)
	if model == "" {
		model = defaultOllamaVocabModel
	}
	timeout := cfg.OllamaTimeout
	if timeout <= 0 {
		timeout = 240 * time.Second
	}
	endpoint := strings.TrimRight(strings.TrimSpace(cfg.OllamaURL), "/") + "/api/generate"
	if endpoint == "/api/generate" {
		return ImportResult{}, errors.New("ollama URL is empty")
	}

	body, err := json.Marshal(ollamaGenerateRequest{
		Model:  model,
		Prompt: ollamaVocabPrompt,
		Images: []string{base64.StdEncoding.EncodeToString(image)},
		Format: "json",
		Stream: false,
		Options: map[string]any{
			"temperature": 0,
			"top_p":       0.1,
		},
	})
	if err != nil {
		return ImportResult{}, err
	}

	reqCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(reqCtx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return ImportResult{}, err
	}
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: timeout}
	resp, err := client.Do(req)
	if reqCtx.Err() == context.DeadlineExceeded {
		return ImportResult{}, fmt.Errorf("ollama timed out after %s", timeout)
	}
	if err != nil {
		return ImportResult{}, err
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(io.LimitReader(resp.Body, 10<<20))
	if err != nil {
		return ImportResult{}, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		msg := strings.TrimSpace(string(respBody))
		if msg == "" {
			msg = resp.Status
		}
		return ImportResult{}, fmt.Errorf("ollama request failed: %s", msg)
	}

	var generated ollamaGenerateResponse
	if err := json.Unmarshal(respBody, &generated); err != nil {
		return ImportResult{}, err
	}
	if generated.Error != "" {
		return ImportResult{}, errors.New(generated.Error)
	}

	rows, warnings, err := ParseOllamaVocabularyJSON(generated.Response)
	if err != nil {
		return ImportResult{}, err
	}
	if len(rows) == 0 {
		return ImportResult{}, ErrNoRows
	}
	return ImportResult{
		Engine:   "ollama:" + model,
		Rows:     rows,
		Warnings: warnings,
	}, nil
}

func ParseOllamaVocabularyJSON(raw string) ([]ImportedRow, []string, error) {
	raw = extractJSONText(raw)
	if raw == "" {
		return nil, nil, ErrNoRows
	}

	var payload ollamaVocabularyPayload
	if err := json.Unmarshal([]byte(raw), &payload); err != nil {
		var bareRows []ollamaVocabularyRow
		if bareErr := json.Unmarshal([]byte(raw), &bareRows); bareErr != nil {
			return nil, nil, err
		}
		payload.Rows = bareRows
	}

	rows := make([]ImportedRow, 0, len(payload.Rows))
	for _, row := range payload.Rows {
		meaning := row.Meaning
		if meaning == "" {
			meaning = row.English
		}
		if meaning == "" {
			meaning = row.Translation
		}
		furigana := row.Furigana
		if furigana == "" {
			furigana = row.Reading
		}
		rows = append(rows, ImportedRow{
			Section:  row.Section,
			Word:     row.Word,
			Furigana: furigana,
			Romaji:   row.Romaji,
			Meaning:  meaning,
		})
	}

	normalized := normalizeImportedRows(rows)
	warnings := []string{}
	if len(normalized) < len(payload.Rows) {
		warnings = append(warnings, "Some Ollama rows were incomplete and were skipped.")
	}
	return normalized, warnings, nil
}

func extractJSONText(raw string) string {
	raw = strings.TrimSpace(raw)
	raw = strings.TrimPrefix(raw, "```json")
	raw = strings.TrimPrefix(raw, "```JSON")
	raw = strings.TrimPrefix(raw, "```")
	raw = strings.TrimSuffix(raw, "```")
	raw = strings.TrimSpace(raw)
	if json.Valid([]byte(raw)) {
		return raw
	}

	startObj := strings.Index(raw, "{")
	endObj := strings.LastIndex(raw, "}")
	if startObj >= 0 && endObj > startObj {
		candidate := strings.TrimSpace(raw[startObj : endObj+1])
		if json.Valid([]byte(candidate)) {
			return candidate
		}
	}

	startArray := strings.Index(raw, "[")
	endArray := strings.LastIndex(raw, "]")
	if startArray >= 0 && endArray > startArray {
		candidate := strings.TrimSpace(raw[startArray : endArray+1])
		if json.Valid([]byte(candidate)) {
			return candidate
		}
	}
	return raw
}

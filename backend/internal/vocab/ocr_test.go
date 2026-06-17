package vocab

import (
	"encoding/json"
	"os"
	"testing"
)

func TestParseTesseractTSVExtractsVocabularyRows(t *testing.T) {
	tsv := `level	page_num	block_num	par_num	line_num	word_num	left	top	width	height	conf	text
5	1	1	1	1	1	90	80	20	20	91	F
5	1	1	1	1	2	118	80	20	20	91	a
5	1	1	1	1	3	146	80	20	20	91	m
5	1	1	1	1	4	174	80	20	20	91	i
5	1	1	1	1	5	202	80	20	20	91	l
5	1	1	1	1	6	230	80	20	20	91	y
5	1	1	1	1	7	270	80	45	20	91	(かぞく
5	1	1	1	1	8	325	80	70	20	91	kazoku)
5	1	1	1	2	1	120	120	92	24	96	おかあさん
5	1	1	1	2	2	360	120	78	24	96	okaasan
5	1	1	1	2	3	590	120	75	24	96	mother
5	1	1	1	3	1	120	154	92	24	95	おとうさん
5	1	1	1	3	2	360	154	82	24	95	otoosan
5	1	1	1	3	3	590	154	68	24	95	father
5	1	1	1	4	1	120	188	92	24	95	おねえさん
5	1	1	1	4	2	360	188	82	24	95	oneesan
5	1	1	1	4	3	590	188	58	24	95	older
5	1	1	1	4	4	665	188	54	24	95	sister`

	rows, warnings := ParseTesseractTSV(tsv)
	if len(warnings) != 0 {
		t.Fatalf("expected no warnings, got %v", warnings)
	}
	if len(rows) != 3 {
		t.Fatalf("expected 3 rows, got %d: %#v", len(rows), rows)
	}
	if rows[0].Section != "Family" {
		t.Fatalf("expected section Family, got %q", rows[0].Section)
	}
	if rows[0].Word != "おかあさん" || rows[0].Furigana != "おかあさん" || rows[0].Romaji != "okaasan" || rows[0].Meaning != "mother" {
		t.Fatalf("unexpected first row: %#v", rows[0])
	}
	if rows[2].Meaning != "older sister" {
		t.Fatalf("expected multi-word meaning, got %q", rows[2].Meaning)
	}
}

func TestParseTesseractTSVSkipsNonRows(t *testing.T) {
	tsv := `level	page_num	block_num	par_num	line_num	word_num	left	top	width	height	conf	text
5	1	1	1	1	1	20	20	30	20	90	40
5	1	1	1	1	2	58	20	55	20	90	会話
5	1	1	1	1	3	118	20	55	20	90	文法編`

	rows, warnings := ParseTesseractTSV(tsv)
	if len(rows) != 0 {
		t.Fatalf("expected no rows, got %#v", rows)
	}
	if len(warnings) != 1 {
		t.Fatalf("expected warning for OCR text without rows, got %v", warnings)
	}
}

func TestParseOllamaVocabularyJSONExtractsGenkiLesson1Page(t *testing.T) {
	raw, err := os.ReadFile("testdata/genki-lesson1-page40-expected.json")
	if err != nil {
		t.Fatal(err)
	}

	var expected struct {
		Rows []ImportedRow `json:"rows"`
	}
	if err := json.Unmarshal(raw, &expected); err != nil {
		t.Fatal(err)
	}

	rows, warnings, err := ParseOllamaVocabularyJSON("```json\n" + string(raw) + "\n```")
	if err != nil {
		t.Fatal(err)
	}
	if len(warnings) != 0 {
		t.Fatalf("expected no warnings, got %v", warnings)
	}
	if len(rows) != 28 {
		t.Fatalf("expected 28 rows, got %d", len(rows))
	}
	if len(rows) != len(expected.Rows) {
		t.Fatalf("fixture and parser row counts differ: got %d expected %d", len(rows), len(expected.Rows))
	}

	for i := range expected.Rows {
		got := rows[i]
		want := expected.Rows[i]
		if got.Section != want.Section || got.Word != want.Word || got.Furigana != want.Furigana || got.Romaji != want.Romaji || got.Meaning != want.Meaning {
			t.Fatalf("row %d mismatch:\n got: %#v\nwant: %#v", i+1, got, want)
		}
	}
}

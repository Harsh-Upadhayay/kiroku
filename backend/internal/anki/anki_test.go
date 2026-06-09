package anki

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestImportSampleDecks(t *testing.T) {
	tests := []struct {
		name         string
		file         string
		wantNotes    int
		wantCards    int
		wantMediaMin int
		wantMedia    string
	}{
		{
			name:         "kanji writing deck",
			file:         "JLPT_N5_Kanji_Writing_with_Example_Words__Stroke_Order.apkg",
			wantNotes:    80,
			wantCards:    80,
			wantMediaMin: 80,
			wantMedia:    ".png",
		},
		{
			name:      "n5 to n1 vocabulary deck",
			file:      "JLPT_N5_to_N1_Japanese_Vocabulary.apkg",
			wantNotes: 7597,
			wantCards: 15194,
		},
		{
			name:         "ultimate n5 vocabulary deck",
			file:         "Ultimate_JLPT_N5_Vocabulary_Deck_v13.apkg",
			wantNotes:    689,
			wantCards:    1378,
			wantMediaMin: 600,
			wantMedia:    ".mp3",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			path := filepath.Join("..", "..", "..", tt.file)
			f, err := os.Open(path)
			if os.IsNotExist(err) {
				t.Skipf("sample deck not present: %s", path)
			}
			if err != nil {
				t.Fatal(err)
			}
			defer f.Close()

			info, err := f.Stat()
			if err != nil {
				t.Fatal(err)
			}
			result, err := ImportAPKG(f, info.Size())
			if err != nil {
				t.Fatal(err)
			}
			if got := len(result.Collection.Notes); got != tt.wantNotes {
				t.Fatalf("notes=%d, want %d", got, tt.wantNotes)
			}
			if got := len(result.Collection.Cards); got != tt.wantCards {
				t.Fatalf("cards=%d, want %d", got, tt.wantCards)
			}
			if got := len(result.MediaManifest); got < tt.wantMediaMin {
				t.Fatalf("media=%d, want at least %d", got, tt.wantMediaMin)
			}
			if tt.wantMedia != "" {
				found := false
				for _, media := range result.MediaManifest {
					if strings.HasSuffix(media.FileName, tt.wantMedia) {
						found = true
						break
					}
				}
				if !found {
					t.Fatalf("expected media suffix %s in manifest", tt.wantMedia)
				}
			}
		})
	}
}

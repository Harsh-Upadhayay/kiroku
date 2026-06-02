//go:build ignore
// +build ignore

package main

import (
	"fmt"
	"kiroku-api/internal/anki"
	"log"
	"os"

	_ "modernc.org/sqlite"
)

func main() {
	path := "/home/neovara/myAnki/RRTK_Recognition_Remembering_The_Kanji.apkg"
	f, err := os.Open(path)
	if err != nil {
		log.Fatal(err)
	}
	defer f.Close()
	fi, err := f.Stat()
	if err != nil {
		log.Fatal(err)
	}
	res, err := anki.ImportAPKG(f, fi.Size())
	if err != nil {
		log.Fatal(err)
	}
	emptyFront := 0
	emptyBack := 0
	onlyJapaneseBack := 0
	total := len(res.Cards)
	for _, c := range res.Cards {
		front := fmt.Sprintf("%v", c["front"])
		back := fmt.Sprintf("%v", c["back"])
		if len(front) == 0 {
			emptyFront++
		}
		if len(back) == 0 {
			emptyBack++
		}
		if len(back) > 0 && !containsASCII(back) {
			onlyJapaneseBack++
		}
	}
	fmt.Printf("total=%d emptyFront=%d emptyBack=%d onlyJapaneseBack=%d\n", total, emptyFront, emptyBack, onlyJapaneseBack)
}

func containsASCII(s string) bool {
	for _, r := range s {
		if r < 128 {
			return true
		}
	}
	return false
}

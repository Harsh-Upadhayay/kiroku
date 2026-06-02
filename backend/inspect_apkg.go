package main

import (
  "fmt"
  "log"
  "os"
  _ "modernc.org/sqlite"
  "kiroku-api/internal/anki"
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
  fmt.Printf("Total decks: %d\n", len(res.Decks))
  fmt.Printf("Total cards: %d\n", len(res.Cards))
  for i, d := range res.Decks {
    fmt.Printf("deck %d: %v\n", i, d)
  }
  for i, c := range res.Cards {
    if i >= 5 { break }
    fmt.Printf("card %d: id=%v deckName=%v front=%q back=%q fields=%v tags=%v\n", i, c["id"], c["deckName"], c["front"], c["back"], c["fields"], c["tags"])
  }
}

import assert from "node:assert/strict";
import {
  type AnkiCollection,
  type AnkiNoteType,
  defaultVocabBuilderState,
  emptyCollection,
} from "../src/utils/anki-v3";
import {
  buildVocabBuilderIndex,
  lookupKanjiComponent,
  lookupKanjiDecomposition,
  withComponentStatus,
} from "../src/utils/vocab-builder";

const decomposition = lookupKanjiDecomposition("休");
assert.equal(decomposition.source, "kanjivg");
assert.ok(decomposition.components.includes("亻"));
assert.ok(decomposition.components.includes("木"));

const water = lookupKanjiComponent("氵");
assert.equal(water.keyword, "water");
assert.equal(water.variantGroup, "水");

const deck = { id: "deck-n5", name: "Core Japanese Vocabulary::JLPT N5" };
const kanjiType: AnkiNoteType = {
  id: "kanji-type",
  name: "Japanese Kanji Writing",
  type: 0,
  css: "",
  fields: [],
  templates: [{ name: "Card 1", ord: 0, qfmt: "{{Kanji}}", afmt: "{{Meanings}}" }],
};
const vocabType: AnkiNoteType = {
  id: "vocab-type",
  name: "Core Japanese Vocabulary",
  type: 0,
  css: "",
  fields: [],
  templates: [
    { name: "Recognition", ord: 0, qfmt: "{{furigana:Reading}}", afmt: "{{English definition}}" },
    { name: "Recall", ord: 1, qfmt: "{{English definition}}", afmt: "{{furigana:Reading}}" },
  ],
};

const collection: AnkiCollection = {
  ...emptyCollection(),
  vocabBuilder: defaultVocabBuilderState(),
  decks: [deck],
  noteTypes: [kanjiType, vocabType],
  notes: [
    {
      id: "note-kanji-rest",
      guid: "k1",
      noteTypeId: kanjiType.id,
      tags: [],
      fields: {
        Kanji: "休",
        Readings: "キュウ やす-む",
        Meanings: "rest",
        Examples: "休む (やすむ) - to rest",
      },
      fieldOrder: ["Kanji", "Readings", "Meanings", "Examples"],
      rawFields: [],
    },
    {
      id: "note-vocab-rest",
      guid: "v1",
      noteTypeId: vocabType.id,
      tags: ["jlpt_N5"],
      fields: {
        Expression: "休む",
        Reading: "休む[やすむ]",
        "English definition": "to rest",
        Grammar: "verb",
      },
      fieldOrder: ["Expression", "Reading", "English definition", "Grammar"],
      rawFields: [],
    },
  ],
  cards: [
    {
      id: "card-kanji-rest",
      noteId: "note-kanji-rest",
      deckId: deck.id,
      ord: 0,
      type: 0,
      queue: 0,
      due: 0,
      interval: 0,
      factor: 0,
      reps: 0,
      lapses: 0,
      templateName: "Card 1",
    },
    {
      id: "card-vocab-recognition",
      noteId: "note-vocab-rest",
      deckId: deck.id,
      ord: 0,
      type: 0,
      queue: 0,
      due: 0,
      interval: 0,
      factor: 0,
      reps: 0,
      lapses: 0,
      templateName: "Recognition",
    },
    {
      id: "card-vocab-recall",
      noteId: "note-vocab-rest",
      deckId: deck.id,
      ord: 1,
      type: 0,
      queue: 0,
      due: 0,
      interval: 0,
      factor: 0,
      reps: 0,
      lapses: 0,
      templateName: "Recall",
    },
  ],
};

const initial = buildVocabBuilderIndex(collection);
assert.equal(initial.currentItem?.kind, "component");
assert.equal(initial.vocabItems.find((item) => item.card?.id === "card-vocab-recall")?.locked, true);

const withKnownComponents = ["亻", "木"].reduce((current, glyph) => withComponentStatus(current, glyph, "familiar"), collection);
const ready = buildVocabBuilderIndex(withKnownComponents);
assert.equal(ready.currentItem?.kind, "kanji");
assert.equal(ready.queue.some((item) => item.card?.id === "card-vocab-recognition"), true);

console.log("vocab builder verification passed");

import { describe, it, expect } from "vitest";
import {
  vocabCellState,
  kanjiCellState,
  grammarCellState,
  reviewCellState,
  produceCellState,
  doneCellState,
} from "../utils/n5-minimap";
import type { N5DayProgress } from "../utils/n5-course";
import type { N5GrammarPoint } from "../content/n5/parser";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeState(overrides: Partial<N5DayProgress> = {}): N5DayProgress {
  return {
    day: 1,
    stage: "vocab",
    grammarIndex: 0,
    vocabIndex: 0,
    kanjiIndex: 0,
    stagesCompleted: {},
    updatedAt: 0,
    ...overrides,
  };
}

function makeGrammarPoint(id: string): N5GrammarPoint {
  return {
    id, title: `Grammar ${id}`, structure: "",
    explanation: "", examples: [], commonMistake: "", raw: "",
  };
}

const ENTRY_A = { id: "a" };
const ENTRY_B = { id: "b" };
const KANJI_A = { kanji: "日", id: "k_日" };
const KANJI_B = { kanji: "月", id: "k_月" };
const GRAMMAR_A = makeGrammarPoint("g1");
const GRAMMAR_B = makeGrammarPoint("g2");

// ---------------------------------------------------------------------------
// vocabCellState
// ---------------------------------------------------------------------------

describe("vocabCellState", () => {
  it("returns 'current' when stage is vocab and index matches", () => {
    const state = makeState({ stage: "vocab", vocabIndex: 2 });
    expect(vocabCellState(ENTRY_A, 2, state, new Set(), new Set())).toBe("current");
  });

  it("does NOT return current when stage is different even if index matches", () => {
    const state = makeState({ stage: "kanji", vocabIndex: 0 });
    expect(vocabCellState(ENTRY_A, 0, state, new Set(), new Set())).not.toBe("current");
  });

  it("returns 'learnt' when entry is in learnedVocab", () => {
    const state = makeState({ stage: "kanji" });
    expect(vocabCellState(ENTRY_A, 0, state, new Set(["a"]), new Set())).toBe("learnt");
  });

  it("returns 'skipped' when entry is in deferredVocab (and not learned)", () => {
    const state = makeState({ stage: "kanji" });
    expect(vocabCellState(ENTRY_A, 0, state, new Set(), new Set(["a"]))).toBe("skipped");
  });

  it("BUG-01: deferred must beat learned when item is in both sets", () => {
    // If an item is both learned AND deferred (user learned it, then re-skipped it),
    // it must show as "skipped" — the re-skip intent takes precedence.
    const state = makeState({ stage: "kanji" });
    const result = vocabCellState(ENTRY_A, 0, state, new Set(["a"]), new Set(["a"]));
    expect(result).toBe("skipped");
  });

  it("returns 'learnt' when vocab stage is completed and entry not in any set", () => {
    const state = makeState({ stage: "kanji", stagesCompleted: { vocab: true } });
    expect(vocabCellState(ENTRY_A, 0, state, new Set(), new Set())).toBe("learnt");
  });

  it("returns 'none' for unlearned, non-deferred entry when stage incomplete", () => {
    const state = makeState({ stage: "vocab", vocabIndex: 0 });
    expect(vocabCellState(ENTRY_B, 1, state, new Set(), new Set())).toBe("none");
  });

  it("current index is 'current' not 'none' even when not learned", () => {
    const state = makeState({ stage: "vocab", vocabIndex: 3 });
    expect(vocabCellState(ENTRY_A, 3, state, new Set(), new Set())).toBe("current");
  });

  it("deferred beats stagesCompleted: skipped item keeps amber even after stage is bulk-completed", () => {
    const state = makeState({ stage: "kanji", stagesCompleted: { vocab: true } });
    // Deferred is checked before stagesCompleted, so a re-skipped item stays amber.
    const result = vocabCellState(ENTRY_A, 0, state, new Set(), new Set(["a"]));
    expect(result).toBe("skipped");
  });
});

// ---------------------------------------------------------------------------
// kanjiCellState
// ---------------------------------------------------------------------------

describe("kanjiCellState", () => {
  it("returns 'current' when stage is kanji and index matches", () => {
    const state = makeState({ stage: "kanji", kanjiIndex: 1 });
    expect(kanjiCellState(KANJI_A, 1, state, new Set(), new Set())).toBe("current");
  });

  it("returns 'learnt' when kanji char is in learnedKanji", () => {
    const state = makeState({ stage: "vocab" });
    expect(kanjiCellState(KANJI_A, 0, state, new Set(["日"]), new Set())).toBe("learnt");
  });

  it("returns 'skipped' when kanji char is in deferredKanji", () => {
    const state = makeState({ stage: "vocab" });
    expect(kanjiCellState(KANJI_A, 0, state, new Set(), new Set(["日"]))).toBe("skipped");
  });

  it("BUG-01: deferred must beat learned for kanji when in both sets", () => {
    // Same as vocab BUG-01: re-skipping a learned kanji must show amber.
    const state = makeState({ stage: "vocab" });
    const result = kanjiCellState(KANJI_A, 0, state, new Set(["日"]), new Set(["日"]));
    expect(result).toBe("skipped");
  });

  it("returns 'learnt' when kanji stage completed", () => {
    const state = makeState({ stage: "produce", stagesCompleted: { kanji: true } });
    expect(kanjiCellState(KANJI_A, 0, state, new Set(), new Set())).toBe("learnt");
  });

  it("returns 'none' for unlearned, non-deferred kanji when stage incomplete", () => {
    const state = makeState({ stage: "kanji", kanjiIndex: 0 });
    expect(kanjiCellState(KANJI_B, 1, state, new Set(), new Set())).toBe("none");
  });

  it("uses kanji char (not id) for learned/deferred lookup", () => {
    const state = makeState({ stage: "vocab" });
    // learnedKanji contains the kanji char '日', not the id 'k_日'
    expect(kanjiCellState(KANJI_A, 0, state, new Set(["日"]), new Set())).toBe("learnt");
    expect(kanjiCellState(KANJI_A, 0, state, new Set(["k_日"]), new Set())).toBe("none");
  });
});

// ---------------------------------------------------------------------------
// grammarCellState
// ---------------------------------------------------------------------------

describe("grammarCellState", () => {
  it("returns 'current' when stage is grammar and index matches", () => {
    const state = makeState({ stage: "grammar", grammarIndex: 0 });
    expect(grammarCellState(GRAMMAR_A, 0, state, new Set())).toBe("current");
  });

  it("returns 'learnt' when point id is in learnedGrammar", () => {
    const state = makeState({ stage: "vocab" });
    expect(grammarCellState(GRAMMAR_A, 0, state, new Set(["g1"]))).toBe("learnt");
  });

  it("returns 'learnt' when grammar stage completed", () => {
    const state = makeState({ stage: "vocab", stagesCompleted: { grammar: true } });
    expect(grammarCellState(GRAMMAR_A, 0, state, new Set())).toBe("learnt");
  });

  it("BUG-12: returns 'none' when stage is not grammar and grammar not completed", () => {
    const state = makeState({ stage: "vocab", stagesCompleted: {} });
    // This hits the BUG-12 code path: stage !== "grammar" && !stagesCompleted.grammar → "none"
    expect(grammarCellState(GRAMMAR_A, 0, state, new Set())).toBe("none");
  });

  it("returns 'learnt' for items before grammarIndex when stage is grammar", () => {
    const state = makeState({ stage: "grammar", grammarIndex: 2 });
    expect(grammarCellState(GRAMMAR_A, 0, state, new Set())).toBe("learnt");
    expect(grammarCellState(GRAMMAR_A, 1, state, new Set())).toBe("learnt");
  });

  it("returns 'none' for items at or after grammarIndex when stage is grammar", () => {
    const state = makeState({ stage: "grammar", grammarIndex: 1 });
    expect(grammarCellState(GRAMMAR_B, 1, state, new Set())).toBe("current");
    expect(grammarCellState(GRAMMAR_B, 2, state, new Set())).toBe("none");
  });

  it("learned check precedes stagesCompleted check", () => {
    const state = makeState({ stage: "vocab", stagesCompleted: {} });
    // Has learnedGrammar, no stagesCompleted — should still return "learnt"
    expect(grammarCellState(GRAMMAR_A, 0, state, new Set(["g1"]))).toBe("learnt");
  });
});

// ---------------------------------------------------------------------------
// reviewCellState
// ---------------------------------------------------------------------------

describe("reviewCellState", () => {
  it("returns 'current' when stage is review", () => {
    const state = makeState({ stage: "review" });
    expect(reviewCellState(state, 5)).toBe("current");
  });

  it("returns 'learnt' when review is completed", () => {
    const state = makeState({ stage: "vocab", stagesCompleted: { review: true } });
    expect(reviewCellState(state, 0)).toBe("learnt");
  });

  it("returns 'learnt' when dueCardCount is 0 (no cards needed review)", () => {
    const state = makeState({ stage: "vocab", stagesCompleted: {} });
    expect(reviewCellState(state, 0)).toBe("learnt");
  });

  it("returns 'none' when dueCardCount > 0 and review not completed", () => {
    const state = makeState({ stage: "vocab", stagesCompleted: {} });
    expect(reviewCellState(state, 3)).toBe("none");
  });

  it("stagesCompleted.review takes priority over dueCardCount check", () => {
    const state = makeState({ stage: "vocab", stagesCompleted: { review: true } });
    expect(reviewCellState(state, 99)).toBe("learnt");
  });
});

// ---------------------------------------------------------------------------
// produceCellState
// ---------------------------------------------------------------------------

describe("produceCellState", () => {
  it("returns 'current' when stage is produce", () => {
    const state = makeState({ stage: "produce" });
    expect(produceCellState(state)).toBe("current");
  });

  it("returns 'learnt' when produce stage completed", () => {
    const state = makeState({ stage: "done", stagesCompleted: { produce: true } });
    expect(produceCellState(state)).toBe("learnt");
  });

  it("returns 'none' otherwise", () => {
    const state = makeState({ stage: "kanji", stagesCompleted: {} });
    expect(produceCellState(state)).toBe("none");
  });
});

// ---------------------------------------------------------------------------
// doneCellState
// ---------------------------------------------------------------------------

describe("doneCellState", () => {
  it("returns 'current' when stage is done", () => {
    const state = makeState({ stage: "done" });
    expect(doneCellState(state)).toBe("current");
  });

  it("returns 'learnt' when done stage completed", () => {
    const state = makeState({ stage: "review", stagesCompleted: { done: true } });
    expect(doneCellState(state)).toBe("learnt");
  });

  it("returns 'none' for in-progress day", () => {
    const state = makeState({ stage: "vocab", stagesCompleted: {} });
    expect(doneCellState(state)).toBe("none");
  });
});

// ---------------------------------------------------------------------------
// Interaction scenario: skip → learn → skip should show BUG-01
// ---------------------------------------------------------------------------

describe("BUG-01 regression: skip → learn → skip cycle", () => {
  it("after re-skipping a learned item, cell must show 'skipped' not 'learnt'", () => {
    // Full cycle: user skips v1 (deferred), later learns it (learnedVocabIds appended, deferred cleared),
    // then skips it again (deferVocabItem re-adds to deferredVocabIds).
    // At that point v1 is in BOTH sets. The deferred/re-skip intent must win.
    const state = makeState({ stage: "kanji" });
    const learnedVocab = new Set(["v1"]);
    const deferredVocab = new Set(["v1"]);
    expect(vocabCellState({ id: "v1" }, 0, state, learnedVocab, deferredVocab)).toBe("skipped");
  });
});

describe("BUG-12 regression: grammar cell position-based state on non-grammar stage", () => {
  it("item at index < grammarIndex must show 'learnt' even when stage is not 'grammar'", () => {
    // User was on grammar stage, advanced to grammarIndex 3 (items 0-2 already passed),
    // then navigated away to vocab. Items 0-2 should still show "learnt" because
    // grammarIndex > i. The early-return guard `stage !== "grammar" && !stagesCompleted.grammar`
    // (BUG-12) cuts this short and returns "none" instead.
    const state = makeState({ stage: "vocab", grammarIndex: 3, stagesCompleted: {} });
    const result = grammarCellState(GRAMMAR_A, 0, state, new Set());
    expect(result).toBe("learnt");
  });

  it("item at index === grammarIndex shows 'none' when not on grammar stage", () => {
    const state = makeState({ stage: "vocab", grammarIndex: 2, stagesCompleted: {} });
    const result = grammarCellState(GRAMMAR_A, 2, state, new Set());
    expect(result).toBe("none");
  });

  it("item at index > grammarIndex shows 'none' when not on grammar stage", () => {
    const state = makeState({ stage: "vocab", grammarIndex: 1, stagesCompleted: {} });
    const result = grammarCellState(GRAMMAR_A, 5, state, new Set());
    expect(result).toBe("none");
  });
});

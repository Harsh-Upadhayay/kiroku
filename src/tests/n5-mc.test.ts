import { describe, it, expect } from "vitest";
import { State } from "ts-fsrs";
import { buildMcQuestion, maskVocabExample, extractGrammarTokens } from "../utils/n5-mc";
import { normalizeN5Progress, type N5SRSCard } from "../utils/n5-course";
import type { N5VocabEntry, N5KanjiEntry, N5GrammarPoint, N5CourseData } from "../content/n5/parser";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeVocabEntry(id: string, word: string, meaning: string, type = "noun", example = ""): N5VocabEntry {
  return { id, number: 1, part: 1, word, reading: word, romaji: word, type, meaning, example, raw: "" };
}

function makeKanjiEntry(kanji: string, meaning: string, readings = "on、kun"): N5KanjiEntry {
  return { id: `k_${kanji}`, index: 1, kanji, readings, meaning, mnemonic: "", components: "", example: "", raw: "" };
}

function makeGrammarPoint(id: string, title: string, structure: string, examples: N5GrammarPoint["examples"] = []): N5GrammarPoint {
  return { id, title, structure, explanation: "test", examples, commonMistake: "", raw: "" };
}

function makeCard(id: string, kind: "vocab" | "kanji" | "grammar", contentId: string, reps = 0): N5SRSCard {
  return {
    id, kind, contentId, day: 1,
    createdAt: 0, updatedAt: 0, firstDueSeededAt: 0,
    due: new Date(Date.now() + 86400000).toISOString(),
    stability: 0, difficulty: 0, elapsed_days: 0, scheduled_days: 1,
    learning_steps: 0, reps, lapses: 0, state: State.New,
  };
}

function makeCourse(
  vocab: N5VocabEntry[] = [],
  kanjiList: N5KanjiEntry[] = [],
  grammar: N5GrammarPoint[] = [],
): N5CourseData {
  const vocabRecord: Record<string, N5VocabEntry> = {};
  const kanjiRecord: Record<string, N5KanjiEntry> = {};
  const grammarRecord: Record<string, N5GrammarPoint> = {};
  for (const v of vocab) vocabRecord[v.id] = v;
  for (const k of kanjiList) kanjiRecord[k.kanji] = k;
  for (const g of grammar) grammarRecord[g.id] = g;
  return {
    contentVersion: "n5-course-v1",
    contentHash: "test",
    readme: "",
    days: [],
    grammar: grammarRecord,
    vocab: vocabRecord,
    kanji: kanjiRecord,
    kanjiList,
    checkpoints: [],
  };
}

const FOUR_VOCAB = [
  makeVocabEntry("v1", "本", "book"),
  makeVocabEntry("v2", "水", "water"),
  makeVocabEntry("v3", "火", "fire"),
  makeVocabEntry("v4", "山", "mountain"),
];

const FOUR_KANJI = [
  makeKanjiEntry("日", "sun/day", "にち、じつ"),
  makeKanjiEntry("月", "moon/month", "げつ、がつ"),
  makeKanjiEntry("火", "fire", "か"),
  makeKanjiEntry("水", "water", "すい"),
];

// ---------------------------------------------------------------------------
// maskVocabExample
// ---------------------------------------------------------------------------

describe("maskVocabExample", () => {
  it("returns null when no example", () => {
    const entry = makeVocabEntry("v1", "本", "book", "noun", "");
    expect(maskVocabExample(entry)).toBeNull();
  });

  it("masks exact word occurrence", () => {
    const entry = makeVocabEntry("v1", "本", "book", "noun", "本を読む");
    expect(maskVocabExample(entry)).toBe("____を読む");
  });

  it("masks kanji stem when full word not found (conjugated verb)", () => {
    // 行く stem is 行, example uses 行きます
    const entry = makeVocabEntry("v1", "行く", "go", "verb", "毎日行きます");
    const masked = maskVocabExample(entry);
    expect(masked).toBe("毎日____きます");
  });

  it("returns null when word not in example and no kanji stem matches", () => {
    const entry = makeVocabEntry("v1", "abc", "test", "noun", "this has no match");
    expect(maskVocabExample(entry)).toBeNull();
  });

  it("masks first occurrence only (String.replace behaviour)", () => {
    const entry = makeVocabEntry("v1", "本", "book", "noun", "本と本");
    const masked = maskVocabExample(entry);
    expect(masked).toBe("____と本");
  });
});

// ---------------------------------------------------------------------------
// extractGrammarTokens
// ---------------------------------------------------------------------------

describe("extractGrammarTokens", () => {
  it("returns empty array for empty/null-like input", () => {
    expect(extractGrammarTokens("")).toEqual([]);
  });

  it("strips placeholder groups 〔…〕", () => {
    // 〔noun〕 is replaced by a space, so "〔noun〕はです" → " はです" → one token "はです"
    const tokens = extractGrammarTokens("〔noun〕はです");
    expect(tokens.every((t) => !t.includes("noun"))).toBe(true);
    expect(tokens.length).toBeGreaterThan(0);
  });

  it("strips English words and digits", () => {
    const tokens = extractGrammarTokens("は Verb1 です");
    expect(tokens).toContain("は");
    expect(tokens).toContain("です");
    expect(tokens.every((t) => !/[A-Za-z0-9]/.test(t))).toBe(true);
  });

  it("deduplicates tokens", () => {
    const tokens = extractGrammarTokens("は　は　です");
    const haCount = tokens.filter((t) => t === "は").length;
    expect(haCount).toBe(1);
  });

  it("sorts longest token first", () => {
    const tokens = extractGrammarTokens("ています　て");
    expect(tokens[0].length).toBeGreaterThanOrEqual(tokens[1].length);
  });

  it("handles real N5 structure", () => {
    const tokens = extractGrammarTokens("〔noun〕は〔noun〕です");
    expect(tokens).toContain("は");
    expect(tokens).toContain("です");
  });

  it("returns only kana+kanji tokens (no punctuation)", () => {
    const tokens = extractGrammarTokens("は、です。もう");
    expect(tokens.every((t) => /^[぀-ゟ゠-ヿ一-龯㐀-䶿ー]+$/.test(t))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildMcQuestion — vocab
// ---------------------------------------------------------------------------

describe("buildMcQuestion (vocab)", () => {
  const course = makeCourse(FOUR_VOCAB);
  const progress = normalizeN5Progress({ clientId: "test", learnedVocabIds: ["v1", "v2", "v3", "v4"] });

  it("returns a question for a known vocab card", () => {
    const card = makeCard("n5:vocab:v1", "vocab", "v1");
    const q = buildMcQuestion(card, course, progress);
    expect(q).not.toBeNull();
  });

  it("returns null for unknown vocab contentId", () => {
    const card = makeCard("n5:vocab:ghost", "vocab", "ghost");
    const q = buildMcQuestion(card, course, progress);
    expect(q).toBeNull();
  });

  it("question has kind 'vocab'", () => {
    const card = makeCard("n5:vocab:v1", "vocab", "v1");
    const q = buildMcQuestion(card, course, progress)!;
    expect(q.kind).toBe("vocab");
  });

  it("has 2–4 options", () => {
    const card = makeCard("n5:vocab:v1", "vocab", "v1");
    const q = buildMcQuestion(card, course, progress)!;
    expect(q.options.length).toBeGreaterThanOrEqual(2);
    expect(q.options.length).toBeLessThanOrEqual(4);
  });

  it("correctIndex points to a valid option", () => {
    const card = makeCard("n5:vocab:v1", "vocab", "v1");
    const q = buildMcQuestion(card, course, progress)!;
    expect(q.correctIndex).toBeGreaterThanOrEqual(0);
    expect(q.correctIndex).toBeLessThan(q.options.length);
  });

  it("correct option text is the vocab word", () => {
    const card = makeCard("n5:vocab:v1", "vocab", "v1");
    const q = buildMcQuestion(card, course, progress)!;
    expect(q.options[q.correctIndex].text).toBe("本");
  });

  it("is deterministic: same card + reps → same options", () => {
    const card = makeCard("n5:vocab:v1", "vocab", "v1");
    const q1 = buildMcQuestion(card, course, progress)!;
    const q2 = buildMcQuestion(card, course, progress)!;
    expect(q1.options.map((o) => o.text)).toEqual(q2.options.map((o) => o.text));
    expect(q1.correctIndex).toBe(q2.correctIndex);
  });

  it("different reps may produce different option order", () => {
    const card0 = makeCard("n5:vocab:v1", "vocab", "v1", 0);
    const card1 = makeCard("n5:vocab:v1", "vocab", "v1", 1);
    const q0 = buildMcQuestion(card0, course, progress)!;
    const q1 = buildMcQuestion(card1, course, progress)!;
    // Both should still have the correct answer
    expect(q0.options[q0.correctIndex].text).toBe("本");
    expect(q1.options[q1.correctIndex].text).toBe("本");
  });

  it("uses example sentence as promptMain when word appears in example", () => {
    const vocabWithExample = [
      makeVocabEntry("v1", "本", "book", "noun", "本を読む"),
      ...FOUR_VOCAB.slice(1),
    ];
    const courseEx = makeCourse(vocabWithExample);
    const card = makeCard("n5:vocab:v1", "vocab", "v1");
    const q = buildMcQuestion(card, courseEx, progress)!;
    expect(q.promptMain).toContain("____");
  });

  it("uses meaning-based prompt when no usable example", () => {
    const vocabNoEx = [
      makeVocabEntry("v1", "本", "book", "noun", ""),
      ...FOUR_VOCAB.slice(1),
    ];
    const courseNoEx = makeCourse(vocabNoEx);
    const card = makeCard("n5:vocab:v1", "vocab", "v1");
    const q = buildMcQuestion(card, courseNoEx, progress)!;
    expect(q.promptMain).toContain("book");
  });

  it("distractors are distinct from correct answer", () => {
    const card = makeCard("n5:vocab:v1", "vocab", "v1");
    const q = buildMcQuestion(card, course, progress)!;
    const correctText = q.options[q.correctIndex].text;
    q.options.forEach((opt, i) => {
      if (i !== q.correctIndex) expect(opt.text).not.toBe(correctText);
    });
  });
});

// ---------------------------------------------------------------------------
// buildMcQuestion — kanji
// ---------------------------------------------------------------------------

describe("buildMcQuestion (kanji)", () => {
  const course = makeCourse([], FOUR_KANJI);
  const progress = normalizeN5Progress({
    clientId: "test",
    learnedKanjiIds: FOUR_KANJI.map((k) => k.kanji),
  });

  it("returns a question for a known kanji card", () => {
    const card = makeCard("n5:kanji:日", "kanji", "日");
    const q = buildMcQuestion(card, course, progress);
    expect(q).not.toBeNull();
  });

  it("returns null for unknown kanji contentId", () => {
    const card = makeCard("n5:kanji:龍", "kanji", "龍");
    const q = buildMcQuestion(card, course, progress);
    expect(q).toBeNull();
  });

  it("kind is 'kanji-meaning' on even reps", () => {
    const card = makeCard("n5:kanji:日", "kanji", "日", 0);
    const q = buildMcQuestion(card, course, progress)!;
    expect(q.kind).toBe("kanji-meaning");
  });

  it("kind is 'kanji-reading' on odd reps", () => {
    const card = makeCard("n5:kanji:日", "kanji", "日", 1);
    const q = buildMcQuestion(card, course, progress)!;
    expect(q.kind).toBe("kanji-reading");
  });

  it("promptMain is the kanji character", () => {
    const card = makeCard("n5:kanji:日", "kanji", "日");
    const q = buildMcQuestion(card, course, progress)!;
    expect(q.promptMain).toBe("日");
  });

  it("kanji-meaning: correct option is the meaning", () => {
    const card = makeCard("n5:kanji:日", "kanji", "日", 0);
    const q = buildMcQuestion(card, course, progress)!;
    expect(q.options[q.correctIndex].text).toBe("sun/day");
  });

  it("kanji-reading: correct option is first reading", () => {
    const card = makeCard("n5:kanji:日", "kanji", "日", 1);
    const q = buildMcQuestion(card, course, progress)!;
    expect(q.options[q.correctIndex].text).toBe("にち");
  });

  it("has 2–4 options", () => {
    const card = makeCard("n5:kanji:日", "kanji", "日");
    const q = buildMcQuestion(card, course, progress)!;
    expect(q.options.length).toBeGreaterThanOrEqual(2);
    expect(q.options.length).toBeLessThanOrEqual(4);
  });

  it("is deterministic", () => {
    const card = makeCard("n5:kanji:日", "kanji", "日", 2);
    const q1 = buildMcQuestion(card, course, progress)!;
    const q2 = buildMcQuestion(card, course, progress)!;
    expect(q1.options.map((o) => o.text)).toEqual(q2.options.map((o) => o.text));
  });

  it("kanji without readings stays on kanji-meaning even on odd reps", () => {
    const kanjiNoReading = [
      makeKanjiEntry("人", "person", ""),
      ...FOUR_KANJI.slice(1),
    ];
    const courseNoR = makeCourse([], kanjiNoReading);
    const card = makeCard("n5:kanji:人", "kanji", "人", 1);
    const q = buildMcQuestion(card, courseNoR, progress)!;
    expect(q.kind).toBe("kanji-meaning");
  });
});

// ---------------------------------------------------------------------------
// buildMcQuestion — grammar
// ---------------------------------------------------------------------------

describe("buildMcQuestion (grammar)", () => {
  const g1 = makeGrammarPoint("g1", "は (topic marker)", "〔noun〕は〔noun〕です", [
    { raw: "", japanese: "これは本です", translation: "This is a book" },
  ]);
  const g2 = makeGrammarPoint("g2", "が (subject marker)", "〔noun〕が〔verb〕", [
    { raw: "", japanese: "猫がいます", translation: "There is a cat" },
  ]);
  const g3 = makeGrammarPoint("g3", "を (object marker)", "〔noun〕を〔verb〕", [
    { raw: "", japanese: "本を読む", translation: "To read a book" },
  ]);
  const g4 = makeGrammarPoint("g4", "で (location)", "〔place〕で〔verb〕", [
    { raw: "", japanese: "学校で勉強する", translation: "Study at school" },
  ]);

  const course = makeCourse([], [], [g1, g2, g3, g4]);
  const progress = normalizeN5Progress({
    clientId: "test",
    learnedGrammarIds: ["g1", "g2", "g3", "g4"],
  });

  it("returns a question for a known grammar card", () => {
    const card = makeCard("n5:grammar:g1", "grammar", "g1");
    const q = buildMcQuestion(card, course, progress);
    expect(q).not.toBeNull();
  });

  it("returns null for unknown grammar contentId", () => {
    const card = makeCard("n5:grammar:ghost", "grammar", "ghost");
    const q = buildMcQuestion(card, course, progress);
    expect(q).toBeNull();
  });

  it("returns null for grammar with no examples", () => {
    const noEx = makeGrammarPoint("g0", "empty", "は", []);
    const c = makeCourse([], [], [noEx]);
    const p = normalizeN5Progress({ clientId: "x", learnedGrammarIds: ["g0"] });
    const card = makeCard("n5:grammar:g0", "grammar", "g0");
    expect(buildMcQuestion(card, c, p)).toBeNull();
  });

  it("kind is grammar-blank or grammar-meaning", () => {
    const card = makeCard("n5:grammar:g1", "grammar", "g1");
    const q = buildMcQuestion(card, course, progress)!;
    expect(["grammar-blank", "grammar-meaning"]).toContain(q.kind);
  });

  it("grammar-blank: promptMain contains ____", () => {
    const card = makeCard("n5:grammar:g1", "grammar", "g1");
    const q = buildMcQuestion(card, course, progress)!;
    if (q.kind === "grammar-blank") {
      expect(q.promptMain).toContain("____");
    }
  });

  it("has 2–4 options", () => {
    const card = makeCard("n5:grammar:g1", "grammar", "g1");
    const q = buildMcQuestion(card, course, progress)!;
    expect(q.options.length).toBeGreaterThanOrEqual(2);
    expect(q.options.length).toBeLessThanOrEqual(4);
  });

  it("is deterministic", () => {
    const card = makeCard("n5:grammar:g1", "grammar", "g1", 0);
    const q1 = buildMcQuestion(card, course, progress)!;
    const q2 = buildMcQuestion(card, course, progress)!;
    expect(q1.options.map((o) => o.text)).toEqual(q2.options.map((o) => o.text));
    expect(q1.correctIndex).toBe(q2.correctIndex);
  });

  it("cycles through examples using reps % examples.length", () => {
    const multiEx = makeGrammarPoint("gm", "multi-ex", "〔noun〕は〔noun〕です", [
      { raw: "", japanese: "これは本です", translation: "This is a book" },
      { raw: "", japanese: "それはペンです", translation: "That is a pen" },
    ]);
    const c = makeCourse([], [], [multiEx, g2, g3, g4]);
    const p = normalizeN5Progress({ clientId: "x", learnedGrammarIds: ["gm", "g2", "g3", "g4"] });
    const card0 = makeCard("n5:grammar:gm", "grammar", "gm", 0);
    const card1 = makeCard("n5:grammar:gm", "grammar", "gm", 2);
    const q0 = buildMcQuestion(card0, c, p)!;
    const q1 = buildMcQuestion(card1, c, p)!;
    // Both use same example (reps 0 and 2 both → index 0), so should be identical
    expect(q0.options.map((o) => o.text)).toEqual(q1.options.map((o) => o.text));
  });

  it("correct option text appears in the original example", () => {
    const card = makeCard("n5:grammar:g1", "grammar", "g1");
    const q = buildMcQuestion(card, course, progress)!;
    if (q.kind === "grammar-blank") {
      const correctText = q.options[q.correctIndex].text;
      expect(g1.examples[0].japanese).toContain(correctText);
    }
  });
});

// ---------------------------------------------------------------------------
// buildMcQuestion — edge cases
// ---------------------------------------------------------------------------

describe("buildMcQuestion (edge cases)", () => {
  it("returns null for unknown kind", () => {
    const card = { ...makeCard("c1", "vocab", "v1"), kind: "unknown" as "vocab" };
    expect(buildMcQuestion(card, makeCourse(), normalizeN5Progress({ clientId: "x" }))).toBeNull();
  });

  it("falls back to fewer distractors when pool is small", () => {
    const singleVocab = [makeVocabEntry("v1", "本", "book")];
    const course = makeCourse(singleVocab);
    const p = normalizeN5Progress({ clientId: "x", learnedVocabIds: ["v1"] });
    const card = makeCard("n5:vocab:v1", "vocab", "v1");
    const q = buildMcQuestion(card, course, p)!;
    expect(q).not.toBeNull();
    expect(q.options.length).toBeGreaterThanOrEqual(1);
  });
});

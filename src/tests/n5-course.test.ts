import { describe, it, expect } from "vitest";
import { State } from "ts-fsrs";
import {
  effectiveVocabQueue,
  effectiveKanjiQueue,
  deferVocabItem,
  deferKanjiItem,
  advanceVocabPure,
  advanceKanjiPure,
  advanceGrammarPure,
  firstUnlearnedIndex,
  completeN5Stage,
  completeN5Day,
  gradeN5Card,
  normalizeN5Progress,
  normalizeN5Cards,
  buildCumulativeReviewQueue,
  formatN5Due,
  stableHashNumber,
  cardIdForVocab,
  cardIdForKanji,
  cardIdForGrammar,
  isN5CardDue,
  dueN5Cards,
  getN5DayState,
  updateN5DayState,
  backfillLearnedGrammarForCompletedDays,
  ensureN5CardsForLearned,
  markN5VocabLearned,
  markN5KanjiLearned,
  markN5GrammarLearned,
  updateN5ProductionAnswer,
  recordN5DueTrend,
  type N5CourseProgress,
  type N5DayProgress,
  type N5SRSCard,
} from "../utils/n5-course";
import type { N5VocabEntry, N5KanjiEntry, N5GrammarPoint, N5CourseData } from "../content/n5/parser";

// ---------------------------------------------------------------------------
// Date helpers (mirror n5-course.ts private helpers for streak tests)
// ---------------------------------------------------------------------------

function localDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function previousDateKey(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() - 1);
  return localDateKey(date);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProgress(overrides: Partial<N5CourseProgress> = {}): N5CourseProgress {
  return normalizeN5Progress({
    clientId: "test-client",
    ...overrides,
  });
}

function makeVocabEntry(id: string, word = `word_${id}`): N5VocabEntry {
  return {
    id,
    number: 1,
    part: 1,
    word,
    reading: word,
    romaji: word,
    type: "noun",
    meaning: `meaning_${id}`,
    example: `example ${word}`,
    raw: "",
  };
}

function makeKanjiEntry(kanji: string): N5KanjiEntry {
  return {
    id: `kanji_${kanji}`,
    index: 1,
    kanji,
    readings: "on、kun",
    meaning: `meaning_${kanji}`,
    mnemonic: "",
    components: "",
    example: "",
    raw: "",
  };
}

function makeGrammarPoint(id: string): N5GrammarPoint {
  return {
    id,
    title: `Grammar ${id}`,
    structure: `〔noun〕は〔noun〕です`,
    explanation: "Explanation",
    examples: [{ raw: "", japanese: "これは本です", translation: "This is a book" }],
    commonMistake: "",
    raw: "",
  };
}

function makeCard(id: string, kind: "vocab" | "kanji" | "grammar" = "vocab", overrides: Partial<N5SRSCard> = {}): N5SRSCard {
  return {
    id,
    kind,
    contentId: id,
    day: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    firstDueSeededAt: Date.now(),
    due: new Date(Date.now() + 86400000).toISOString(),
    stability: 0,
    difficulty: 0,
    elapsed_days: 0,
    scheduled_days: 1,
    learning_steps: 0,
    reps: 0,
    lapses: 0,
    state: State.New,
    ...overrides,
  };
}

function makeDayState(overrides: Partial<N5DayProgress> = {}): N5DayProgress {
  return {
    day: 1,
    stage: "vocab",
    grammarIndex: 0,
    vocabIndex: 0,
    kanjiIndex: 0,
    stagesCompleted: {},
    updatedAt: Date.now(),
    ...overrides,
  };
}

function makeCourse(days: { day: number; vocab?: N5VocabEntry[]; kanji?: N5KanjiEntry[]; grammar?: N5GrammarPoint[] }[]): N5CourseData {
  const vocab: Record<string, N5VocabEntry> = {};
  const kanji: Record<string, N5KanjiEntry> = {};
  const grammar: Record<string, N5GrammarPoint> = {};
  const kanjiList: N5KanjiEntry[] = [];

  for (const d of days) {
    for (const v of d.vocab || []) vocab[v.id] = v;
    for (const k of d.kanji || []) { kanji[k.kanji] = k; kanjiList.push(k); }
    for (const g of d.grammar || []) grammar[g.id] = g;
  }

  return {
    contentVersion: "n5-course-v1",
    contentHash: "test",
    readme: "",
    days: days.map((d) => ({
      day: d.day,
      title: `Day ${d.day}`,
      raw: "",
      grammarText: "",
      vocabText: "",
      kanjiText: "",
      produceText: "",
      ankiText: "",
      grammarIds: (d.grammar || []).map((g) => g.id),
      vocabRanges: [],
      kanjiChars: (d.kanji || []).map((k) => k.kanji),
      unresolvedKanjiChars: [],
      produceTasks: [],
      extraLines: [],
      grammar: d.grammar || [],
      vocab: d.vocab || [],
      kanji: d.kanji || [],
    })),
    grammar,
    vocab,
    kanji,
    kanjiList,
    checkpoints: [],
  };
}

// ---------------------------------------------------------------------------
// cardIdFor* helpers
// ---------------------------------------------------------------------------

describe("cardIdForVocab", () => {
  it("returns n5:vocab:<id>", () => {
    expect(cardIdForVocab({ id: "v001" })).toBe("n5:vocab:v001");
  });
});

describe("cardIdForKanji", () => {
  it("returns n5:kanji:<char>", () => {
    expect(cardIdForKanji({ kanji: "日" })).toBe("n5:kanji:日");
  });
});

describe("cardIdForGrammar", () => {
  it("returns n5:grammar:<id>", () => {
    expect(cardIdForGrammar({ id: "g001" })).toBe("n5:grammar:g001");
  });
});

// ---------------------------------------------------------------------------
// stableHashNumber
// ---------------------------------------------------------------------------

describe("stableHashNumber", () => {
  it("returns a non-negative integer", () => {
    const h = stableHashNumber("test");
    expect(h).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(h)).toBe(true);
  });

  it("is deterministic", () => {
    expect(stableHashNumber("hello")).toBe(stableHashNumber("hello"));
  });

  it("differs for different inputs", () => {
    expect(stableHashNumber("foo")).not.toBe(stableHashNumber("bar"));
  });

  it("empty string returns consistent value", () => {
    expect(stableHashNumber("")).toBe(stableHashNumber(""));
  });
});

// ---------------------------------------------------------------------------
// formatN5Due
// ---------------------------------------------------------------------------

describe("formatN5Due", () => {
  const now = Date.now();

  it("returns 'now' for past timestamps", () => {
    expect(formatN5Due(now - 1000)).toBe("now");
    expect(formatN5Due(now)).toBe("now");
  });

  it("returns minutes for < 1 hour", () => {
    expect(formatN5Due(now + 30 * 60 * 1000)).toBe("30m");
    expect(formatN5Due(now + 59 * 60 * 1000)).toBe("59m");
    expect(formatN5Due(now + 60 * 1000)).toBe("1m");
  });

  it("returns hours for 1h–47h range", () => {
    expect(formatN5Due(now + 2 * 60 * 60 * 1000)).toBe("2h");
    expect(formatN5Due(now + 24 * 60 * 60 * 1000)).toBe("24h");
  });

  it("returns days for >= 48 hours", () => {
    expect(formatN5Due(now + 48 * 60 * 60 * 1000)).toBe("2d");
    expect(formatN5Due(now + 72 * 60 * 60 * 1000)).toBe("3d");
  });

  it("accepts ISO string", () => {
    const future = new Date(now + 90 * 60 * 1000).toISOString();
    expect(formatN5Due(future)).toBe("2h");
  });
});

// ---------------------------------------------------------------------------
// normalizeN5Progress
// ---------------------------------------------------------------------------

describe("normalizeN5Progress", () => {
  it("returns defaults when called with no args", () => {
    const p = normalizeN5Progress();
    expect(p.unlockedDay).toBe(1);
    expect(p.completedDays).toEqual([]);
    expect(p.learnedVocabIds).toEqual([]);
    expect(p.learnedKanjiIds).toEqual([]);
    expect(p.learnedGrammarIds).toEqual([]);
  });

  it("deduplicates learnedVocabIds", () => {
    const p = normalizeN5Progress({ learnedVocabIds: ["a", "b", "a", "c"], clientId: "x" });
    expect(p.learnedVocabIds).toEqual(["a", "b", "c"]);
  });

  it("clamps day to 1–30", () => {
    expect(normalizeN5Progress({ unlockedDay: 0, clientId: "x" }).unlockedDay).toBe(1);
    expect(normalizeN5Progress({ unlockedDay: 99, clientId: "x" }).unlockedDay).toBe(30);
  });

  it("unlockedDay is at least completedDays.length + 1", () => {
    const p = normalizeN5Progress({ completedDays: [1, 2, 3], unlockedDay: 1, clientId: "x" });
    expect(p.unlockedDay).toBe(4);
  });

  it("currentDay does not exceed unlockedDay", () => {
    const p = normalizeN5Progress({ currentDay: 5, unlockedDay: 2, clientId: "x" });
    expect(p.currentDay).toBeLessThanOrEqual(p.unlockedDay);
  });

  it("preserves clientId", () => {
    const p = normalizeN5Progress({ clientId: "my-client" });
    expect(p.clientId).toBe("my-client");
  });
});

// ---------------------------------------------------------------------------
// getN5DayState / updateN5DayState
// ---------------------------------------------------------------------------

describe("getN5DayState", () => {
  it("returns default state for unknown day", () => {
    const p = makeProgress();
    const s = getN5DayState(p, 1);
    expect(s.stage).toBe("review");
    expect(s.vocabIndex).toBe(0);
    expect(s.grammarIndex).toBe(0);
  });

  it("returns stored state when present", () => {
    const p = makeProgress({
      dayStates: {
        "3": { day: 3, stage: "vocab", vocabIndex: 2, grammarIndex: 0, kanjiIndex: 0, stagesCompleted: {}, updatedAt: 0 },
      },
    });
    const s = getN5DayState(p, 3);
    expect(s.stage).toBe("vocab");
    expect(s.vocabIndex).toBe(2);
  });
});

describe("updateN5DayState", () => {
  it("patches the specified day's state", () => {
    const p = makeProgress();
    const updated = updateN5DayState(p, 1, { vocabIndex: 3, stage: "vocab" });
    expect(getN5DayState(updated, 1).vocabIndex).toBe(3);
  });

  it("sets currentDay to the updated day", () => {
    const p = makeProgress();
    const updated = updateN5DayState(p, 5, { stage: "grammar" });
    expect(updated.currentDay).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// effectiveVocabQueue
// ---------------------------------------------------------------------------

describe("effectiveVocabQueue", () => {
  const v1 = makeVocabEntry("v1");
  const v2 = makeVocabEntry("v2");
  const v3 = makeVocabEntry("v3");
  const day = { vocab: [v1, v2, v3] };

  it("returns original order when no deferred ids", () => {
    const state = makeDayState({ deferredVocabIds: [] });
    expect(effectiveVocabQueue(day, state)).toEqual([v1, v2, v3]);
  });

  it("moves deferred items to the end", () => {
    const state = makeDayState({ deferredVocabIds: ["v1"] });
    const queue = effectiveVocabQueue(day, state);
    expect(queue[0].id).toBe("v2");
    expect(queue[1].id).toBe("v3");
    expect(queue[2].id).toBe("v1");
  });

  it("preserves relative order among non-deferred items", () => {
    const state = makeDayState({ deferredVocabIds: ["v2"] });
    const queue = effectiveVocabQueue(day, state);
    expect(queue.map((v) => v.id)).toEqual(["v1", "v3", "v2"]);
  });

  it("multiple deferred items appear in deferredVocabIds order", () => {
    const state = makeDayState({ deferredVocabIds: ["v3", "v1"] });
    const queue = effectiveVocabQueue(day, state);
    expect(queue.map((v) => v.id)).toEqual(["v2", "v3", "v1"]);
  });

  it("ignores deferred ids not in the day's vocab", () => {
    const state = makeDayState({ deferredVocabIds: ["v99"] });
    const queue = effectiveVocabQueue(day, state);
    expect(queue).toEqual([v1, v2, v3]);
  });
});

// ---------------------------------------------------------------------------
// effectiveKanjiQueue
// ---------------------------------------------------------------------------

describe("effectiveKanjiQueue", () => {
  const k1 = makeKanjiEntry("日");
  const k2 = makeKanjiEntry("月");
  const k3 = makeKanjiEntry("火");
  const day = { kanji: [k1, k2, k3] };

  it("returns original order when no deferred", () => {
    const state = makeDayState({ deferredKanjiIds: [] });
    expect(effectiveKanjiQueue(day, state)).toEqual([k1, k2, k3]);
  });

  it("moves deferred kanji to end", () => {
    const state = makeDayState({ deferredKanjiIds: ["日"] });
    const queue = effectiveKanjiQueue(day, state);
    expect(queue.map((k) => k.kanji)).toEqual(["月", "火", "日"]);
  });
});

// ---------------------------------------------------------------------------
// deferVocabItem
// ---------------------------------------------------------------------------

describe("deferVocabItem", () => {
  it("adds id to deferredVocabIds", () => {
    const p = makeProgress();
    const updated = deferVocabItem(p, 1, "v1");
    expect(getN5DayState(updated, 1).deferredVocabIds).toContain("v1");
  });

  it("re-appends already-deferred id to end (replace dedup)", () => {
    const p = makeProgress();
    const p1 = deferVocabItem(p, 1, "v1");
    const p2 = deferVocabItem(p1, 1, "v2");
    const p3 = deferVocabItem(p2, 1, "v1");
    const ids = getN5DayState(p3, 1).deferredVocabIds!;
    expect(ids).toEqual(["v2", "v1"]);
  });

  it("does not duplicate on second defer of same id", () => {
    const p = makeProgress();
    const p1 = deferVocabItem(p, 1, "v1");
    const p2 = deferVocabItem(p1, 1, "v1");
    expect(getN5DayState(p2, 1).deferredVocabIds).toEqual(["v1"]);
  });
});

// ---------------------------------------------------------------------------
// deferKanjiItem
// ---------------------------------------------------------------------------

describe("deferKanjiItem", () => {
  it("adds kanji char to deferredKanjiIds", () => {
    const p = makeProgress();
    const updated = deferKanjiItem(p, 1, "日");
    expect(getN5DayState(updated, 1).deferredKanjiIds).toContain("日");
  });

  it("re-appends to end if already deferred", () => {
    const p = makeProgress();
    const p1 = deferKanjiItem(p, 1, "日");
    const p2 = deferKanjiItem(p1, 1, "月");
    const p3 = deferKanjiItem(p2, 1, "日");
    expect(getN5DayState(p3, 1).deferredKanjiIds).toEqual(["月", "日"]);
  });
});

// ---------------------------------------------------------------------------
// firstUnlearnedIndex
// ---------------------------------------------------------------------------

describe("firstUnlearnedIndex", () => {
  const items = [
    { id: "a" }, { id: "b" }, { id: "c" }, { id: "d" },
  ];
  const idOf = (item: { id: string }) => item.id;

  it("returns 0 for empty learned set", () => {
    expect(firstUnlearnedIndex(items, idOf, new Set())).toBe(0);
  });

  it("skips over learned items at the front", () => {
    expect(firstUnlearnedIndex(items, idOf, new Set(["a", "b"]))).toBe(2);
  });

  it("returns queue.length when all learned (all items done — caller should skip stage)", () => {
    expect(firstUnlearnedIndex(items, idOf, new Set(["a", "b", "c", "d"]))).toBe(4);
  });

  it("returns 0 for empty queue", () => {
    expect(firstUnlearnedIndex([], idOf, new Set())).toBe(0);
  });

  it("returns index of first unlearned mid-queue", () => {
    expect(firstUnlearnedIndex(items, idOf, new Set(["a"]))).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// completeN5Stage
// ---------------------------------------------------------------------------

describe("completeN5Stage", () => {
  it("marks stage as completed", () => {
    const p = makeProgress();
    const updated = completeN5Stage(p, 1, "grammar");
    expect(getN5DayState(updated, 1).stagesCompleted.grammar).toBe(true);
  });

  it("advances to next incomplete stage", () => {
    const p = makeProgress();
    const updated = completeN5Stage(p, 1, "grammar");
    const state = getN5DayState(updated, 1);
    expect(state.stage).toBe("vocab");
  });

  it("skips already-completed stages when advancing", () => {
    const p = makeProgress({
      dayStates: {
        "1": {
          day: 1, stage: "grammar", grammarIndex: 0, vocabIndex: 0, kanjiIndex: 0,
          stagesCompleted: { review: true, vocab: true }, updatedAt: 0,
        },
      },
    });
    const updated = completeN5Stage(p, 1, "grammar");
    expect(getN5DayState(updated, 1).stage).toBe("kanji");
  });

  it("advances to done when all prior stages complete", () => {
    const p = makeProgress({
      dayStates: {
        "1": {
          day: 1, stage: "produce", grammarIndex: 0, vocabIndex: 0, kanjiIndex: 0,
          stagesCompleted: { review: true, grammar: true, vocab: true, kanji: true }, updatedAt: 0,
        },
      },
    });
    const updated = completeN5Stage(p, 1, "produce");
    expect(getN5DayState(updated, 1).stage).toBe("done");
  });
});

// ---------------------------------------------------------------------------
// completeN5Day
// ---------------------------------------------------------------------------

describe("completeN5Day", () => {
  it("adds day to completedDays", () => {
    const p = makeProgress();
    const updated = completeN5Day(p, 1);
    expect(updated.completedDays).toContain(1);
  });

  it("increments unlockedDay", () => {
    const p = makeProgress({ unlockedDay: 1 });
    const updated = completeN5Day(p, 1);
    expect(updated.unlockedDay).toBe(2);
  });

  it("does not exceed day 30", () => {
    const p = makeProgress({ unlockedDay: 30, completedDays: Array.from({ length: 30 }, (_, i) => i + 1) });
    const updated = completeN5Day(p, 30);
    expect(updated.unlockedDay).toBe(30);
  });

  it("sets day state stage to done", () => {
    const p = makeProgress();
    const updated = completeN5Day(p, 1);
    expect(getN5DayState(updated, 1).stage).toBe("done");
  });

  it("all stagesCompleted set to true", () => {
    const p = makeProgress();
    const updated = completeN5Day(p, 1);
    const sc = getN5DayState(updated, 1).stagesCompleted;
    expect(sc.review).toBe(true);
    expect(sc.grammar).toBe(true);
    expect(sc.vocab).toBe(true);
    expect(sc.kanji).toBe(true);
    expect(sc.produce).toBe(true);
    expect(sc.done).toBe(true);
  });

  it("does not duplicate completedDays on repeat call", () => {
    const p = makeProgress();
    const p1 = completeN5Day(p, 1);
    const p2 = completeN5Day(p1, 1);
    expect(p2.completedDays.filter((d) => d === 1)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Streak logic inside completeN5Day
// ---------------------------------------------------------------------------

describe("streak via completeN5Day", () => {
  it("starts streak at 1 when no prior completion", () => {
    const p = makeProgress();
    const updated = completeN5Day(p, 1);
    expect(updated.streak.current).toBe(1);
  });

  it("maintains highest when current exceeds it", () => {
    const p = makeProgress({ streak: { current: 5, highest: 3, updatedAt: 0 } });
    const updated = completeN5Day(p, 2);
    expect(updated.streak.highest).toBeGreaterThanOrEqual(updated.streak.current);
  });

  it("resets to 1 when gap in completions (non-consecutive)", () => {
    const p = makeProgress({
      streak: { current: 5, highest: 5, lastCompletedDate: "2020-01-01", updatedAt: 0 },
    });
    const updated = completeN5Day(p, 2);
    expect(updated.streak.current).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// markN5VocabLearned
// ---------------------------------------------------------------------------

describe("markN5VocabLearned", () => {
  it("adds entry id to learnedVocabIds", () => {
    const p = makeProgress();
    const entry = makeVocabEntry("v1");
    const { progress } = markN5VocabLearned(p, [], 1, entry);
    expect(progress.learnedVocabIds).toContain("v1");
  });

  it("creates an SRS card with the correct id", () => {
    const p = makeProgress();
    const entry = makeVocabEntry("v1");
    const { cards } = markN5VocabLearned(p, [], 1, entry);
    expect(cards.some((c) => c.id === "n5:vocab:v1")).toBe(true);
  });

  it("does not duplicate card if already present", () => {
    const p = makeProgress();
    const entry = makeVocabEntry("v1");
    const existing = makeCard("n5:vocab:v1");
    const { cards } = markN5VocabLearned(p, [existing], 1, entry);
    expect(cards.filter((c) => c.id === "n5:vocab:v1")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// advanceVocabPure
// ---------------------------------------------------------------------------

describe("advanceVocabPure", () => {
  const vocab = [makeVocabEntry("v1"), makeVocabEntry("v2"), makeVocabEntry("v3")];
  const dayPlan = { vocab };

  it("increments vocabIndex", () => {
    const p = makeProgress();
    const { progress } = advanceVocabPure(p, [], 1, dayPlan, vocab[0]);
    expect(getN5DayState(progress, 1).vocabIndex).toBe(1);
  });

  it("adds entry to learnedVocabIds", () => {
    const p = makeProgress();
    const { progress } = advanceVocabPure(p, [], 1, dayPlan, vocab[0]);
    expect(progress.learnedVocabIds).toContain("v1");
  });

  it("completes vocab stage when last item is advanced", () => {
    const p = makeProgress({
      dayStates: {
        "1": { day: 1, stage: "vocab", vocabIndex: 2, grammarIndex: 0, kanjiIndex: 0, stagesCompleted: {}, updatedAt: 0 },
      },
    });
    const { progress } = advanceVocabPure(p, [], 1, dayPlan, vocab[2]);
    expect(getN5DayState(progress, 1).stagesCompleted?.vocab).toBe(true);
  });

  it("removes entry from deferredVocabIds after advancing", () => {
    const p = deferVocabItem(makeProgress(), 1, "v1");
    const queue = [makeVocabEntry("v2"), makeVocabEntry("v3"), vocab[0]];
    const { progress } = advanceVocabPure(p, [], 1, { vocab: queue }, vocab[0]);
    expect(getN5DayState(progress, 1).deferredVocabIds ?? []).not.toContain("v1");
  });
});

// ---------------------------------------------------------------------------
// advanceKanjiPure
// ---------------------------------------------------------------------------

describe("advanceKanjiPure", () => {
  const kanji = [makeKanjiEntry("日"), makeKanjiEntry("月"), makeKanjiEntry("火")];
  const dayPlan = { kanji };

  it("increments kanjiIndex", () => {
    const p = makeProgress({
      dayStates: { "1": { day: 1, stage: "kanji", vocabIndex: 0, grammarIndex: 0, kanjiIndex: 0, stagesCompleted: {}, updatedAt: 0 } },
    });
    const { progress } = advanceKanjiPure(p, [], 1, dayPlan, kanji[0]);
    expect(getN5DayState(progress, 1).kanjiIndex).toBe(1);
  });

  it("adds kanji char to learnedKanjiIds", () => {
    const p = makeProgress({
      dayStates: { "1": { day: 1, stage: "kanji", vocabIndex: 0, grammarIndex: 0, kanjiIndex: 0, stagesCompleted: {}, updatedAt: 0 } },
    });
    const { progress } = advanceKanjiPure(p, [], 1, dayPlan, kanji[0]);
    expect(progress.learnedKanjiIds).toContain("日");
  });

  it("completes kanji stage on last item", () => {
    const p = makeProgress({
      dayStates: { "1": { day: 1, stage: "kanji", vocabIndex: 0, grammarIndex: 0, kanjiIndex: 2, stagesCompleted: {}, updatedAt: 0 } },
    });
    const { progress } = advanceKanjiPure(p, [], 1, dayPlan, kanji[2]);
    expect(getN5DayState(progress, 1).stagesCompleted?.kanji).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// advanceGrammarPure
// ---------------------------------------------------------------------------

describe("advanceGrammarPure", () => {
  const grammar = [makeGrammarPoint("g1"), makeGrammarPoint("g2"), makeGrammarPoint("g3")];
  const dayPlan = { grammar };

  it("increments grammarIndex", () => {
    const p = makeProgress({
      dayStates: { "1": { day: 1, stage: "grammar", vocabIndex: 0, grammarIndex: 0, kanjiIndex: 0, stagesCompleted: {}, updatedAt: 0 } },
    });
    const { progress } = advanceGrammarPure(p, [], 1, dayPlan, grammar[0]);
    expect(getN5DayState(progress, 1).grammarIndex).toBe(1);
  });

  it("adds point id to learnedGrammarIds", () => {
    const p = makeProgress({
      dayStates: { "1": { day: 1, stage: "grammar", vocabIndex: 0, grammarIndex: 0, kanjiIndex: 0, stagesCompleted: {}, updatedAt: 0 } },
    });
    const { progress } = advanceGrammarPure(p, [], 1, dayPlan, grammar[0]);
    expect(progress.learnedGrammarIds).toContain("g1");
  });

  it("completes grammar stage on last point", () => {
    const p = makeProgress({
      dayStates: { "1": { day: 1, stage: "grammar", vocabIndex: 0, grammarIndex: 2, kanjiIndex: 0, stagesCompleted: {}, updatedAt: 0 } },
    });
    const { progress } = advanceGrammarPure(p, [], 1, dayPlan, grammar[2]);
    expect(getN5DayState(progress, 1).stagesCompleted?.grammar).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isN5CardDue / dueN5Cards
// ---------------------------------------------------------------------------

describe("isN5CardDue", () => {
  it("returns true for past due date", () => {
    const card = makeCard("c1", "vocab", { due: new Date(Date.now() - 1000).toISOString() });
    expect(isN5CardDue(card)).toBe(true);
  });

  it("returns false for future due date", () => {
    const card = makeCard("c1", "vocab", { due: new Date(Date.now() + 86400000).toISOString() });
    expect(isN5CardDue(card)).toBe(false);
  });

  it("returns true for exact now (epoch equal)", () => {
    const now = Date.now();
    const card = makeCard("c1", "vocab", { due: new Date(now).toISOString() });
    expect(isN5CardDue(card, now)).toBe(true);
  });
});

describe("dueN5Cards", () => {
  it("returns only due cards", () => {
    const now = Date.now();
    const due = makeCard("c1", "vocab", { due: new Date(now - 1000).toISOString() });
    const notDue = makeCard("c2", "vocab", { due: new Date(now + 86400000).toISOString() });
    const result = dueN5Cards([due, notDue], now);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("c1");
  });

  it("returns sorted by due date ascending", () => {
    const now = Date.now();
    const c1 = makeCard("c1", "vocab", { due: new Date(now - 500).toISOString() });
    const c2 = makeCard("c2", "vocab", { due: new Date(now - 2000).toISOString() });
    const result = dueN5Cards([c1, c2], now);
    expect(result[0].id).toBe("c2");
    expect(result[1].id).toBe("c1");
  });

  it("returns empty array when no cards due", () => {
    const future = makeCard("c1", "vocab", { due: new Date(Date.now() + 86400000).toISOString() });
    expect(dueN5Cards([future])).toHaveLength(0);
  });

  it("returns empty array for empty input", () => {
    expect(dueN5Cards([])).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// gradeN5Card
// ---------------------------------------------------------------------------

describe("gradeN5Card", () => {
  it("increments reps after grading", () => {
    const card = makeCard("c1", "vocab");
    const { card: updated } = gradeN5Card(card, 4);
    expect(updated.reps).toBeGreaterThan(card.reps);
  });

  it("returns a review log with correct cardId and kind", () => {
    const card = makeCard("c1", "vocab");
    const { log } = gradeN5Card(card, 3);
    expect(log.cardId).toBe("c1");
    expect(log.kind).toBe("vocab");
  });

  it("grade 1 (again) results in shorter interval than grade 4", () => {
    const card = makeCard("c1", "vocab");
    const now = new Date();
    const { card: bad } = gradeN5Card(card, 1, now);
    const { card: good } = gradeN5Card(card, 4, now);
    expect(new Date(bad.due).getTime()).toBeLessThan(new Date(good.due).getTime());
  });

  it("accepts custom now timestamp", () => {
    const card = makeCard("c1", "vocab");
    const past = new Date(Date.now() - 3600000);
    const { card: updated } = gradeN5Card(card, 4, past);
    expect(updated.last_review).toBe(past.toISOString());
  });

  it("records answerSeconds in log id", () => {
    const card = makeCard("c1", "vocab");
    const now = new Date();
    const { log } = gradeN5Card(card, 4, now, 15);
    expect(log.answerSeconds).toBe(15);
  });
});

// ---------------------------------------------------------------------------
// buildCumulativeReviewQueue
// ---------------------------------------------------------------------------

describe("buildCumulativeReviewQueue", () => {
  it("returns empty array for empty input", () => {
    expect(buildCumulativeReviewQueue([])).toEqual([]);
  });

  it("places due cards before non-due cards", () => {
    const now = new Date();
    const dueCard = makeCard("due", "vocab", {
      due: new Date(now.getTime() - 1000).toISOString(),
      reps: 1,
      stability: 1,
    });
    const freshCard = makeCard("fresh", "vocab", {
      due: new Date(now.getTime() + 86400000).toISOString(),
      reps: 3,
      stability: 10,
    });
    const queue = buildCumulativeReviewQueue([freshCard, dueCard], now);
    expect(queue[0].id).toBe("due");
  });

  it("returns all cards in the output", () => {
    const cards = [
      makeCard("c1", "vocab"),
      makeCard("c2", "kanji"),
      makeCard("c3", "grammar"),
    ];
    const queue = buildCumulativeReviewQueue(cards);
    expect(queue).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// backfillLearnedGrammarForCompletedDays
// ---------------------------------------------------------------------------

describe("backfillLearnedGrammarForCompletedDays", () => {
  it("adds grammar ids from completed days not yet learned", () => {
    const g1 = makeGrammarPoint("g1");
    const g2 = makeGrammarPoint("g2");
    const course = makeCourse([{ day: 1, grammar: [g1, g2] }]);
    const p = makeProgress({ completedDays: [1], learnedGrammarIds: [] });
    const updated = backfillLearnedGrammarForCompletedDays(p, course);
    expect(updated.learnedGrammarIds).toContain("g1");
    expect(updated.learnedGrammarIds).toContain("g2");
  });

  it("returns same reference when nothing to add", () => {
    const g1 = makeGrammarPoint("g1");
    const course = makeCourse([{ day: 1, grammar: [g1] }]);
    const p = makeProgress({ completedDays: [1], learnedGrammarIds: ["g1"] });
    const updated = backfillLearnedGrammarForCompletedDays(p, course);
    expect(updated).toBe(p);
  });

  it("does not add grammar from non-completed days", () => {
    const g1 = makeGrammarPoint("g1");
    const g2 = makeGrammarPoint("g2");
    const course = makeCourse([
      { day: 1, grammar: [g1] },
      { day: 2, grammar: [g2] },
    ]);
    const p = makeProgress({ completedDays: [1], learnedGrammarIds: [] });
    const updated = backfillLearnedGrammarForCompletedDays(p, course);
    expect(updated.learnedGrammarIds).not.toContain("g2");
  });
});

// ---------------------------------------------------------------------------
// ensureN5CardsForLearned
// ---------------------------------------------------------------------------

describe("ensureN5CardsForLearned", () => {
  it("creates missing SRS cards for learned vocab", () => {
    const v1 = makeVocabEntry("v1");
    const course = makeCourse([{ day: 1, vocab: [v1] }]);
    const p = makeProgress({ learnedVocabIds: ["v1"] });
    const cards = ensureN5CardsForLearned(p, [], course);
    expect(cards.some((c) => c.id === "n5:vocab:v1")).toBe(true);
  });

  it("does not duplicate already-existing cards", () => {
    const v1 = makeVocabEntry("v1");
    const course = makeCourse([{ day: 1, vocab: [v1] }]);
    const p = makeProgress({ learnedVocabIds: ["v1"] });
    const existing = makeCard("n5:vocab:v1");
    const cards = ensureN5CardsForLearned(p, [existing], course);
    expect(cards.filter((c) => c.id === "n5:vocab:v1")).toHaveLength(1);
  });

  it("creates cards for learned kanji", () => {
    const k = makeKanjiEntry("日");
    const course = makeCourse([{ day: 1, kanji: [k] }]);
    const p = makeProgress({ learnedKanjiIds: ["日"] });
    const cards = ensureN5CardsForLearned(p, [], course);
    expect(cards.some((c) => c.id === "n5:kanji:日")).toBe(true);
  });

  it("creates cards for learned grammar", () => {
    const g1 = makeGrammarPoint("g1");
    const course = makeCourse([{ day: 1, grammar: [g1] }]);
    const p = makeProgress({ learnedGrammarIds: ["g1"] });
    const cards = ensureN5CardsForLearned(p, [], course);
    expect(cards.some((c) => c.id === "n5:grammar:g1")).toBe(true);
  });

  it("skips vocab ids not in course data", () => {
    const course = makeCourse([{ day: 1 }]);
    const p = makeProgress({ learnedVocabIds: ["ghost-id"] });
    const cards = ensureN5CardsForLearned(p, [], course);
    expect(cards).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// BUG-11: ReviewStage Continue must use completeN5Stage, not raw { stage: "done" } patch
// ---------------------------------------------------------------------------

describe("BUG-11: completeN5Stage('review') finds first incomplete stage, not naive 'done' patch", () => {
  it("when produce is done but kanji is not, completing review advances to kanji not done", () => {
    // This is the BUG-11 scenario: returnToDone=true because stagesCompleted.produce=true,
    // but kanji was never completed. The buggy raw patch `{ stage: "done" }` bypasses
    // completeN5Stage and jumps directly to done. Correct: call completeN5Stage("review").
    const p = makeProgress({
      dayStates: {
        "1": {
          day: 1, stage: "review", vocabIndex: 0, grammarIndex: 0, kanjiIndex: 0,
          stagesCompleted: { grammar: true, vocab: true, produce: true },
          updatedAt: 0,
        },
      },
    });
    const result = completeN5Stage(p, 1, "review");
    expect(getN5DayState(result, 1).stage).toBe("kanji");
  });

  it("when only produce is done, completing review goes to grammar (first incomplete after review)", () => {
    const p = makeProgress({
      dayStates: {
        "1": {
          day: 1, stage: "review", vocabIndex: 0, grammarIndex: 0, kanjiIndex: 0,
          stagesCompleted: { produce: true },
          updatedAt: 0,
        },
      },
    });
    const result = completeN5Stage(p, 1, "review");
    expect(getN5DayState(result, 1).stage).toBe("grammar");
  });

  it("when all stages after review are done, completing review goes to done", () => {
    const p = makeProgress({
      dayStates: {
        "1": {
          day: 1, stage: "review", vocabIndex: 0, grammarIndex: 0, kanjiIndex: 0,
          stagesCompleted: { grammar: true, vocab: true, kanji: true, produce: true },
          updatedAt: 0,
        },
      },
    });
    const result = completeN5Stage(p, 1, "review");
    expect(getN5DayState(result, 1).stage).toBe("done");
  });

  it("raw state patch { stage: done } incorrectly bypasses intermediate stages (documents the bug)", () => {
    // The BUG-11 code path: onUpdateState({ stage: "done", stagesCompleted: {..., review: true} })
    // This skips the completeN5Stage logic entirely. The test shows what completeN5Stage
    // WOULD return vs what the raw patch does.
    const stagesCompleted = { grammar: true, vocab: true, produce: true } as const;
    const correct = completeN5Stage(makeProgress({
      dayStates: { "1": { day: 1, stage: "review", vocabIndex: 0, grammarIndex: 0, kanjiIndex: 0, stagesCompleted, updatedAt: 0 } },
    }), 1, "review");
    expect(getN5DayState(correct, 1).stage).toBe("kanji"); // correct: finds first incomplete
    // The bug: { stage: "done" } would give "done" instead — skipping kanji entirely
  });
});

// ---------------------------------------------------------------------------
// BUG-13: redoDay + firstUnlearnedIndex cursor lands on last item
// ---------------------------------------------------------------------------

describe("BUG-13: after redoDay, firstUnlearnedIndex must return queue.length (not last index)", () => {
  it("when all vocab items are in learnedVocabIds (pre-redo state), firstUnlearnedIndex returns queue.length", () => {
    // After redoDay: deferredVocabIds=[], vocabIndex=0, stagesCompleted={}, but
    // learnedVocabIds still contains all vocab from the previously completed day.
    // startLesson calls firstUnlearnedIndex which should return queue.length to signal
    // "all already learned — skip the stage", not queue.length-1 (last item).
    const vocab = [makeVocabEntry("v1"), makeVocabEntry("v2"), makeVocabEntry("v3"), makeVocabEntry("v4")];
    const learnedSet = new Set(vocab.map((v) => v.id));
    const idx = firstUnlearnedIndex(vocab, (v) => v.id, learnedSet);
    expect(idx).toBe(vocab.length); // 4, not 3
  });

  it("single-item day: fully learned should return 1, not 0", () => {
    const vocab = [makeVocabEntry("v1")];
    const learnedSet = new Set(["v1"]);
    expect(firstUnlearnedIndex(vocab, (v) => v.id, learnedSet)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// BUG-10 regression: firstUnlearnedIndex on fully-learned queue
// ---------------------------------------------------------------------------

describe("BUG-10 regression: firstUnlearnedIndex must return queue.length when all learned", () => {
  it("when all 3 items learned, returns 3 (queue.length) so caller can detect stage completion", () => {
    // Returning queue.length - 1 (the last item index) forces the user to click through
    // one extra "Continue" before the stage auto-completes. The correct value is
    // queue.length so the caller's `nextIndex >= queue.length` check fires immediately.
    const items = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const learned = new Set(["a", "b", "c"]);
    const idx = firstUnlearnedIndex(items, (x) => x.id, learned);
    expect(idx).toBe(items.length);
  });

  it("single-item queue where item is learned returns 1 not 0", () => {
    const items = [{ id: "a" }];
    const learned = new Set(["a"]);
    expect(firstUnlearnedIndex(items, (x) => x.id, learned)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// SRS-01 / E-15: firstDueDelayMs range — 20h to 44h via card creation
// ---------------------------------------------------------------------------

describe("SRS-01 / E-15: new card due date falls in [20h, 44h) window", () => {
  it("ensureN5CardsForLearned: due timestamps are in range [20h, 44h) from now", () => {
    const vocab = [makeVocabEntry("v1"), makeVocabEntry("v2"), makeVocabEntry("v3")];
    const p = makeProgress({ learnedVocabIds: ["v1", "v2", "v3"] });
    const course = makeCourse([{ day: 1, vocab }]);
    const beforeMs = Date.now();
    const cards = ensureN5CardsForLearned(p, [], course);
    const afterMs = Date.now();
    const minMs = 20 * 3600 * 1000;
    const maxMs = 44 * 3600 * 1000;
    for (const card of cards) {
      const dueMs = new Date(card.due).getTime();
      // due must be in [beforeMs + 20h, afterMs + 44h]
      expect(dueMs).toBeGreaterThanOrEqual(beforeMs + minMs);
      expect(dueMs).toBeLessThanOrEqual(afterMs + maxMs);
    }
  });

  it("different vocab IDs get different (stably hashed) due offsets", () => {
    const ids = ["vocab_001", "vocab_002", "vocab_003", "vocab_004"];
    const vocab = ids.map((id) => makeVocabEntry(id));
    const p = makeProgress({ learnedVocabIds: ids });
    const course = makeCourse([{ day: 1, vocab }]);
    const cards = ensureN5CardsForLearned(p, [], course);
    const dueTimes = cards.map((c) => new Date(c.due).getTime());
    const uniqueDues = new Set(dueTimes);
    expect(uniqueDues.size).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// SRS-02 / SRS-03: Grade Again vs Grade Easy
// ---------------------------------------------------------------------------

describe("SRS-02 / SRS-03: Grade Again reschedules sooner than Grade Easy", () => {
  it("again result has earlier due than easy result (same starting card)", () => {
    const card = makeCard("srs-c1", "vocab");
    const now = new Date();
    const { card: again } = gradeN5Card(card, 1, now);
    const { card: easy } = gradeN5Card(card, 4, now);
    expect(new Date(again.due).getTime()).toBeLessThan(new Date(easy.due).getTime());
  });

  it("Grade Easy on new card schedules more than 12h out", () => {
    const card = makeCard("srs-c2", "vocab");
    const now = new Date();
    const { card: updated } = gradeN5Card(card, 4, now);
    const intervalMs = new Date(updated.due).getTime() - now.getTime();
    expect(intervalMs).toBeGreaterThan(12 * 3600 * 1000);
  });
});

// ---------------------------------------------------------------------------
// SRS-04: State progression New → Learning → Review
// ---------------------------------------------------------------------------

describe("SRS-04: card state progresses correctly", () => {
  it("new card graded Good moves out of New state", () => {
    const card = makeCard("srs-s1", "vocab");
    expect(card.state).toBe(State.New);
    const { card: updated } = gradeN5Card(card, 3);
    expect(updated.state).not.toBe(State.New);
    expect(updated.reps).toBe(1);
  });

  it("card graded multiple times reaches Review state", () => {
    let card = makeCard("srs-s2", "vocab");
    let now = new Date(2025, 0, 1, 0, 0, 0);
    for (let i = 0; i < 5; i++) {
      const result = gradeN5Card(card, 3, now);
      card = result.card;
      now = new Date(new Date(card.due).getTime() + 60000);
      if (card.state === State.Review) break;
    }
    expect(card.state).toBe(State.Review);
  });
});

// ---------------------------------------------------------------------------
// SRS-05: Lapse — Again on Review-state card increments lapses
// ---------------------------------------------------------------------------

describe("SRS-05: lapse on Again in Review state", () => {
  function buildReviewCard(seed: string): ReturnType<typeof makeCard> {
    // Advance a New card to Review state via repeated Good grades
    let card = makeCard(seed, "vocab");
    let now = new Date(2025, 0, 1);
    for (let i = 0; i < 6; i++) {
      const r = gradeN5Card(card, 3, now);
      card = r.card;
      now = new Date(new Date(card.due).getTime() + 60_000);
      if (card.state === State.Review) break;
    }
    return card;
  }

  it("grading Again on a Review-state card increments lapses", () => {
    const card = buildReviewCard("srs-lapse");
    expect(card.state).toBe(State.Review);
    const { card: after } = gradeN5Card(card, 1);
    expect(after.lapses).toBeGreaterThan(card.lapses);
  });

  it("lapsed card is rescheduled before an Easy card from the same state", () => {
    const card = buildReviewCard("srs-lapse2");
    const now = new Date();
    const { card: lapsed } = gradeN5Card(card, 1, now);
    const { card: easy } = gradeN5Card(card, 4, now);
    expect(new Date(lapsed.due).getTime()).toBeLessThan(new Date(easy.due).getTime());
  });
});

// ---------------------------------------------------------------------------
// E-13: One log per gradeN5Card call (cap enforced at the save layer)
// ---------------------------------------------------------------------------

describe("E-13: gradeN5Card produces exactly one log per call", () => {
  it("produces a log with the correct cardId", () => {
    const card = makeCard("log-c1", "vocab");
    const { log } = gradeN5Card(card, 3);
    expect(log.cardId).toBe("log-c1");
    expect(log.reviewedAt).toBeGreaterThan(0);
  });

  it("10 graded cards produce 10 unique log IDs", () => {
    const cards = Array.from({ length: 10 }, (_, i) => makeCard(`log-c${i}`, "vocab"));
    const logs = cards.map((c) => gradeN5Card(c, 3).log);
    expect(logs).toHaveLength(10);
    expect(new Set(logs.map((l) => l.id)).size).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// ST-02 / ST-04: Streak consecutive-day increment and same-day idempotence
// ---------------------------------------------------------------------------

describe("ST-02 / ST-04: streak consecutive and same-day behaviour", () => {
  it("ST-02: completes consecutive days — streak increments to 2", () => {
    const today = localDateKey();
    const yesterday = previousDateKey(today);
    const p = makeProgress({
      streak: { current: 1, highest: 1, lastCompletedDate: yesterday, updatedAt: 0 },
    });
    const updated = completeN5Day(p, 2);
    expect(updated.streak.current).toBe(2);
    expect(updated.streak.highest).toBe(2);
  });

  it("ST-02: three consecutive days — streak reaches 3", () => {
    const today = localDateKey();
    const yesterday = previousDateKey(today);
    const p = makeProgress({
      streak: { current: 2, highest: 2, lastCompletedDate: yesterday, updatedAt: 0 },
    });
    const updated = completeN5Day(p, 3);
    expect(updated.streak.current).toBe(3);
  });

  it("ST-04: completing same day twice leaves streak unchanged", () => {
    const today = localDateKey();
    const p = makeProgress({
      streak: { current: 5, highest: 5, lastCompletedDate: today, updatedAt: 0 },
    });
    const updated = completeN5Day(p, 2);
    expect(updated.streak.current).toBe(5); // same day → no increment
  });

  it("ST-05: highest streak preserved after current streak breaks", () => {
    const p = makeProgress({
      streak: { current: 5, highest: 5, lastCompletedDate: "2020-01-01", updatedAt: 0 },
    });
    const updated = completeN5Day(p, 2);
    expect(updated.streak.current).toBe(1);
    expect(updated.streak.highest).toBe(5); // highest preserved
  });
});

// ---------------------------------------------------------------------------
// markN5KanjiLearned — parallel to markN5VocabLearned
// ---------------------------------------------------------------------------

describe("markN5KanjiLearned", () => {
  it("adds kanji char to learnedKanjiIds", () => {
    const p = makeProgress();
    const entry = makeKanjiEntry("日");
    const { progress } = markN5KanjiLearned(p, [], 1, entry);
    expect(progress.learnedKanjiIds).toContain("日");
  });

  it("creates an SRS card with the correct id", () => {
    const p = makeProgress();
    const entry = makeKanjiEntry("日");
    const { cards } = markN5KanjiLearned(p, [], 1, entry);
    expect(cards.some((c) => c.id === "n5:kanji:日")).toBe(true);
  });

  it("does not duplicate card if already present", () => {
    const p = makeProgress();
    const entry = makeKanjiEntry("日");
    const existing = makeCard("n5:kanji:日", "kanji");
    const { cards } = markN5KanjiLearned(p, [existing], 1, entry);
    expect(cards.filter((c) => c.id === "n5:kanji:日")).toHaveLength(1);
  });

  it("uses kanji char (not id) as contentId in the SRS card", () => {
    const p = makeProgress();
    const entry = makeKanjiEntry("月");
    const { cards } = markN5KanjiLearned(p, [], 1, entry);
    const card = cards.find((c) => c.id === "n5:kanji:月");
    expect(card?.contentId).toBe("月");
    expect(card?.kind).toBe("kanji");
  });
});

// ---------------------------------------------------------------------------
// updateN5ProductionAnswer
// ---------------------------------------------------------------------------

describe("updateN5ProductionAnswer", () => {
  it("stores answer for the given day and key", () => {
    const p = makeProgress();
    const updated = updateN5ProductionAnswer(p, 1, "produce-0", "私は学生です。");
    expect(updated.productionAnswers?.["1"]?.["produce-0"]?.text).toBe("私は学生です。");
  });

  it("stores multiple answers for different keys in the same day", () => {
    const p = makeProgress();
    const p1 = updateN5ProductionAnswer(p, 1, "produce-0", "答えA");
    const p2 = updateN5ProductionAnswer(p1, 1, "produce-1", "答えB");
    expect(p2.productionAnswers?.["1"]?.["produce-0"]?.text).toBe("答えA");
    expect(p2.productionAnswers?.["1"]?.["produce-1"]?.text).toBe("答えB");
  });

  it("overwrites an existing answer for the same key", () => {
    const p = makeProgress();
    const p1 = updateN5ProductionAnswer(p, 1, "produce-0", "first");
    const p2 = updateN5ProductionAnswer(p1, 1, "produce-0", "second");
    expect(p2.productionAnswers?.["1"]?.["produce-0"]?.text).toBe("second");
  });

  it("stores answers for different days independently", () => {
    const p = makeProgress();
    const p1 = updateN5ProductionAnswer(p, 1, "produce-0", "day1 answer");
    const p2 = updateN5ProductionAnswer(p1, 2, "produce-0", "day2 answer");
    expect(p2.productionAnswers?.["1"]?.["produce-0"]?.text).toBe("day1 answer");
    expect(p2.productionAnswers?.["2"]?.["produce-0"]?.text).toBe("day2 answer");
  });

  it("each answer carries a non-zero updatedAt timestamp", () => {
    const p = makeProgress();
    const updated = updateN5ProductionAnswer(p, 1, "produce-0", "テスト");
    const answer = updated.productionAnswers?.["1"]?.["produce-0"];
    expect(answer?.updatedAt).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// E-01 / E-02 / E-03: Empty-stage queue behaviour
// ---------------------------------------------------------------------------

describe("E-01 / E-02 / E-03: stages with 0 items", () => {
  it("E-01: effectiveVocabQueue returns [] for a day with no vocab", () => {
    const state = makeDayState({ deferredVocabIds: [] });
    expect(effectiveVocabQueue({ vocab: [] }, state)).toEqual([]);
  });

  it("E-02: effectiveKanjiQueue returns [] for a day with no kanji", () => {
    const state = makeDayState({ deferredKanjiIds: [] });
    expect(effectiveKanjiQueue({ kanji: [] }, state)).toEqual([]);
  });

  it("E-03: firstUnlearnedIndex returns 0 for an empty grammar queue", () => {
    expect(firstUnlearnedIndex([], (g: { id: string }) => g.id, new Set())).toBe(0);
  });

  it("E-01: completeN5Stage('vocab') on day with empty vocab advances correctly", () => {
    // startLesson with an empty vocab queue should set vocabIndex = 0 = queue.length = 0 → stage completes
    const p = makeProgress({
      dayStates: { "1": { day: 1, stage: "vocab", vocabIndex: 0, grammarIndex: 0, kanjiIndex: 0, stagesCompleted: {}, updatedAt: 0 } },
    });
    const updated = completeN5Stage(p, 1, "vocab");
    expect(getN5DayState(updated, 1).stagesCompleted?.vocab).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// normalizeN5Cards
// ---------------------------------------------------------------------------

describe("normalizeN5Cards", () => {
  it("returns [] for null input", () => {
    expect(normalizeN5Cards(null)).toEqual([]);
  });

  it("returns [] for undefined input", () => {
    expect(normalizeN5Cards(undefined)).toEqual([]);
  });

  it("filters out cards with missing id", () => {
    const bad = [{ kind: "vocab" }] as any;
    expect(normalizeN5Cards(bad)).toEqual([]);
  });

  it("filters out cards with unknown kind", () => {
    const bad = [{ id: "x", kind: "unknown" }] as any;
    expect(normalizeN5Cards(bad)).toEqual([]);
  });

  it("normalizes numeric-string fields and keeps valid card", () => {
    const raw = [{ id: "v:1", kind: "vocab", contentId: null, day: null, createdAt: null, updatedAt: null, firstDueSeededAt: null, due: null, stability: null, difficulty: null, elapsed_days: null, scheduled_days: null }] as any;
    const result = normalizeN5Cards(raw);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("v:1");
    expect(typeof result[0].day).toBe("number");
    expect(typeof result[0].stability).toBe("number");
  });

  it("accepts all three valid kinds", () => {
    const cards = [
      { id: "v:1", kind: "vocab" },
      { id: "k:日", kind: "kanji" },
      { id: "g:N5-1", kind: "grammar" },
    ] as any;
    expect(normalizeN5Cards(cards)).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// recordN5DueTrend
// ---------------------------------------------------------------------------

describe("recordN5DueTrend", () => {
  it("adds today's due count to an empty trend", () => {
    const p = makeProgress({ dueCountTrend: [] });
    const result = recordN5DueTrend(p, 5);
    expect(result.dueCountTrend).toHaveLength(1);
    expect(result.dueCountTrend[0].dueCount).toBe(5);
  });

  it("updates today's entry when called twice on same day", () => {
    const p = makeProgress({ dueCountTrend: [] });
    const first = recordN5DueTrend(p, 3);
    const second = recordN5DueTrend(first, 7);
    const todayEntries = second.dueCountTrend.filter((e) => e.date === localDateKey());
    expect(todayEntries).toHaveLength(1);
    expect(todayEntries[0].dueCount).toBe(7);
  });

  it("keeps at most 10 trend entries", () => {
    const old = Array.from({ length: 15 }, (_, i) => ({
      date: `2025-01-${String(i + 1).padStart(2, "0")}`,
      dueCount: i,
      updatedAt: i,
    }));
    const p = makeProgress({ dueCountTrend: old });
    const result = recordN5DueTrend(p, 0);
    expect(result.dueCountTrend.length).toBeLessThanOrEqual(10);
  });

  it("entries are sorted chronologically", () => {
    const existing = [{ date: "2025-01-05", dueCount: 2, updatedAt: 0 }];
    const p = makeProgress({ dueCountTrend: existing });
    const result = recordN5DueTrend(p, 0);
    const dates = result.dueCountTrend.map((e) => e.date);
    const sorted = [...dates].sort();
    expect(dates).toEqual(sorted);
  });
});

// ---------------------------------------------------------------------------
// markN5GrammarLearned
// ---------------------------------------------------------------------------

describe("markN5GrammarLearned", () => {
  it("adds grammar point id to learnedGrammarIds", () => {
    const p = makeProgress({ learnedGrammarIds: [] });
    const point: N5GrammarPoint = { id: "N5-G-01", title: "は particle", structure: "N は", explanation: "", examples: [], commonMistake: "", raw: "" };
    const { progress: updated } = markN5GrammarLearned(p, [], 1, point);
    expect(updated.learnedGrammarIds).toContain("N5-G-01");
  });

  it("creates an SRS card for the grammar point", () => {
    const p = makeProgress({ learnedGrammarIds: [] });
    const point: N5GrammarPoint = { id: "N5-G-02", title: "も particle", structure: "N も", explanation: "", examples: [], commonMistake: "", raw: "" };
    const { cards } = markN5GrammarLearned(p, [], 1, point);
    expect(cards.some((c) => c.kind === "grammar" && c.contentId === "N5-G-02")).toBe(true);
  });
});



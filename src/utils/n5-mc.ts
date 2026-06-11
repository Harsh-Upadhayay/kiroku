/**
 * Deterministic multiple-choice question builder for N5 SRS reviews.
 * Pure functions — no JSX, no side effects, stable per (card.id, card.reps).
 */

import type { N5CourseData, N5GrammarPoint, N5KanjiEntry, N5VocabEntry } from "../content/n5/parser";
import type { N5CourseProgress, N5SRSCard } from "./n5-course";
import { stableHashNumber } from "./n5-course";

export interface McOption {
  text: string;
  sub?: string;
}

export interface McQuestion {
  /** Discriminates how prompt and options should be rendered. */
  kind: "vocab" | "kanji-meaning" | "kanji-reading" | "grammar-blank" | "grammar-meaning";
  /** Main prompt text (masked sentence / kanji glyph / English gloss). */
  promptMain: string;
  /** Secondary hint line below the prompt. */
  promptSub?: string;
  /** Exactly 2–4 options, shuffled deterministically. */
  options: McOption[];
  /** Index into options[] that is the correct answer. */
  correctIndex: number;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export function buildMcQuestion(
  card: N5SRSCard,
  course: N5CourseData,
  progress: N5CourseProgress,
): McQuestion | null {
  const seed = stableHashNumber(`${card.id}:${card.reps}`);
  const rng = mulberry32(seed);

  if (card.kind === "vocab") return buildVocabQuestion(card, course, progress, rng);
  if (card.kind === "kanji") return buildKanjiQuestion(card, course, progress, rng);
  if (card.kind === "grammar") return buildGrammarQuestion(card, course, progress, rng);
  return null;
}

// ---------------------------------------------------------------------------
// Masking — also exported so reviewContent can reuse it
// ---------------------------------------------------------------------------

export function maskVocabExample(entry: N5VocabEntry): string | null {
  if (!entry.example) return null;
  const word = entry.word;
  // Try exact match first.
  if (entry.example.includes(word)) {
    return entry.example.replace(word, "____");
  }
  // For verbs, try masking just the kanji stem (e.g. 行く stem 行 in 行きます).
  const kanjiRun = word.match(/^([一-龯㐀-䶿]+)/)?.[1];
  if (kanjiRun && entry.example.includes(kanjiRun)) {
    return entry.example.replace(kanjiRun, "____");
  }
  return null;
}

// ---------------------------------------------------------------------------
// Vocab question
// ---------------------------------------------------------------------------

function buildVocabQuestion(
  card: N5SRSCard,
  course: N5CourseData,
  progress: N5CourseProgress,
  rng: () => number,
): McQuestion | null {
  const entry = course.vocab[card.contentId];
  if (!entry) return null;

  const masked = maskVocabExample(entry);
  const promptMain = masked ?? `Which word means: "${entry.meaning}"?`;
  const promptSub = masked ? `${entry.type} · ${entry.meaning}` : undefined;

  const allVocab = Object.values(course.vocab);
  const learnedSet = new Set(progress.learnedVocabIds);

  const distractors = pickDistractors(
    entry.word,
    (v: N5VocabEntry) => v.word,
    (v: N5VocabEntry) => v.meaning === entry.meaning || v.word === entry.word,
    [
      allVocab.filter((v) => learnedSet.has(v.id) && v.type === entry.type && v.id !== entry.id),
      allVocab.filter((v) => learnedSet.has(v.id) && v.id !== entry.id),
      allVocab.filter((v) => v.type === entry.type && v.id !== entry.id),
      allVocab.filter((v) => v.id !== entry.id),
    ],
    3,
    rng,
  );

  const options: McOption[] = [{ text: entry.word }, ...distractors.map((v) => ({ text: v.word }))];
  return shuffleWithCorrect(options, 0, rng, "vocab", promptMain, promptSub);
}

// ---------------------------------------------------------------------------
// Kanji question
// ---------------------------------------------------------------------------

function buildKanjiQuestion(
  card: N5SRSCard,
  course: N5CourseData,
  progress: N5CourseProgress,
  rng: () => number,
): McQuestion | null {
  const entry = course.kanji[card.contentId];
  if (!entry) return null;

  const allKanji = course.kanjiList;
  const learnedSet = new Set(progress.learnedKanjiIds);

  // Alternate between meaning and reading based on rep parity; force meaning if no readings.
  const forceReading = card.reps % 2 !== 0 && entry.readings && entry.readings.trim().length > 0;
  const kind: McQuestion["kind"] = forceReading ? "kanji-reading" : "kanji-meaning";

  const promptMain = entry.kanji;
  const promptSub = forceReading ? "Pick the reading(s)" : "Pick the meaning";

  if (!forceReading) {
    const distractors = pickDistractors(
      entry.meaning,
      (k: N5KanjiEntry) => k.meaning,
      (k: N5KanjiEntry) => k.kanji === entry.kanji,
      [
        allKanji.filter((k) => learnedSet.has(k.kanji) && k.kanji !== entry.kanji),
        allKanji.filter((k) => k.kanji !== entry.kanji),
      ],
      3,
      rng,
    );
    const options: McOption[] = [{ text: entry.meaning }, ...distractors.map((k) => ({ text: k.meaning }))];
    return shuffleWithCorrect(options, 0, rng, kind, promptMain, promptSub);
  } else {
    const correctReading = entry.readings.split(/[、,]/)[0].trim();
    const distractors = pickDistractors(
      correctReading,
      (k: N5KanjiEntry) => k.readings.split(/[、,]/)[0].trim(),
      (k: N5KanjiEntry) => k.kanji === entry.kanji,
      [
        allKanji.filter((k) => learnedSet.has(k.kanji) && k.kanji !== entry.kanji && k.readings.trim()),
        allKanji.filter((k) => k.kanji !== entry.kanji && k.readings.trim()),
      ],
      3,
      rng,
    );
    const options: McOption[] = [
      { text: correctReading },
      ...distractors.map((k) => ({ text: k.readings.split(/[、,]/)[0].trim() })),
    ];
    return shuffleWithCorrect(options, 0, rng, kind, promptMain, promptSub);
  }
}

// ---------------------------------------------------------------------------
// Grammar question
// ---------------------------------------------------------------------------

export function extractGrammarTokens(structure: string): string[] {
  if (!structure) return [];
  // Remove 〔…〕 placeholder groups.
  let s = structure.replace(/〔[^〕]*〕/g, " ");
  // Remove table formatting, slash separators, English words, punctuation.
  s = s.replace(/[|/→()（）。、,;.\-–!?""''「」『』【】〈〉《》]/g, " ");
  s = s.replace(/[A-Za-z0-9_]+/g, " ");
  // Split on whitespace and filter to Japanese-only tokens (kana + kanji + prolonged sound mark).
  const tokens = s.split(/\s+/).filter((t) => t.length > 0 && /^[぀-ゟ゠-ヿ一-龯㐀-䶿ー]+$/.test(t));
  // Deduplicate, sort longest-first (greedy match in sentences).
  return Array.from(new Set(tokens)).sort((a, b) => b.length - a.length);
}

function buildGrammarQuestion(
  card: N5SRSCard,
  course: N5CourseData,
  progress: N5CourseProgress,
  rng: () => number,
): McQuestion | null {
  const point = course.grammar[card.contentId];
  if (!point || point.examples.length === 0) return null;

  const learnedSet = new Set(progress.learnedGrammarIds || []);
  const allPoints = Object.values(course.grammar);
  const example = point.examples[card.reps % point.examples.length];

  // Try grammar-blank: find a blankable token from the structure.
  const tokens = extractGrammarTokens(point.structure || "");
  const blankToken = tokens.find((t) => example.japanese.includes(t));

  if (blankToken) {
    const masked = example.japanese.replace(blankToken, "____");
    const correctOption: McOption = { text: blankToken };

    // Collect distractors: tokens from other grammar points, learnt-first.
    const otherPoints = allPoints.filter((p) => p.id !== point.id);
    const learnedOtherPoints = otherPoints.filter((p) => learnedSet.has(p.id));
    const candidateTokens = (pts: N5GrammarPoint[]) =>
      pts.flatMap((p) => extractGrammarTokens(p.structure || "")).filter((t) => t !== blankToken);

    const distractorTexts = pickDistractorTexts(
      blankToken,
      [candidateTokens(learnedOtherPoints), candidateTokens(otherPoints)],
      3,
      rng,
    );

    const options: McOption[] = [correctOption, ...distractorTexts.map((t) => ({ text: t }))];
    return shuffleWithCorrect(options, 0, rng, "grammar-blank", masked, example.translation);
  }

  // Fallback: grammar-meaning — show Japanese pattern title, pick meaning.
  const titleJp = extractTitleJapanesePart(point.title);
  const correctOption: McOption = { text: titleJp || point.title };

  const otherPoints = allPoints.filter((p) => p.id !== point.id);
  const learnedOtherPoints = otherPoints.filter((p) => learnedSet.has(p.id));
  const candidateText = (pts: N5GrammarPoint[]) =>
    pts.map((p) => extractTitleJapanesePart(p.title) || p.title).filter((t) => t !== correctOption.text);

  const distractorTexts = pickDistractorTexts(
    correctOption.text,
    [candidateText(learnedOtherPoints), candidateText(otherPoints)],
    3,
    rng,
  );

  // Explanation-based prompt: first sentence of explanation or the example translation.
  const promptMain = example.translation || point.explanation.split(".")[0];
  const promptSub = example.japanese;
  const options: McOption[] = [correctOption, ...distractorTexts.map((t) => ({ text: t }))];
  return shuffleWithCorrect(options, 0, rng, "grammar-meaning", promptMain, promptSub);
}

/** Extract the Japanese part from a grammar title like "です / だ (copula)" → "です / だ" */
function extractTitleJapanesePart(title: string): string {
  // Strip parenthesized English suffix and trim.
  return title.replace(/\s*\(.*\)\s*$/, "").replace(/\s*\[.*\]\s*$/, "").trim();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Pick up to `n` unique distractors using a cascade of candidate pools. */
function pickDistractors<T>(
  correctValue: string,
  textOf: (item: T) => string,
  isExact: (item: T) => boolean,
  pools: T[][],
  n: number,
  rng: () => number,
): T[] {
  const picked: T[] = [];
  const usedTexts = new Set<string>([correctValue]);

  for (const pool of pools) {
    if (picked.length >= n) break;
    const candidates = pool.filter((item) => !isExact(item) && !usedTexts.has(textOf(item)));
    const shuffled = fisherYates(candidates, rng);
    for (const item of shuffled) {
      if (picked.length >= n) break;
      const t = textOf(item);
      if (!usedTexts.has(t)) {
        usedTexts.add(t);
        picked.push(item);
      }
    }
  }

  return picked;
}

/** Like pickDistractors but operates directly on string arrays. */
function pickDistractorTexts(
  correctText: string,
  pools: string[][],
  n: number,
  rng: () => number,
): string[] {
  const picked: string[] = [];
  const used = new Set<string>([correctText]);

  for (const pool of pools) {
    if (picked.length >= n) break;
    const candidates = pool.filter((t) => !used.has(t));
    const shuffled = fisherYates(candidates, rng);
    for (const t of shuffled) {
      if (picked.length >= n) break;
      if (!used.has(t)) {
        used.add(t);
        picked.push(t);
      }
    }
  }

  return picked;
}

/** Shuffle options deterministically and return the updated McQuestion. */
function shuffleWithCorrect(
  options: McOption[],
  correctIndex: number,
  rng: () => number,
  kind: McQuestion["kind"],
  promptMain = "",
  promptSub?: string,
): McQuestion {
  const correct = options[correctIndex];
  const shuffled = fisherYates([...options], rng);
  const newCorrectIndex = shuffled.findIndex((o) => o === correct);
  return { kind, promptMain, promptSub, options: shuffled, correctIndex: newCorrectIndex };
}

/** In-place Fisher-Yates using the provided RNG; returns the array. */
function fisherYates<T>(arr: T[], rng: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Mulberry32 PRNG — small, fast, good enough for distractor seeding. */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s += 0x6d2b79f5;
    let z = s;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
}

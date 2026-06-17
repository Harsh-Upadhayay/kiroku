import {
  loadDictionary,
  romajiToHiragana,
  searchWords,
  type DictEntry,
  type SearchResult,
} from "./dict";
import type { ImportedVocabRow, VocabDictionaryMatch } from "./vocab-words";

function normalizeLookupText(value: string): string {
  return value
    .trim()
    .replace(/[～~]/g, "")
    .replace(/\.{2,}|…/g, "")
    .replace(/\s+/g, "");
}

function katakanaToHiragana(value: string): string {
  return value.replace(/[ァ-ヶ]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0x60));
}

function normalizeKana(value: string): string {
  return katakanaToHiragana(normalizeLookupText(value));
}

function hasKatakana(value: string): boolean {
  return /[ァ-ヶー]/.test(value);
}

function preferredWrittenForm(entry: DictEntry): string {
  return entry.k.find((form) => !/[0-9０-９]/.test(form)) || entry.k[0] || "";
}

function tokenizeMeaning(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((part) => part.length > 1);
}

export function genkiRomajiVariants(raw: string): string[] {
  const base = raw
    .trim()
    .toLowerCase()
    .replace(/[～~]/g, "")
    .replace(/\.{2,}|…/g, "")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!base) return [];

  const compact = base.replace(/\s+/g, "");
  const longVowel = compact.replace(/ee/g, "ei").replace(/oo/g, "ou");
  return Array.from(new Set([base, compact, longVowel].filter(Boolean)));
}

function entryForms(entry: DictEntry): string[] {
  return [...entry.k, ...entry.r];
}

function entryMeanings(entry: DictEntry): string[] {
  return entry.s.flatMap((sense) => sense.g).map((gloss) => gloss.trim()).filter(Boolean);
}

function meaningScore(entry: DictEntry, ocrMeaning: string): number {
  const query = ocrMeaning.trim().toLowerCase();
  if (!query) return 0;
  const tokens = tokenizeMeaning(query);
  let score = 0;

  for (const gloss of entryMeanings(entry)) {
    const low = gloss.toLowerCase();
    if (low === query) score += 500;
    else if (low.includes(query) || query.includes(low)) score += 360;

    const glossTokens = new Set(tokenizeMeaning(gloss));
    for (const token of tokens) {
      if (glossTokens.has(token)) score += 80;
      else if (low.includes(token)) score += 45;
    }
  }

  return score;
}

function formMatchScore(entry: SearchResult, row: ImportedVocabRow, readingHints: Set<string>): number {
  const ocrWord = row.ocrWord || row.word;
  const ocrFurigana = row.ocrFurigana || row.furigana;
  const normalizedWord = normalizeLookupText(ocrWord);
  const normalizedReading = normalizeKana(ocrFurigana);
  const forms = entryForms(entry);
  const readings = entry.r.map(normalizeKana);

  let score = 0;
  if (forms.some((form) => normalizeLookupText(form) === normalizedWord)) score += 800;
  if (readings.includes(normalizeKana(ocrWord))) score += 650;
  if (normalizedReading && readings.includes(normalizedReading)) score += 900;
  for (const hint of readingHints) {
    if (hint && readings.includes(hint)) score += 560;
  }
  return score;
}

function scoreEntry(entry: SearchResult, row: ImportedVocabRow, readingHints: Set<string>): number {
  const formScore = formMatchScore(entry, row, readingHints);
  if (formScore === 0) return Number.NEGATIVE_INFINITY;

  let score = entry.score + formScore;
  score += meaningScore(entry, row.ocrMeaning || row.meaning);
  return score;
}

function pickSurface(entry: DictEntry, row: ImportedVocabRow): string {
  const ocrWord = row.ocrWord || row.word;
  const normalizedOcrWord = normalizeLookupText(ocrWord);
  const ocrMatchesReading = entry.r.some((reading) => normalizeKana(reading) === normalizeKana(ocrWord));

  if (hasKatakana(ocrWord) && ocrMatchesReading) return normalizedOcrWord || ocrWord.trim();
  return preferredWrittenForm(entry) || entry.r[0] || normalizedOcrWord || ocrWord.trim();
}

export function dictionaryMatchFromEntry(entry: DictEntry, row: ImportedVocabRow): VocabDictionaryMatch {
  return {
    id: entry.id,
    word: pickSurface(entry, row),
    reading: entry.r[0] || row.furigana || row.word,
    meanings: entryMeanings(entry),
    example: entry.ex,
  };
}

export function findDictionaryMatch(row: ImportedVocabRow): VocabDictionaryMatch | undefined {
  const queries = new Set<string>();
  const readingHints = new Set<string>();

  const ocrWord = row.ocrWord || row.word;
  const ocrFurigana = row.ocrFurigana || row.furigana;
  const ocrRomaji = row.ocrRomaji || row.romaji;
  const ocrMeaning = row.ocrMeaning || row.meaning;

  for (const value of [ocrWord, ocrFurigana]) {
    const cleaned = normalizeLookupText(value || "");
    if (cleaned) {
      queries.add(cleaned);
      readingHints.add(normalizeKana(cleaned));
    }
  }

  for (const variant of genkiRomajiVariants(ocrRomaji || "")) {
    queries.add(variant);
    const kana = normalizeKana(romajiToHiragana(variant));
    if (kana) readingHints.add(kana);
  }

  if (ocrMeaning.trim().length > 1) queries.add(ocrMeaning);

  const candidates = new Map<string, { entry: SearchResult; score: number }>();
  for (const query of queries) {
    for (const entry of searchWords(query, 16)) {
      const score = scoreEntry(entry, row, readingHints);
      if (!Number.isFinite(score)) continue;
      const prev = candidates.get(entry.id);
      if (!prev || score > prev.score) candidates.set(entry.id, { entry, score });
    }
  }

  const best = Array.from(candidates.values()).sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (a.entry.k[0] || a.entry.r[0] || "").length - (b.entry.k[0] || b.entry.r[0] || "").length;
  })[0];

  return best ? dictionaryMatchFromEntry(best.entry, row) : undefined;
}

export async function enrichImportedRowsWithDictionary(rows: ImportedVocabRow[]): Promise<ImportedVocabRow[]> {
  try {
    await loadDictionary();
  } catch {
    return rows.map((row) => ({
      ...row,
      ocrWord: row.ocrWord || row.word,
      ocrFurigana: row.ocrFurigana || row.furigana || row.word,
      ocrRomaji: row.ocrRomaji || row.romaji,
      ocrMeaning: row.ocrMeaning || row.meaning,
      matchStatus: row.matchStatus || "unmatched",
    }));
  }

  return rows.map((raw) => {
    const row: ImportedVocabRow = {
      ...raw,
      ocrWord: raw.ocrWord || raw.word,
      ocrFurigana: raw.ocrFurigana || raw.furigana || raw.word,
      ocrRomaji: raw.ocrRomaji || raw.romaji,
      ocrMeaning: raw.ocrMeaning || raw.meaning,
    };
    const match = findDictionaryMatch(row);
    if (!match) {
      return { ...row, matchStatus: "unmatched" };
    }
    return {
      ...row,
      word: match.word,
      furigana: row.ocrFurigana || row.furigana,
      romaji: row.ocrRomaji || row.romaji,
      meaning: row.ocrMeaning || row.meaning,
      dictMatch: match,
      matchStatus: "matched",
    };
  });
}

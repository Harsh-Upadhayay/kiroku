import { getSettingFromDB, saveSettingToDB } from "./db";

export interface ImportedVocabRow {
  id: string;
  section?: string;
  /** Display word for the sheet. For matched rows this is the dictionary surface form. */
  word: string;
  /** Reading as printed in the imported image. */
  furigana: string;
  /** Romaji as printed in the imported image. */
  romaji: string;
  /** English meaning as printed in the imported image. */
  meaning: string;
  confidence?: number;
  ocrWord?: string;
  ocrFurigana?: string;
  ocrRomaji?: string;
  ocrMeaning?: string;
  dictMatch?: VocabDictionaryMatch;
  matchStatus?: "matched" | "unmatched" | "manual";
}

export interface VocabDictionaryMatch {
  id: string;
  word: string;
  reading: string;
  meanings: string[];
  example?: { j: string; e: string };
}

export interface VocabWord extends ImportedVocabRow {
  sourceFileName: string;
  createdAt: number;
  addedToDeckAt?: number;
  updatedAt: number;
}

export const VOCAB_WORDS_KEY = "vocab_words_v1";
const VOCAB_SHEETS_LEGACY_KEY = "vocab_sheets_v1";

function makeId(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now()}-${random}`;
}

function normalizeText(value: unknown): string {
  return String(value || "").trim();
}

function normalizeDictionaryMatch(match: unknown): VocabDictionaryMatch | undefined {
  if (!match || typeof match !== "object") return undefined;
  const raw = match as Partial<VocabDictionaryMatch>;
  const word = normalizeText(raw.word);
  const reading = normalizeText(raw.reading);
  if (!word || !reading) return undefined;
  const meanings = Array.isArray(raw.meanings) ? raw.meanings.map(normalizeText).filter(Boolean) : [];
  return {
    id: normalizeText(raw.id),
    word,
    reading,
    meanings,
    example: raw.example?.j ? { j: normalizeText(raw.example.j), e: normalizeText(raw.example.e) } : undefined,
  };
}

function normalizeWord(raw: Partial<VocabWord>, index: number, now: number): VocabWord | null {
  const word = normalizeText(raw.word);
  const meaning = normalizeText(raw.meaning);
  if (!word && !meaning) return null;
  const dictMatch = normalizeDictionaryMatch(raw.dictMatch);
  return {
    id: normalizeText(raw.id) || makeId(`vocab-word-${index}`),
    section: normalizeText(raw.section) || undefined,
    word,
    furigana: normalizeText(raw.furigana || raw.word),
    romaji: normalizeText(raw.romaji),
    meaning,
    confidence: typeof raw.confidence === "number" ? raw.confidence : undefined,
    ocrWord: normalizeText(raw.ocrWord || raw.word) || undefined,
    ocrFurigana: normalizeText(raw.ocrFurigana || raw.furigana || raw.word) || undefined,
    ocrRomaji: normalizeText(raw.ocrRomaji || raw.romaji) || undefined,
    ocrMeaning: normalizeText(raw.ocrMeaning || raw.meaning) || undefined,
    dictMatch,
    matchStatus:
      raw.matchStatus === "matched" || raw.matchStatus === "unmatched" || raw.matchStatus === "manual"
        ? raw.matchStatus
        : dictMatch
          ? "matched"
          : undefined,
    sourceFileName: normalizeText(raw.sourceFileName),
    createdAt: typeof raw.createdAt === "number" ? raw.createdAt : now,
    addedToDeckAt: typeof raw.addedToDeckAt === "number" ? raw.addedToDeckAt : undefined,
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : now,
  };
}

export function normalizeVocabWords(input: unknown): VocabWord[] {
  if (!Array.isArray(input)) return [];
  const now = Date.now();

  const seenIds = new Set<string>();
  const normalized: VocabWord[] = [];
  for (let i = 0; i < input.length; i++) {
    const w = normalizeWord(input[i] as Partial<VocabWord>, i, now);
    if (!w) continue;
    if (seenIds.has(w.id)) continue;
    seenIds.add(w.id);
    normalized.push(w);
  }

  // Dedup by dict identity (matched) or word+furigana (unmatched)
  // prefer addedToDeckAt > dictMatch > newest updatedAt
  const seenWF = new Map<string, number>();
  const deduped: VocabWord[] = [];
  for (const w of normalized) {
    const key = w.dictMatch
      ? `dict\x00${w.dictMatch.word}\x00${w.dictMatch.reading}`
      : `raw\x00${w.word}\x00${w.furigana}`;
    const prevIdx = seenWF.get(key);
    if (prevIdx === undefined) {
      seenWF.set(key, deduped.length);
      deduped.push(w);
    } else {
      const prev = deduped[prevIdx];
      const keepNew =
        (w.addedToDeckAt && !prev.addedToDeckAt) ||
        (!prev.addedToDeckAt && w.dictMatch && !prev.dictMatch) ||
        (!prev.addedToDeckAt && !prev.dictMatch && w.updatedAt > prev.updatedAt);
      if (keepNew) deduped[prevIdx] = w;
    }
  }

  return deduped.sort((a, b) => b.updatedAt - a.updatedAt);
}

function flattenLegacySheets(sheets: unknown[]): VocabWord[] {
  const now = Date.now();
  const words: VocabWord[] = [];
  for (const sheet of sheets) {
    if (!sheet || typeof sheet !== "object") continue;
    const s = sheet as Record<string, unknown>;
    const sourceFileName = normalizeText(s.sourceFileName);
    const sheetCreatedAt = typeof s.createdAt === "number" ? s.createdAt : now;
    const rows = Array.isArray(s.rows) ? s.rows : [];
    for (let i = 0; i < rows.length; i++) {
      const w = normalizeWord(
        { ...(rows[i] as Partial<VocabWord>), sourceFileName, createdAt: (rows[i] as any)?.createdAt ?? sheetCreatedAt },
        i,
        now,
      );
      if (w) words.push(w);
    }
  }
  return words;
}

export async function getVocabWords(): Promise<VocabWord[]> {
  const existing = await getSettingFromDB<VocabWord[]>(VOCAB_WORDS_KEY, []);
  if (existing?.length) return normalizeVocabWords(existing);

  // One-time migration from old vocab_sheets_v1
  const legacy = await getSettingFromDB<unknown[]>(VOCAB_SHEETS_LEGACY_KEY, []);
  if (legacy?.length) {
    const migrated = normalizeVocabWords(flattenLegacySheets(legacy));
    if (migrated.length) {
      await saveSettingToDB(VOCAB_WORDS_KEY, migrated);
      return migrated;
    }
  }
  return [];
}

export async function saveVocabWords(words: VocabWord[]): Promise<void> {
  await saveSettingToDB(VOCAB_WORDS_KEY, normalizeVocabWords(words));
}

export function createVocabWordsFromImport(sourceFileName: string, rows: ImportedVocabRow[], now = Date.now()): VocabWord[] {
  return rows
    .map((row, index) =>
      normalizeWord({ ...row, id: makeId(`vocab-word-${index}`), sourceFileName, createdAt: now, updatedAt: now }, index, now),
    )
    .filter((w): w is VocabWord => !!w);
}

export function emptyVocabWord(): VocabWord {
  const now = Date.now();
  return {
    id: makeId("vocab-word"),
    word: "",
    furigana: "",
    romaji: "",
    meaning: "",
    sourceFileName: "",
    createdAt: now,
    updatedAt: now,
  };
}

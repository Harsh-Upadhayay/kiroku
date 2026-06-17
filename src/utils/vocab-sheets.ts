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

export interface VocabSheetRow extends ImportedVocabRow {
  addedToDeckAt?: number;
  updatedAt: number;
}

export interface VocabSheet {
  id: string;
  title: string;
  sourceFileName: string;
  createdAt: number;
  updatedAt: number;
  rows: VocabSheetRow[];
}

export const VOCAB_SHEETS_KEY = "vocab_sheets_v1";

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

function normalizeRow(row: Partial<VocabSheetRow>, index: number, now: number): VocabSheetRow | null {
  const word = normalizeText(row.word);
  const meaning = normalizeText(row.meaning);
  if (!word && !meaning) return null;
  const dictMatch = normalizeDictionaryMatch(row.dictMatch);
  return {
    id: normalizeText(row.id) || makeId(`vocab-row-${index}`),
    section: normalizeText(row.section) || undefined,
    word,
    furigana: normalizeText(row.furigana || row.word),
    romaji: normalizeText(row.romaji),
    meaning,
    confidence: typeof row.confidence === "number" ? row.confidence : undefined,
    ocrWord: normalizeText(row.ocrWord || row.word) || undefined,
    ocrFurigana: normalizeText(row.ocrFurigana || row.furigana || row.word) || undefined,
    ocrRomaji: normalizeText(row.ocrRomaji || row.romaji) || undefined,
    ocrMeaning: normalizeText(row.ocrMeaning || row.meaning) || undefined,
    dictMatch,
    matchStatus:
      row.matchStatus === "matched" || row.matchStatus === "unmatched" || row.matchStatus === "manual"
        ? row.matchStatus
        : dictMatch
          ? "matched"
          : undefined,
    addedToDeckAt: typeof row.addedToDeckAt === "number" ? row.addedToDeckAt : undefined,
    updatedAt: typeof row.updatedAt === "number" ? row.updatedAt : now,
  };
}

export function normalizeVocabSheets(input: unknown): VocabSheet[] {
  if (!Array.isArray(input)) return [];
  const now = Date.now();
  const seen = new Set<string>();
  const sheets: VocabSheet[] = [];

  for (let sheetIndex = 0; sheetIndex < input.length; sheetIndex++) {
    const raw = input[sheetIndex] as Partial<VocabSheet>;
    if (!raw || typeof raw !== "object") continue;
    const id = normalizeText(raw.id) || makeId(`vocab-sheet-${sheetIndex}`);
    if (seen.has(id)) continue;
    const rows = Array.isArray(raw.rows)
      ? raw.rows
          .map((row, rowIndex) => normalizeRow(row as Partial<VocabSheetRow>, rowIndex, now))
          .filter((row): row is VocabSheetRow => !!row)
      : [];

    seen.add(id);
    sheets.push({
      id,
      title: normalizeText(raw.title) || normalizeText(raw.sourceFileName) || "Vocabulary Sheet",
      sourceFileName: normalizeText(raw.sourceFileName),
      createdAt: typeof raw.createdAt === "number" ? raw.createdAt : now,
      updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : now,
      rows,
    });
  }

  return sheets.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getVocabSheets(): Promise<VocabSheet[]> {
  return normalizeVocabSheets(await getSettingFromDB<VocabSheet[]>(VOCAB_SHEETS_KEY, []));
}

export async function saveVocabSheets(sheets: VocabSheet[]): Promise<void> {
  await saveSettingToDB(VOCAB_SHEETS_KEY, normalizeVocabSheets(sheets));
}

export function createVocabSheet(sourceFileName: string, rows: ImportedVocabRow[], now = Date.now()): VocabSheet {
  const title = sourceFileName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || "Vocabulary Sheet";
  return {
    id: makeId("vocab-sheet"),
    title,
    sourceFileName,
    createdAt: now,
    updatedAt: now,
    rows: rows
      .map((row, index) => normalizeRow({ ...row, id: row.id || makeId(`vocab-row-${index}`), updatedAt: now }, index, now))
      .filter((row): row is VocabSheetRow => !!row),
  };
}

export function emptyVocabRow(section?: string): VocabSheetRow {
  const now = Date.now();
  return {
    id: makeId("vocab-row"),
    section,
    word: "",
    furigana: "",
    romaji: "",
    meaning: "",
    updatedAt: now,
  };
}

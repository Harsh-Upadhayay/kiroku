export interface N5RawPackage {
  readme: string;
  dailyPlans: string[];
  grammar: string;
  kanji: string;
  vocabParts: string[];
}

export interface N5GrammarPoint {
  id: string;
  title: string;
  day?: number;
  structure: string;
  explanation: string;
  examples: Array<{ raw: string; japanese: string; translation: string }>;
  commonMistake: string;
  raw: string;
}

export interface N5VocabEntry {
  id: string;
  number: number;
  part: number;
  word: string;
  reading: string;
  romaji: string;
  type: string;
  meaning: string;
  example: string;
  raw: string;
}

export interface N5KanjiEntry {
  id: string;
  index: number;
  kanji: string;
  readings: string;
  meaning: string;
  mnemonic: string;
  components: string;
  example: string;
  aliasOf?: string;
  raw: string;
}

export interface N5VocabRange {
  part?: number;
  start: number;
  end: number;
  isReview: boolean;
  raw: string;
}

export interface N5Checkpoint {
  id: string;
  afterDay: number;
  title: string;
  criteria: string[];
  raw: string;
}

export interface N5DayPlan {
  day: number;
  title: string;
  raw: string;
  grammarText: string;
  vocabText: string;
  kanjiText: string;
  produceText: string;
  ankiText: string;
  grammarIds: string[];
  vocabRanges: N5VocabRange[];
  kanjiChars: string[];
  unresolvedKanjiChars: string[];
  produceTasks: string[];
  extraLines: Array<{ label: string; text: string }>;
  grammar: N5GrammarPoint[];
  vocab: N5VocabEntry[];
  kanji: N5KanjiEntry[];
}

export interface N5CourseData {
  contentVersion: string;
  contentHash: string;
  readme: string;
  days: N5DayPlan[];
  grammar: Record<string, N5GrammarPoint>;
  vocab: Record<string, N5VocabEntry>;
  kanji: Record<string, N5KanjiEntry>;
  kanjiList: N5KanjiEntry[];
  checkpoints: N5Checkpoint[];
}

export function parseN5CoursePackage(raw: N5RawPackage): N5CourseData {
  const grammar = parseGrammar(raw.grammar);
  const vocab = parseVocab(raw.vocabParts);
  const { kanji, kanjiList } = parseKanji(raw.kanji);
  const { days, checkpoints } = parseDailyPlans(raw.dailyPlans.join("\n\n"));
  const resolvedDays = days.map((day) => resolveDay(day, grammar, vocab, kanji));
  const source = [
    raw.readme,
    ...raw.dailyPlans,
    raw.grammar,
    raw.kanji,
    ...raw.vocabParts,
  ].join("\n");

  return {
    contentVersion: "n5-course-v1",
    contentHash: stableHash(source),
    readme: raw.readme,
    days: resolvedDays,
    grammar,
    vocab,
    kanji,
    kanjiList,
    checkpoints,
  };
}

function parseGrammar(markdown: string): Record<string, N5GrammarPoint> {
  const sections = splitSections(markdown, /^## (G\d{2})\s+—\s+(.+)$/gm);
  const out: Record<string, N5GrammarPoint> = {};

  sections.forEach(({ id, title, body, raw }) => {
    const dayMatch = title.match(/\[Day\s+(\d+)\]/i);
    const cleanTitle = title.replace(/\s+\[Day\s+\d+\].*$/i, "").trim();
    out[id] = {
      id,
      title: cleanTitle,
      day: dayMatch ? Number(dayMatch[1]) : undefined,
      structure: extractBoldField(body, "Structure"),
      explanation: extractBoldField(body, "Explanation"),
      examples: extractExamples(body),
      commonMistake: extractBoldField(body, "Common mistake"),
      raw: raw.trim(),
    };
  });

  return out;
}

function parseVocab(parts: string[]): Record<string, N5VocabEntry> {
  const out: Record<string, N5VocabEntry> = {};
  parts.forEach((partText, partIndex) => {
    partText.split(/\r?\n/).forEach((line) => {
      const match = line.match(/^(\d{3})\s+(.+?)\s+—\s+(.+)$/);
      if (!match) return;
      const [, id, word, rest] = match;
      const fields = rest.split(/\s+—\s+/);
      if (fields.length < 3) return;
      const readingMatch = fields[0].match(/^(.+?)\s+\((.+)\)$/);
      const reading = readingMatch ? readingMatch[1] : fields[0];
      const romaji = readingMatch ? readingMatch[2] : "";
      out[id] = {
        id,
        number: Number(id),
        part: partIndex + 1,
        word,
        reading,
        romaji,
        type: fields[1],
        meaning: fields[2],
        example: fields.slice(3).join(" — "),
        raw: line,
      };
    });
  });
  return out;
}

function parseKanji(markdown: string): { kanji: Record<string, N5KanjiEntry>; kanjiList: N5KanjiEntry[] } {
  const sections = splitSections(markdown, /^###\s+(\d{2,3})\s+(.+)$/gm);
  const byIndex = new Map<number, N5KanjiEntry>();
  const out: Record<string, N5KanjiEntry> = {};

  sections.forEach(({ id, title, body, raw }) => {
    const index = Number(id);
    const alias = title.match(/^(.+?)\s+—\s+see\s+#(\d+)\s+\((.+)\)$/i);
    if (alias) {
      const kanji = alias[1].trim();
      const entry: N5KanjiEntry = {
        id: kanji,
        index,
        kanji,
        readings: "",
        meaning: alias[3].trim(),
        mnemonic: "",
        components: "",
        example: "",
        aliasOf: alias[2],
        raw: raw.trim(),
      };
      byIndex.set(index, entry);
      return;
    }

    const header = title.match(/^(.+?)\s+—\s+(.+?)\s+—\s+(.+)$/);
    if (!header) return;
    const [, kanji, readings, meaning] = header;
    const bodyText = body.trim();
    const [mnemonicPart, examplePart = ""] = bodyText.split(/\s+→\s+/);
    const entry: N5KanjiEntry = {
      id: kanji.trim(),
      index,
      kanji: kanji.trim(),
      readings: readings.trim(),
      meaning: meaning.trim(),
      mnemonic: mnemonicPart.trim(),
      components: mnemonicPart.trim(),
      example: examplePart.trim(),
      raw: raw.trim(),
    };
    byIndex.set(index, entry);
  });

  byIndex.forEach((entry) => {
    if (!entry.aliasOf) return;
    const target = byIndex.get(Number(entry.aliasOf));
    if (!target) return;
    const resolved = {
      ...target,
      id: entry.kanji,
      index: entry.index,
      kanji: entry.kanji,
      aliasOf: entry.aliasOf,
      raw: entry.raw,
    };
    byIndex.set(entry.index, resolved);
    out[entry.kanji] = resolved;
  });

  const kanjiList = Array.from(byIndex.values()).sort((a, b) => a.index - b.index);
  kanjiList.forEach((entry) => {
    if (!out[entry.kanji]) out[entry.kanji] = entry;
  });

  return { kanji: out, kanjiList };
}

function parseDailyPlans(markdown: string): { days: N5DayPlan[]; checkpoints: N5Checkpoint[] } {
  const daySections = splitSections(markdown, /^## DAY\s+(\d+)\s+—\s+(.+)$/gm);
  const days = daySections.map(({ id, title, body, raw }) => {
    const fields = extractDayFields(body);
    return {
      day: Number(id),
      title: title.trim(),
      raw: raw.trim(),
      grammarText: fields.Grammar || "",
      vocabText: fields.Vocab || "",
      kanjiText: fields.Kanji || "",
      produceText: fields.Produce || "",
      ankiText: fields.Anki || "",
      grammarIds: Array.from((fields.Grammar || "").matchAll(/G\d{2}/g)).map((m) => m[0]),
      vocabRanges: parseVocabRanges(fields.Vocab || ""),
      kanjiChars: parseKanjiChars(fields.Kanji || ""),
      unresolvedKanjiChars: [],
      produceTasks: splitProduceTasks(fields.Produce || ""),
      extraLines: Object.entries(fields)
        .filter(([label]) => !["Grammar", "Vocab", "Kanji", "Produce", "Anki"].includes(label))
        .map(([label, text]) => ({ label, text })),
      grammar: [],
      vocab: [],
      kanji: [],
    } satisfies N5DayPlan;
  });

  const checkpoints = Array.from(markdown.matchAll(/### ★ CHECKPOINT\s+(\d+)\s+\(after Day\s+(\d+)\)([^\n]*)\n([\s\S]*?)(?=\n---|\n## DAY|\n### ★ CHECKPOINT|\n## After Day|\s*$)/g)).map((match) => {
    const [, id, afterDay, suffix, body] = match;
    const criteria = body
      .split(/\r?\n/)
      .filter((line) => line.trim().startsWith("- "))
      .map((line) => line.replace(/^- /, "").trim());
    return {
      id: `checkpoint-${id}`,
      afterDay: Number(afterDay),
      title: `Checkpoint ${id}${suffix.trim() ? ` ${suffix.trim()}` : ""}`,
      criteria,
      raw: match[0].trim(),
    };
  });

  return { days, checkpoints };
}

function resolveDay(
  day: N5DayPlan,
  grammar: Record<string, N5GrammarPoint>,
  vocab: Record<string, N5VocabEntry>,
  kanji: Record<string, N5KanjiEntry>
): N5DayPlan {
  const resolvedVocab = new Map<string, N5VocabEntry>();
  day.vocabRanges.forEach((range) => {
    for (let num = range.start; num <= range.end; num += 1) {
      const id = String(num).padStart(3, "0");
      if (vocab[id]) resolvedVocab.set(id, vocab[id]);
    }
  });

  return {
    ...day,
    grammar: day.grammarIds.map((id) => grammar[id]).filter(Boolean),
    vocab: Array.from(resolvedVocab.values()).sort((a, b) => a.number - b.number),
    kanji: day.kanjiChars.map((char) => kanji[char]).filter(Boolean),
    unresolvedKanjiChars: day.kanjiChars.filter((char) => !kanji[char]),
  };
}

function splitSections(
  markdown: string,
  headingPattern: RegExp
): Array<{ id: string; title: string; body: string; raw: string }> {
  const matches = Array.from(markdown.matchAll(headingPattern));
  return matches.map((match, index) => {
    const start = match.index || 0;
    const next = matches[index + 1]?.index ?? markdown.length;
    const raw = markdown.slice(start, next);
    const firstLineEnd = raw.indexOf("\n");
    const body = firstLineEnd >= 0 ? raw.slice(firstLineEnd + 1) : "";
    return {
      id: match[1],
      title: match[2],
      body,
      raw,
    };
  });
}

function extractBoldField(body: string, label: string): string {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = body.match(new RegExp(`\\*\\*${escaped}:\\*\\*\\s*([^\\n]+)`));
  return match?.[1]?.trim() || "";
}

function extractExamples(body: string): Array<{ raw: string; japanese: string; translation: string }> {
  const examplesBlock = body.match(/\*\*Examples:\*\*\n([\s\S]*?)(?=\n\*\*Common mistake:\*\*|\n##|\s*$)/)?.[1] || "";
  return examplesBlock
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => {
      const raw = line.replace(/^- /, "").trim();
      const [japanese, translation = ""] = raw.split(/\s*—\s*/);
      return { raw, japanese: japanese.trim(), translation: translation.trim() };
    });
}

function extractDayFields(body: string): Record<string, string> {
  const fields: Record<string, string> = {};
  body.split(/\r?\n/).forEach((line) => {
    const match = line.match(/^\*\*(.+?):\*\*\s*(.+)$/);
    if (match) fields[match[1].trim()] = match[2].trim();
  });
  return fields;
}

function parseVocabRanges(text: string): N5VocabRange[] {
  const normalized = text.replace(/[–—]/g, "-");
  const ranges: N5VocabRange[] = [];
  for (const match of normalized.matchAll(/(?:(Part)\s+(\d+),?\s*)?(review\s+)?(?:words\s+)?(\d{3})-(\d{3})/gi)) {
    const raw = match[0];
    ranges.push({
      part: match[2] ? Number(match[2]) : undefined,
      start: Number(match[4]),
      end: Number(match[5]),
      isReview: /review/i.test(raw) || /review/i.test(text.slice(Math.max(0, (match.index || 0) - 12), (match.index || 0) + raw.length + 12)),
      raw,
    });
  }
  return ranges;
}

function parseKanjiChars(text: string): string[] {
  if (!text || /review all|full 103 review/i.test(text)) return [];
  const beforeParen = text.split("(")[0].replace(/\[[^\]]+\]/g, " ");
  const chars = Array.from(beforeParen.matchAll(/\p{Script=Han}/gu)).map((match) => match[0]);
  return Array.from(new Set(chars));
}

function splitProduceTasks(text: string): string[] {
  if (!text.trim()) return [];
  const protectedText = text.replace(/。/g, "。\u0000");
  const parts = protectedText
    .split(/\s+(?:Then\s+|Practice\s+)/)
    .flatMap((part, index) => index === 0 ? [part] : [text.includes("Practice ") ? `Practice ${part}` : part])
    .map((part) => part.replace(/\u0000/g, "").trim())
    .filter(Boolean);
  return parts.length ? parts : [text.trim()];
}

function stableHash(input: string): string {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

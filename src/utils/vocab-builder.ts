import Kanji from "kanji.js";
import { KANJI_COMPONENTS, KANJI_COMPONENT_SOURCE_NOTICE, KANJI_DECOMPOSITIONS } from "../data/kanji-components.generated";
import {
  defaultVocabBuilderState,
  isV3CardDue,
  type AnkiCard,
  type AnkiCollection,
  type AnkiNote,
  type AnkiReviewLog,
  type JLPTLevel,
  type KanjiComponent,
  type KanjiDecomposition,
  type KnownComponentStatus,
  type VocabBuilderDailySession,
  type VocabBuilderState,
} from "./anki-v3";

export type VocabBuilderItemKind = "component" | "kanji" | "vocab";

export interface BuilderComponentRef extends KanjiComponent {
  status: KnownComponentStatus;
  isRadical: boolean;
  position?: string;
  original?: string;
}

export interface VocabBuilderItem {
  id: string;
  kind: VocabBuilderItemKind;
  level: JLPTLevel;
  title: string;
  subtitle: string;
  card?: AnkiCard;
  note?: AnkiNote;
  deckName?: string;
  noteTypeName?: string;
  templateName?: string;
  due: boolean;
  isNew: boolean;
  locked: boolean;
  lockedReason?: string;
  priority: number;
  kanji: string[];
  components: BuilderComponentRef[];
  radical?: BuilderComponentRef;
  decomposition?: KanjiDecomposition;
  readings?: string;
  meanings?: string;
  examples: string[];
  word?: string;
  reading?: string;
  pos?: string;
  additionalDefinitions?: string;
  audioFiles: string[];
  imageFiles: string[];
  mnemonic: string;
  practiceSentence?: string;
}

export interface VocabBuilderStats {
  knownComponents: number;
  hardComponents: number;
  unknownComponents: number;
  kanjiAnchors: number;
  vocabCards: number;
  dueReviews: number;
  levels: Record<JLPTLevel, number>;
}

export interface VocabBuilderIndex {
  sourceNotice: string;
  selectedGoal: JLPTLevel;
  includedLevels: JLPTLevel[];
  state: VocabBuilderState;
  currentItem?: VocabBuilderItem;
  queue: VocabBuilderItem[];
  componentPrimers: VocabBuilderItem[];
  kanjiAnchors: VocabBuilderItem[];
  vocabItems: VocabBuilderItem[];
  upcomingComponents: BuilderComponentRef[];
  stats: VocabBuilderStats;
}

export const JLPT_LEVELS: JLPTLevel[] = ["N5", "N4", "N3", "N2", "N1"];

const levelRank: Record<JLPTLevel, number> = {
  N5: 0,
  N4: 1,
  N3: 2,
  N2: 3,
  N1: 4,
};

const sceneBank = ["station", "konbini", "train", "classroom", "apartment", "cafe", "workplace", "Tokyo street"];

export function buildVocabBuilderIndex(collection: AnkiCollection): VocabBuilderIndex {
  const state = collection.vocabBuilder || defaultVocabBuilderState();
  const selectedGoal = state.selectedGoal || "N5";
  const includedLevels = includedJLPTLevels(selectedGoal);
  const allowedLevels = new Set(includedLevels);
  const deckById = new Map(collection.decks.map((deck) => [deck.id, deck]));
  const noteTypeById = new Map(collection.noteTypes.map((noteType) => [noteType.id, noteType]));
  const cardsByNote = groupCardsByNote(collection.cards);

  const kanjiAnchors: VocabBuilderItem[] = [];
  const vocabItems: VocabBuilderItem[] = [];

  for (const note of collection.notes) {
    const cards = cardsByNote.get(note.id) || [];
    if (cards.length === 0) continue;
    const noteTypeName = noteTypeById.get(note.noteTypeId)?.name || "";
    const firstDeckName = deckById.get(cards[0]?.deckId || "")?.name || "";
    const level = detectJLPTLevel(note, noteTypeName, firstDeckName);
    if (!level || !allowedLevels.has(level)) continue;

    if (isKanjiAnchorNote(note, noteTypeName)) {
      for (const card of cards) {
        if (shouldHideCard(card, state)) continue;
        kanjiAnchors.push(buildKanjiItem(note, card, level, state, deckById, noteTypeName));
      }
      continue;
    }

    if (isVocabularyNote(note, noteTypeName)) {
      for (const card of cards) {
        if (shouldHideCard(card, state)) continue;
        const item = buildVocabItem(note, card, level, state, deckById, noteTypeName, cards);
        vocabItems.push(item);
      }
    }
  }

  const upcomingComponents = collectUpcomingComponents([...kanjiAnchors, ...vocabItems], state);
  const componentPrimers = upcomingComponents.slice(0, 12).map((component, index) => buildComponentItem(component, selectedGoal, index));
  const dueReviews = [...kanjiAnchors, ...vocabItems]
    .filter((item) => item.due && !item.isNew)
    .sort(sortBuilderItems);
  const newKanji = kanjiAnchors.filter((item) => item.isNew && !item.locked).sort(sortBuilderItems);
  const newVocab = vocabItems.filter((item) => item.isNew && !item.locked).sort(sortBuilderItems);
  const learningQueue = [...dueReviews, ...componentPrimers, ...newKanji, ...newVocab].slice(0, 80);
  const currentItem = learningQueue.find((item) => item.card?.id === state.lastActiveCardId) || learningQueue[0];

  return {
    sourceNotice: KANJI_COMPONENT_SOURCE_NOTICE,
    selectedGoal,
    includedLevels,
    state,
    currentItem,
    queue: learningQueue,
    componentPrimers,
    kanjiAnchors,
    vocabItems,
    upcomingComponents,
    stats: buildStats(selectedGoal, state, kanjiAnchors, vocabItems, upcomingComponents),
  };
}

export function includedJLPTLevels(goal: JLPTLevel): JLPTLevel[] {
  return JLPT_LEVELS.filter((level) => levelRank[level] <= levelRank[goal]);
}

export function withBuilderGoal(collection: AnkiCollection, selectedGoal: JLPTLevel): AnkiCollection {
  return {
    ...collection,
    vocabBuilder: {
      ...(collection.vocabBuilder || defaultVocabBuilderState()),
      selectedGoal,
      lastActiveCardId: undefined,
    },
  };
}

export function withComponentStatus(collection: AnkiCollection, glyph: string, status: KnownComponentStatus): AnkiCollection {
  const current = collection.vocabBuilder || defaultVocabBuilderState();
  const existing = current.knownComponents[glyph];
  return {
    ...collection,
    vocabBuilder: {
      ...current,
      knownComponents: {
        ...current.knownComponents,
        [glyph]: {
          glyph,
          status,
          seenCount: (existing?.seenCount || 0) + (status === "seen" || status === "familiar" ? 1 : 0),
          hardCount: (existing?.hardCount || 0) + (status === "hard" ? 1 : 0),
          updatedAt: Date.now(),
        },
      },
      dailySession: bumpDailySession(current.dailySession, "introduced"),
    },
  };
}

export function withBuilderGrade(collection: AnkiCollection, card: AnkiCard, updatedCard: AnkiCard, log: AnkiReviewLog): AnkiCollection {
  const current = collection.vocabBuilder || defaultVocabBuilderState();
  return {
    ...collection,
    cards: collection.cards.map((item) => item.id === card.id ? updatedCard : item),
    reviewLogs: [log, ...collection.reviewLogs],
    vocabBuilder: {
      ...current,
      completedCardIds: Array.from(new Set([...current.completedCardIds, card.id])),
      lastActiveCardId: undefined,
      dailySession: bumpDailySession(current.dailySession, "reviewed"),
    },
  };
}

export function lookupKanjiDecomposition(kanji: string): KanjiDecomposition {
  return KANJI_DECOMPOSITIONS[kanji] || {
    kanji,
    components: [kanji],
    layout: [{ component: kanji }],
    source: "fallback",
  };
}

export function lookupKanjiComponent(glyph: string): KanjiComponent {
  const known = KANJI_COMPONENTS[glyph];
  if (known) return known;
  try {
    const details = Kanji.getDetails(glyph);
    if (details?.literal) {
      return {
        glyph,
        displayName: details.meanings?.[0] || "kanji",
        keyword: details.meanings?.[0] || "kanji",
        strokeCount: details.stroke_count || 0,
        variantGroup: glyph,
        source: "kanji.js",
      };
    }
  } catch {
    // Fall through to a plain visual chip.
  }
  return {
    glyph,
    displayName: "component",
    keyword: "component",
    strokeCount: 0,
    variantGroup: glyph,
    source: "fallback",
  };
}

export function kanjiFromText(input: string): string[] {
  return Array.from(new Set((plainText(input).match(/[\u3400-\u9fff]/gu) || [])));
}

export function displayComponentGlyph(glyph: string): string {
  return glyph.startsWith("CDP-") ? "component" : glyph;
}

function groupCardsByNote(cards: AnkiCard[]): Map<string, AnkiCard[]> {
  const out = new Map<string, AnkiCard[]>();
  for (const card of cards) {
    const existing = out.get(card.noteId) || [];
    existing.push(card);
    out.set(card.noteId, existing.sort((a, b) => a.ord - b.ord));
  }
  return out;
}

function shouldHideCard(card: AnkiCard, state: VocabBuilderState): boolean {
  return Boolean(card.suspended || (card.buriedUntil && card.buriedUntil > Date.now()) || state.skippedCardIds.includes(card.id));
}

function isKanjiAnchorNote(note: AnkiNote, noteTypeName: string): boolean {
  return /japanese kanji writing/i.test(noteTypeName) || Boolean(note.fields.Kanji && note.fields.Readings && note.fields.Meanings && note.fields.Examples);
}

function isVocabularyNote(note: AnkiNote, noteTypeName: string): boolean {
  return /core japanese vocabulary|ultimate layout/i.test(noteTypeName) || Boolean(note.fields.Expression || (note.fields.Kana && note.fields.English));
}

function detectJLPTLevel(note: AnkiNote, noteTypeName: string, deckName: string): JLPTLevel | undefined {
  const raw = `${note.tags.join(" ")} ${deckName} ${noteTypeName}`;
  const match = raw.match(/jlpt[_\s-]*n([1-5])/i);
  if (match) return `N${match[1]}` as JLPTLevel;
  if (/ultimate layout|japanese kanji writing/i.test(noteTypeName)) return "N5";
  return undefined;
}

function buildKanjiItem(
  note: AnkiNote,
  card: AnkiCard,
  level: JLPTLevel,
  state: VocabBuilderState,
  deckById: Map<string, { name: string }>,
  noteTypeName: string,
): VocabBuilderItem {
  const kanji = plainText(note.fields.Kanji || note.sortField || "").slice(0, 1);
  const components = componentRefsForKanji([kanji], state);
  const decomposition = lookupKanjiDecomposition(kanji);
  const meanings = plainText(note.fields.Meanings || "");
  const readings = plainText(note.fields.Readings || "");
  const examples = splitLines(note.fields.Examples || "");
  const item: VocabBuilderItem = {
    id: `kanji-${card.id}`,
    kind: "kanji",
    level,
    title: kanji || "Kanji",
    subtitle: [meanings, readings].filter(Boolean).join(" · "),
    card,
    note,
    deckName: deckById.get(card.deckId)?.name || "",
    noteTypeName,
    templateName: card.templateName,
    due: isV3CardDue(card),
    isNew: cardIsNew(card, state),
    locked: false,
    priority: 20 + levelRank[level],
    kanji: kanji ? [kanji] : [],
    components,
    radical: components.find((component) => component.isRadical),
    decomposition,
    readings,
    meanings,
    examples,
    audioFiles: soundFiles(note),
    imageFiles: imageFiles(note),
    mnemonic: "",
  };
  item.mnemonic = makeMnemonic(item);
  return item;
}

function buildVocabItem(
  note: AnkiNote,
  card: AnkiCard,
  level: JLPTLevel,
  state: VocabBuilderState,
  deckById: Map<string, { name: string }>,
  noteTypeName: string,
  siblingCards: AnkiCard[],
): VocabBuilderItem {
  const expression = note.fields.Expression || note.fields.Kanji || note.sortField || "";
  const word = normalizeWord(expression || note.fields.N5Kanji || "");
  const reading = plainText(note.fields.Reading || note.fields.Kana || "");
  const meanings = plainText(note.fields["English definition"] || note.fields.English || note.fields.Meanings || "");
  const additionalDefinitions = plainText(note.fields["Additional definitions"] || note.fields["2ndDef"] || note.fields.OtherDef || "");
  const pos = plainText(note.fields.Grammar || note.fields.POS || "");
  const kanji = kanjiFromText(`${expression} ${reading}`);
  const isRecall = /recall|reverse/i.test(card.templateName || "") || card.ord > 0;
  const learnedRecognition = siblingCards.some((sibling) => sibling.id !== card.id && sibling.ord < card.ord && !cardIsNew(sibling, state));
  const locked = isRecall && cardIsNew(card, state) && !learnedRecognition;
  const item: VocabBuilderItem = {
    id: `vocab-${card.id}`,
    kind: "vocab",
    level,
    title: word || reading || meanings || "Vocabulary",
    subtitle: [reading, meanings].filter(Boolean).join(" · "),
    card,
    note,
    deckName: deckById.get(card.deckId)?.name || "",
    noteTypeName,
    templateName: card.templateName,
    due: isV3CardDue(card),
    isNew: cardIsNew(card, state),
    locked,
    lockedReason: locked ? "Recognition first" : undefined,
    priority: (isRecall ? 45 : 40) + levelRank[level],
    kanji,
    components: componentRefsForKanji(kanji, state),
    meanings,
    examples: splitLines(note.fields.Examples || ""),
    word,
    reading,
    pos,
    additionalDefinitions,
    audioFiles: soundFiles(note),
    imageFiles: imageFiles(note),
    mnemonic: "",
    practiceSentence: "",
  };
  item.mnemonic = makeMnemonic(item);
  item.practiceSentence = makePracticeSentence(item);
  return item;
}

function buildComponentItem(component: BuilderComponentRef, level: JLPTLevel, index: number): VocabBuilderItem {
  const item: VocabBuilderItem = {
    id: `component-${component.glyph}`,
    kind: "component",
    level,
    title: displayComponentGlyph(component.glyph),
    subtitle: component.keyword,
    due: false,
    isNew: true,
    locked: false,
    priority: 10 + index / 100,
    kanji: [],
    components: [component],
    examples: [],
    audioFiles: [],
    imageFiles: [],
    mnemonic: "",
  };
  item.mnemonic = makeMnemonic(item);
  return item;
}

function collectUpcomingComponents(items: VocabBuilderItem[], state: VocabBuilderState): BuilderComponentRef[] {
  const byGlyph = new Map<string, BuilderComponentRef>();
  for (const item of items.sort(sortBuilderItems)) {
    if (!item.isNew && !item.due) continue;
    for (const component of item.components) {
      const status = state.knownComponents[component.glyph]?.status || "new";
      if (status === "familiar" || status === "ignored") continue;
      if (!byGlyph.has(component.glyph)) byGlyph.set(component.glyph, { ...component, status });
    }
  }
  return Array.from(byGlyph.values()).slice(0, 80);
}

function componentRefsForKanji(kanji: string[], state: VocabBuilderState): BuilderComponentRef[] {
  const refs = new Map<string, BuilderComponentRef>();
  for (const char of kanji) {
    const decomposition = lookupKanjiDecomposition(char);
    for (const layout of decomposition.layout.length ? decomposition.layout : [{ component: char }]) {
      const meta = lookupKanjiComponent(layout.component);
      const status = state.knownComponents[layout.component]?.status || "new";
      const existing = refs.get(layout.component);
      refs.set(layout.component, {
        ...meta,
        status,
        isRadical: existing?.isRadical || layout.component === decomposition.radical || Boolean(layout.radical),
        position: existing?.position || layout.position,
        original: existing?.original || layout.original,
      });
    }
  }
  return Array.from(refs.values());
}

function buildStats(goal: JLPTLevel, state: VocabBuilderState, kanjiItems: VocabBuilderItem[], vocabItems: VocabBuilderItem[], upcomingComponents: BuilderComponentRef[]): VocabBuilderStats {
  const levels = Object.fromEntries(JLPT_LEVELS.map((level) => [level, 0])) as Record<JLPTLevel, number>;
  for (const item of vocabItems) levels[item.level] += 1;
  const knownStates = Object.values(state.knownComponents);
  return {
    knownComponents: knownStates.filter((item) => item.status === "seen" || item.status === "familiar").length,
    hardComponents: knownStates.filter((item) => item.status === "hard").length,
    unknownComponents: upcomingComponents.length,
    kanjiAnchors: kanjiItems.filter((item) => includedJLPTLevels(goal).includes(item.level)).length,
    vocabCards: vocabItems.length,
    dueReviews: [...kanjiItems, ...vocabItems].filter((item) => item.due && !item.isNew).length,
    levels,
  };
}

function sortBuilderItems(a: VocabBuilderItem, b: VocabBuilderItem): number {
  const dueDelta = Number(b.due && !b.isNew) - Number(a.due && !a.isNew);
  if (dueDelta) return dueDelta;
  const priorityDelta = a.priority - b.priority;
  if (priorityDelta) return priorityDelta;
  const levelDelta = levelRank[a.level] - levelRank[b.level];
  if (levelDelta) return levelDelta;
  return a.title.localeCompare(b.title, "ja");
}

function cardIsNew(card: AnkiCard, state: VocabBuilderState): boolean {
  return !state.completedCardIds.includes(card.id) && (card.reps || card.fsrs?.reps || 0) === 0;
}

function soundFiles(note: AnkiNote): string[] {
  return Object.values(note.fields).flatMap((value) => Array.from(String(value).matchAll(/\[sound:([^\]]+)\]/gi)).map((match) => match[1]));
}

function imageFiles(note: AnkiNote): string[] {
  return Object.values(note.fields).flatMap((value) => Array.from(String(value).matchAll(/<img[^>]+src=["']([^"']+)["']/gi)).map((match) => match[1]));
}

function splitLines(input: string): string[] {
  return plainText(input.replace(/<br\s*\/?>/gi, "\n")).split(/\n+/).map((line) => line.trim()).filter(Boolean).slice(0, 6);
}

function normalizeWord(input: string): string {
  return plainText(input).replace(/^\(\d+\)\s*/, "").replace(/^~/, "～").trim();
}

function plainText(input: string): string {
  return String(input || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function makeMnemonic(item: VocabBuilderItem): string {
  const scene = sceneBank[Math.abs(hashString(item.title)) % sceneBank.length];
  if (item.kind === "component") {
    const component = item.components[0];
    return `At the ${scene}, keep ${displayComponentGlyph(component.glyph)} as a fast visual hook for ${component.keyword}.`;
  }
  if (item.kind === "kanji") {
    const componentWords = item.components.slice(0, 4).map((component) => component.keyword).join(" + ") || "the shape";
    return `Picture ${componentWords} coming together at the ${scene}; lock that image to ${item.meanings || item.title}.`;
  }
  const componentWords = item.components.slice(0, 3).map((component) => component.keyword).join(" + ");
  const anchor = componentWords ? `notice ${componentWords}, then ` : "";
  return `At the ${scene}, ${anchor}use ${item.word || item.title} for ${item.meanings || item.subtitle}.`;
}

function makePracticeSentence(item: VocabBuilderItem): string {
  const word = item.word || item.title;
  const pos = (item.pos || "").toLowerCase();
  if (/suf|suffix|pref|prefix/.test(pos) || /^[～~]/.test(word)) return `${word} + ____`;
  if (/verb|v[1-5]|vs|vi|vt/.test(pos)) return `${word}ことがあります。`;
  if (/i adjective|adj-i/.test(pos)) return `${word}です。`;
  if (/na adjective|adj-na/.test(pos)) return `${word}な人です。`;
  return `これは${word}です。`;
}

function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) - hash) + input.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

function bumpDailySession(current: VocabBuilderDailySession, key: "introduced" | "reviewed"): VocabBuilderDailySession {
  const today = new Date().toISOString().slice(0, 10);
  const base = current?.date === today ? current : { date: today, introduced: 0, reviewed: 0 };
  return { ...base, [key]: base[key] + 1 };
}

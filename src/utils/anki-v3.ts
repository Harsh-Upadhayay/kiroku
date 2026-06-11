import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  Rating,
  State,
  type Card as FSRSCard,
  type FSRSParameters,
  type Grade,
} from "ts-fsrs";
import { getSettingFromDB, initDB, saveSettingToDB } from "./db";

export interface AnkiCollection {
  id: string;
  name: string;
  createdAt: number;
  decks: AnkiDeck[];
  deckConfigs: AnkiDeckConfig[];
  noteTypes: AnkiNoteType[];
  notes: AnkiNote[];
  cards: AnkiCard[];
  reviewLogs: AnkiReviewLog[];
  mediaManifest: AnkiMediaRef[];
  importReports: AnkiImportReport[];
  filteredDecks: AnkiFilteredDeck[];
  schedulerPresets: AnkiSchedulerPreset[];
}

export interface AnkiDeck {
  id: string;
  name: string;
  parentId?: string;
  configId?: string;
  description?: string;
  dynamic?: boolean;
  mod?: number;
  usn?: number;
  raw?: Record<string, unknown>;
}

export interface AnkiDeckConfig {
  id: string;
  name: string;
  raw: Record<string, unknown>;
}

export interface AnkiNoteType {
  id: string;
  name: string;
  type: number;
  css: string;
  latexPre?: string;
  latexPost?: string;
  fields: AnkiField[];
  templates: AnkiTemplate[];
  raw?: Record<string, unknown>;
}

export interface AnkiField {
  name: string;
  ord: number;
  sticky?: boolean;
  rtl?: boolean;
  font?: string;
  size?: number;
  description?: string;
}

export interface AnkiTemplate {
  name: string;
  ord: number;
  qfmt: string;
  afmt: string;
  deckId?: string;
}

export interface AnkiNote {
  id: string;
  guid: string;
  noteTypeId: string;
  sortField?: string;
  tags: string[];
  fields: Record<string, string>;
  fieldOrder: string[];
  rawFields: string[];
  mod?: number;
  usn?: number;
}

export interface AnkiCard {
  id: string;
  noteId: string;
  deckId: string;
  ord: number;
  type: number;
  queue: number;
  due: number;
  interval: number;
  factor: number;
  reps: number;
  lapses: number;
  left?: number;
  originalDeckId?: string;
  flags?: number;
  data?: string;
  templateName?: string;
  front?: string;
  back?: string;
  suspended?: boolean;
  buriedUntil?: number;
  updatedAt?: number;
  fsrs?: AnkiFSRSState;
}

export interface AnkiFSRSState {
  due: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: State;
  last_review?: string;
}

export interface AnkiReviewLog {
  id: string;
  cardId: string;
  usn?: number;
  ease?: number;
  interval?: number;
  lastInterval?: number;
  factor?: number;
  time?: number;
  type?: number;
  rating?: Rating;
  state?: State;
  reviewedAt?: number;
  answerSeconds?: number;
  stability?: number;
  difficulty?: number;
}

export interface AnkiMediaRef {
  hash: string;
  fileName: string;
  entryName?: string;
  contentType: string;
  bytes: number;
}

export interface AnkiFilteredDeck {
  id: string;
  name: string;
  query: string;
  cardIds: string[];
  reschedule: boolean;
  createdAt: number;
}

export interface AnkiImportReport {
  importId: string;
  packageKind: string;
  warnings: string[];
  decks: number;
  deckConfigs: number;
  noteTypes: number;
  notes: number;
  cards: number;
  reviewLogs: number;
  mediaFiles: number;
  importedAt: number;
}

export interface AnkiSchedulerPreset {
  id: string;
  name: string;
  deckIds: string[];
  desiredRetention: number;
  maximumInterval: number;
  parameters: FSRSParameters;
  rescheduleOnChange: boolean;
}

interface ImportResponse {
  importId: string;
  collection: Omit<AnkiCollection, "mediaManifest" | "importReports" | "filteredDecks" | "schedulerPresets">;
  mediaManifest: AnkiMediaRef[];
  report: Omit<AnkiImportReport, "importId" | "importedAt">;
}

export interface RenderedAnkiCard {
  frontHTML: string;
  backHTML: string;
  css: string;
  note: AnkiNote;
  noteType: AnkiNoteType;
  template?: AnkiTemplate;
  mediaFiles: AnkiMediaRef[];
}

export type AnkiGrade = 1 | 2 | 3 | 4;

const COLLECTION_KEY = "anki_v3_collection";
const DEFAULT_PRESET_ID = "fsrs-default";

export function defaultSchedulerPreset(): AnkiSchedulerPreset {
  return {
    id: DEFAULT_PRESET_ID,
    name: "Default FSRS",
    deckIds: [],
    desiredRetention: 0.9,
    maximumInterval: 36500,
    parameters: generatorParameters({
      request_retention: 0.9,
      maximum_interval: 36500,
      enable_fuzz: true,
      enable_short_term: true,
    }),
    rescheduleOnChange: false,
  };
}

export function emptyCollection(): AnkiCollection {
  return {
    id: "anki-v3-local",
    name: "Kiroku Anki Collection",
    createdAt: Date.now(),
    decks: [],
    deckConfigs: [],
    noteTypes: [],
    notes: [],
    cards: [],
    reviewLogs: [],
    mediaManifest: [],
    importReports: [],
    filteredDecks: [],
    schedulerPresets: [defaultSchedulerPreset()],
  };
}

export async function getAnkiCollection(): Promise<AnkiCollection> {
  const stored = await getSettingFromDB<Partial<AnkiCollection> | null>(COLLECTION_KEY, null);
  return normalizeCollection(stored);
}

export async function saveAnkiCollection(collection: AnkiCollection): Promise<void> {
  await saveSettingToDB(COLLECTION_KEY, normalizeCollection(collection));
}

export function normalizeCollection(input?: Partial<AnkiCollection> | null): AnkiCollection {
  const fallback = emptyCollection();
  if (!input || typeof input !== "object") return fallback;
  return {
    ...fallback,
    ...input,
    decks: Array.isArray(input.decks) ? input.decks.map(normalizeDeck) : [],
    deckConfigs: Array.isArray(input.deckConfigs) ? input.deckConfigs : [],
    noteTypes: Array.isArray(input.noteTypes) ? input.noteTypes.map(normalizeNoteType) : [],
    notes: Array.isArray(input.notes) ? input.notes.map(normalizeNote) : [],
    cards: Array.isArray(input.cards) ? input.cards.map(normalizeCard) : [],
    reviewLogs: Array.isArray(input.reviewLogs) ? input.reviewLogs : [],
    mediaManifest: Array.isArray(input.mediaManifest) ? input.mediaManifest : [],
    importReports: Array.isArray(input.importReports) ? input.importReports : [],
    filteredDecks: Array.isArray(input.filteredDecks) ? input.filteredDecks : [],
    schedulerPresets: Array.isArray(input.schedulerPresets) && input.schedulerPresets.length
      ? input.schedulerPresets
      : [defaultSchedulerPreset()],
  };
}

function normalizeDeck(deck: Partial<AnkiDeck>): AnkiDeck {
  return { id: String(deck.id || `deck-${Date.now()}`), name: String(deck.name || "Imported Deck"), ...deck };
}

function normalizeNoteType(noteType: Partial<AnkiNoteType>): AnkiNoteType {
  return {
    id: String(noteType.id || `model-${Date.now()}`),
    name: String(noteType.name || "Imported Note"),
    type: Number(noteType.type || 0),
    css: String(noteType.css || ""),
    fields: Array.isArray(noteType.fields) ? noteType.fields.map((f, i) => ({ ...f, name: String(f.name || `Field ${i + 1}`), ord: Number(f.ord ?? i) })) : [],
    templates: Array.isArray(noteType.templates)
      ? noteType.templates.map((t, i) => ({ ...t, name: String(t.name || `Card ${i + 1}`), ord: Number(t.ord ?? i), qfmt: String(t.qfmt || ""), afmt: String(t.afmt || "") }))
      : [],
  };
}

function normalizeNote(note: Partial<AnkiNote>): AnkiNote {
  const rawFields = Array.isArray(note.rawFields) ? note.rawFields.map(String) : [];
  const fields = note.fields && typeof note.fields === "object" ? Object.fromEntries(Object.entries(note.fields).map(([k, v]) => [String(k), String(v ?? "")])) : {};
  return {
    id: String(note.id || `note-${Date.now()}`),
    guid: String(note.guid || ""),
    noteTypeId: String(note.noteTypeId || ""),
    tags: Array.isArray(note.tags) ? note.tags.map(String) : [],
    fields,
    fieldOrder: Array.isArray(note.fieldOrder) ? note.fieldOrder.map(String) : Object.keys(fields),
    rawFields,
    sortField: note.sortField,
    mod: note.mod,
    usn: note.usn,
  };
}

function normalizeCard(card: Partial<AnkiCard>): AnkiCard {
  return {
    id: String(card.id || `card-${Date.now()}`),
    noteId: String(card.noteId || ""),
    deckId: String(card.deckId || "1"),
    ord: Number(card.ord || 0),
    type: Number(card.type || 0),
    queue: Number(card.queue || 0),
    due: Number(card.due || 0),
    interval: Number(card.interval || 0),
    factor: Number(card.factor || 0),
    reps: Number(card.reps || 0),
    lapses: Number(card.lapses || 0),
    left: card.left,
    originalDeckId: card.originalDeckId,
    flags: Number(card.flags || 0),
    data: card.data,
    templateName: card.templateName,
    front: card.front,
    back: card.back,
    suspended: Boolean(card.suspended),
    buriedUntil: typeof card.buriedUntil === "number" ? card.buriedUntil : undefined,
    updatedAt: typeof card.updatedAt === "number" ? card.updatedAt : Date.now(),
    fsrs: card.fsrs,
  };
}

export async function importAnkiPackage(file: File): Promise<AnkiCollection> {
  const response = await fetch("/api/import-anki-package", {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: await file.arrayBuffer(),
  });
  if (!response.ok) {
    const errJson = await response.json().catch(() => ({}));
    throw new Error(errJson.error || `Server error: ${response.status}`);
  }
  const payload = await response.json();
  if (!payload.success || !payload.data?.collection) {
    throw new Error("Invalid Anki package import response.");
  }

  const imported = payload.data as ImportResponse;
  const current = await getAnkiCollection();
  const merged = mergeImportedCollection(current, imported);
  // Persist the parsed collection BEFORE caching media. Media is best-effort: a single
  // failed media fetch must never roll back an otherwise-successful deck import.
  await saveAnkiCollection(merged);
  const mediaResult = await cacheImportedMedia(imported.importId, imported.mediaManifest);
  if (mediaResult.failed > 0) {
    console.warn(`Anki import: ${mediaResult.failed}/${imported.mediaManifest.length} media files could not be cached.`);
  }
  return merged;
}

export function mergeImportedCollection(current: AnkiCollection, imported: ImportResponse): AnkiCollection {
  const report: AnkiImportReport = {
    ...imported.report,
    importId: imported.importId,
    importedAt: Date.now(),
  };
  return normalizeCollection({
    ...current,
    decks: mergeById(current.decks, imported.collection.decks),
    deckConfigs: mergeById(current.deckConfigs, imported.collection.deckConfigs),
    noteTypes: mergeById(current.noteTypes, imported.collection.noteTypes),
    notes: mergeById(current.notes, imported.collection.notes),
    cards: mergeById(current.cards, imported.collection.cards),
    reviewLogs: mergeById(current.reviewLogs, imported.collection.reviewLogs),
    mediaManifest: mergeById(current.mediaManifest, imported.mediaManifest, "hash"),
    importReports: [report, ...current.importReports].slice(0, 20),
  });
}

function mergeById<T extends Record<string, any>>(a: T[], b: T[], key = "id"): T[] {
  const map = new Map<string, T>();
  [...a, ...b].forEach((item) => map.set(String(item[key]), item));
  return Array.from(map.values());
}

async function cacheImportedMedia(
  importId: string,
  manifest: AnkiMediaRef[]
): Promise<{ cached: number; failed: number }> {
  let cached = 0;
  let failed = 0;
  // Best-effort, concurrency-limited. Firing every media GET at once (Promise.all over the
  // full manifest) exhausts browser connections on large decks and any single rejection
  // (net::ERR_FAILED) used to abort the whole import. Each item now fails independently.
  const CONCURRENCY = 6;
  let cursor = 0;
  const worker = async () => {
    while (cursor < manifest.length) {
      const media = manifest[cursor++];
      try {
        const existing = await getMediaBlob(media.hash);
        if (existing) { cached++; continue; }
        const response = await fetch(`/api/import-anki-package/${encodeURIComponent(importId)}/media/${media.hash}`);
        if (!response.ok) { failed++; continue; }
        const blob = await response.blob();
        await saveMediaBlob(media, blob);
        cached++;
      } catch {
        failed++;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, manifest.length) }, worker));
  return { cached, failed };
}

export async function saveMediaBlob(media: AnkiMediaRef, blob: Blob): Promise<void> {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("anki_media", "readwrite");
    tx.objectStore("anki_media").put({ ...media, blob, storedAt: Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getMediaBlob(hash: string): Promise<Blob | null> {
  const db = await initDB();
  return new Promise((resolve) => {
    const tx = db.transaction("anki_media", "readonly");
    const req = tx.objectStore("anki_media").get(hash);
    req.onsuccess = () => resolve(req.result?.blob || null);
    req.onerror = () => resolve(null);
  });
}

export async function buildMediaURLMap(manifest: AnkiMediaRef[]): Promise<Record<string, string>> {
  const entries = await Promise.all(manifest.map(async (media) => {
    const blob = await getMediaBlob(media.hash);
    if (!blob) return null;
    return [media.fileName, URL.createObjectURL(blob)] as const;
  }));
  return Object.fromEntries(entries.filter(Boolean) as [string, string][]);
}

export function renderAnkiCard(collection: AnkiCollection, card: AnkiCard, mediaUrls: Record<string, string> = {}): RenderedAnkiCard | null {
  const note = collection.notes.find((n) => n.id === card.noteId);
  if (!note) return null;
  const noteType = collection.noteTypes.find((m) => m.id === note.noteTypeId);
  if (!noteType) return null;
  const template = noteType.templates.find((t) => t.ord === card.ord) || noteType.templates[card.ord] || noteType.templates[0];
  if (!template) return null;
  const frontHTML = renderTemplate(template.qfmt, { collection, card, note, noteType, template, side: "front", mediaUrls });
  const frontSide = frontHTML;
  const backHTML = renderTemplate(template.afmt.replace(/\{\{FrontSide\}\}/g, frontSide), { collection, card, note, noteType, template, side: "back", mediaUrls });
  const mediaFiles = collection.mediaManifest.filter((m) => frontHTML.includes(m.fileName) || backHTML.includes(m.fileName));
  return {
    frontHTML,
    backHTML,
    css: sanitizeTemplateHTML(`<style>${noteType.css || ""}</style>`),
    note,
    noteType,
    template,
    mediaFiles,
  };
}

interface TemplateContext {
  collection: AnkiCollection;
  card: AnkiCard;
  note: AnkiNote;
  noteType: AnkiNoteType;
  template: AnkiTemplate;
  side: "front" | "back";
  mediaUrls: Record<string, string>;
}

function renderTemplate(template: string, context: TemplateContext): string {
  let output = template || "";
  output = renderConditionals(output, context.note, true);
  output = renderConditionals(output, context.note, false);
  output = output.replace(/\{\{Tags\}\}/g, escapeHTML(context.note.tags.join(" ")));
  output = output.replace(/\{\{Deck\}\}/g, escapeHTML(context.collection.decks.find((d) => d.id === context.card.deckId)?.name || ""));
  output = output.replace(/\{\{Subdeck\}\}/g, escapeHTML((context.collection.decks.find((d) => d.id === context.card.deckId)?.name || "").split("::").pop() || ""));
  output = output.replace(/\{\{Card\}\}/g, escapeHTML(context.template.name || ""));
  output = output.replace(/\{\{CardFlag\}\}/g, context.card.flags ? String(context.card.flags) : "");
  output = output.replace(/\{\{type:([^}]+)\}\}/g, (_match, field) => `<label class="kiroku-type-answer"><span>Type answer</span><input data-anki-type-field="${escapeAttr(field)}" disabled /></label>`);
  output = output.replace(/\{\{hint:([^}]+)\}\}/g, (_match, field) => {
    const value = fieldValue(context.note, field);
    return value ? `<details class="kiroku-hint"><summary>Hint</summary>${value}</details>` : "";
  });
  output = output.replace(/\{\{cloze(?:-only)?:([^}]+)\}\}/g, (_match, field) => renderCloze(fieldValue(context.note, field), context.card.ord + 1, context.side));
  output = output.replace(/\{\{([^}]+)\}\}/g, (_match, rawToken) => {
    const token = String(rawToken).trim();
    const parts = token.split(":");
    const field = parts.pop() || "";
    const filters = parts;
    return applyFilters(fieldValue(context.note, field), filters);
  });
  output = resolveMediaRefs(output, context.mediaUrls);
  return sanitizeTemplateHTML(output);
}

function renderConditionals(template: string, note: AnkiNote, positive: boolean): string {
  const marker = positive ? "#" : "^";
  const re = new RegExp(`\\{\\{\\${marker}([^}]+)\\}\\}([\\s\\S]*?)\\{\\{/\\1\\}\\}`, "g");
  return template.replace(re, (_match, field, body) => {
    const exists = fieldValue(note, field).trim() !== "";
    return positive === exists ? body : "";
  });
}

function fieldValue(note: AnkiNote, field: string): string {
  const clean = String(field || "").trim();
  return note.fields[clean] ?? "";
}

function applyFilters(value: string, filters: string[]): string {
  return filters.reduce((current, filter) => {
    switch (filter) {
      case "text":
        return stripHTML(current);
      case "furigana":
        return current.replace(/([^\s\[]+)\[([^\]]+)\]/g, "<ruby>$1<rt>$2</rt></ruby>");
      case "kana":
        return current.replace(/[^\[]+\[([^\]]+)\]/g, "$1");
      case "kanji":
        return current.replace(/([^\s\[]+)\[[^\]]+\]/g, "$1");
      default:
        return current;
    }
  }, value);
}

function renderCloze(value: string, ord: number, side: "front" | "back"): string {
  return value.replace(/\{\{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g, (_match, n, text, hint) => {
    if (Number(n) !== ord) return text;
    if (side === "back") return `<span class="cloze">${text}</span>`;
    return `<span class="cloze">[${hint || "..."}]</span>`;
  });
}

function resolveMediaRefs(html: string, mediaUrls: Record<string, string>): string {
  let output = html.replace(/\[sound:([^\]]+)\]/gi, (_match, fileName) => {
    const url = mediaUrls[fileName] || "";
    return url ? `<audio controls preload="none" src="${escapeAttr(url)}"></audio>` : `<span class="missing-media">[sound:${escapeHTML(fileName)}]</span>`;
  });
  output = output.replace(/(<(?:img|audio|video)\b[^>]*\s(?:src|poster)=["'])([^"']+)(["'][^>]*>)/gi, (_match, prefix, fileName, suffix) => {
    return `${prefix}${escapeAttr(mediaUrls[fileName] || fileName)}${suffix}`;
  });
  return output;
}

export function sanitizeTemplateHTML(input: string): string {
  return String(input || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/\son\w+=(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s(href|src)=["']javascript:[^"']*["']/gi, "");
}

export function stripHTML(input: string): string {
  const doc = document.createElement("div");
  doc.innerHTML = sanitizeTemplateHTML(input || "");
  return doc.textContent?.trim() || "";
}

function escapeHTML(input: string): string {
  return String(input).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[ch] || ch));
}

function escapeAttr(input: string): string {
  return escapeHTML(input).replace(/`/g, "&#96;");
}

export function ankiCardToFSRS(card: AnkiCard): FSRSCard {
  if (card.fsrs) {
    return {
      due: new Date(card.fsrs.due),
      stability: card.fsrs.stability,
      difficulty: card.fsrs.difficulty,
      elapsed_days: card.fsrs.elapsed_days,
      scheduled_days: card.fsrs.scheduled_days,
      learning_steps: card.fsrs.learning_steps,
      reps: card.fsrs.reps,
      lapses: card.fsrs.lapses,
      state: card.fsrs.state,
      last_review: card.fsrs.last_review ? new Date(card.fsrs.last_review) : undefined,
    };
  }
  const empty = createEmptyCard(new Date());
  return {
    ...empty,
    reps: card.reps || 0,
    lapses: card.lapses || 0,
    state: card.reps > 0 ? State.Review : State.New,
    due: card.due > 0 && card.due < 10000000000 ? new Date(card.due * 86400000) : new Date(),
  };
}

export function previewFSRS(card: AnkiCard, preset = defaultSchedulerPreset(), now = new Date()) {
  const scheduler = fsrs(preset.parameters);
  return scheduler.repeat(ankiCardToFSRS(card), now);
}

export function gradeAnkiCard(card: AnkiCard, grade: AnkiGrade, preset = defaultSchedulerPreset(), now = new Date(), answerSeconds = 0): { card: AnkiCard; log: AnkiReviewLog } {
  const scheduler = fsrs(preset.parameters);
  const result = scheduler.next(ankiCardToFSRS(card), now, grade as Grade);
  const next = result.card;
  const log = result.log;
  const updated: AnkiCard = {
    ...card,
    reps: next.reps,
    lapses: next.lapses,
    interval: next.scheduled_days,
    due: Math.floor(next.due.getTime() / 86400000),
    queue: next.state === State.New ? 0 : next.state === State.Review ? 2 : 1,
    type: next.state,
    updatedAt: now.getTime(),
    fsrs: {
      due: next.due.toISOString(),
      stability: next.stability,
      difficulty: next.difficulty,
      elapsed_days: next.elapsed_days,
      scheduled_days: next.scheduled_days,
      learning_steps: next.learning_steps,
      reps: next.reps,
      lapses: next.lapses,
      state: next.state,
      last_review: next.last_review?.toISOString(),
    },
  };
  return {
    card: updated,
    log: {
      id: `fsrs-${card.id}-${now.getTime()}-${grade}`,
      cardId: card.id,
      rating: log.rating,
      state: log.state,
      reviewedAt: now.getTime(),
      answerSeconds,
      interval: log.scheduled_days,
      stability: log.stability,
      difficulty: log.difficulty,
      type: log.state,
      ease: log.rating,
    },
  };
}

export function isV3CardDue(card: AnkiCard, now = Date.now()): boolean {
  if (card.suspended) return false;
  if (card.buriedUntil && card.buriedUntil > now) return false;
  if (card.fsrs?.due) return new Date(card.fsrs.due).getTime() <= now;
  return card.queue <= 0 || card.due <= Math.floor(now / 86400000);
}

export function cardSearchText(collection: AnkiCollection, card: AnkiCard): string {
  const note = collection.notes.find((n) => n.id === card.noteId);
  const deck = collection.decks.find((d) => d.id === card.deckId);
  return [
    deck?.name,
    card.templateName,
    card.front,
    card.back,
    note?.tags.join(" "),
    ...(note ? Object.entries(note.fields).flatMap(([k, v]) => [k, stripHTML(v)]) : []),
  ].filter(Boolean).join(" ").toLowerCase();
}

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
import {
  getSettingFromDB,
  initDB,
  saveSettingToDB,
  deleteSettingFromDB,
  currentUserScope,
  replaceAnkiStore,
  getAnkiStoreRecords,
  getAnkiRecordsByIds,
  upsertAnkiRecords,
  deleteAnkiRecordsByIds,
  putAnkiRecord,
  makeAnkiRecord,
  countAnkiStore,
  ANKI_CARDS_STORE,
  ANKI_NOTES_STORE,
  ANKI_REVLOGS_STORE,
} from "./db";
import { clientParseSupported, importApkgLocally } from "./apkg/client";

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
  importId?: string;
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

// DB v4 layout: the big arrays (cards/notes/reviewLogs) live in their own user-scoped object
// stores; everything else (decks, note types, media manifest, presets…) stays in a small
// settings blob under META_KEY. This lets a card review write one record instead of rewriting
// the whole collection.
const META_KEY = "anki_v3_meta";

// metaOf strips the big arrays out for the lightweight meta blob. assembleCollection is its
// inverse. Both are pure (no IndexedDB) so the split↔assemble round-trip is unit-testable.
export function metaOf(collection: AnkiCollection): AnkiCollection {
  return { ...collection, cards: [], notes: [], reviewLogs: [] };
}

export function assembleCollection(
  meta: Partial<AnkiCollection>,
  cards: AnkiCard[],
  notes: AnkiNote[],
  reviewLogs: AnkiReviewLog[]
): AnkiCollection {
  return normalizeCollection({ ...meta, cards, notes, reviewLogs });
}

async function writeAnkiCollectionStores(collection: AnkiCollection): Promise<void> {
  const user = currentUserScope();
  await Promise.all([
    replaceAnkiStore(ANKI_CARDS_STORE, user, collection.cards.map((c) => makeAnkiRecord(user, c.id, c))),
    replaceAnkiStore(ANKI_NOTES_STORE, user, collection.notes.map((n) => makeAnkiRecord(user, n.id, n))),
    replaceAnkiStore(ANKI_REVLOGS_STORE, user, collection.reviewLogs.map((l) => makeAnkiRecord(user, l.id, l))),
  ]);
}

export async function getAnkiCollection(): Promise<AnkiCollection> {
  const meta = await getSettingFromDB<Partial<AnkiCollection> | null>(META_KEY, null);
  if (meta) {
    const user = currentUserScope();
    const [cards, notes, reviewLogs] = await Promise.all([
      getAnkiStoreRecords<AnkiCard>(ANKI_CARDS_STORE, user),
      getAnkiStoreRecords<AnkiNote>(ANKI_NOTES_STORE, user),
      getAnkiStoreRecords<AnkiReviewLog>(ANKI_REVLOGS_STORE, user),
    ]);
    return assembleCollection(meta, cards, notes, reviewLogs);
  }
  // No meta yet: migrate from the legacy single-blob layout (DB ≤ v3) if it's present.
  const legacy = await getSettingFromDB<Partial<AnkiCollection> | null>(COLLECTION_KEY, null);
  if (legacy) return migrateLegacyCollection(legacy);
  return emptyCollection();
}

// One-time migration from the legacy `anki_v3_collection` blob to the normalized stores. The
// blob is the only copy of the data, so it is deleted ONLY after the new stores are verified to
// hold the same record counts; otherwise we roll back the partial meta and keep reading the
// blob on the next load.
async function migrateLegacyCollection(legacy: Partial<AnkiCollection>): Promise<AnkiCollection> {
  const collection = normalizeCollection(legacy);
  const user = currentUserScope();
  try {
    await writeAnkiCollectionStores(collection);
    await saveSettingToDB(META_KEY, metaOf(collection));
    const [cards, notes, logs] = await Promise.all([
      countAnkiStore(ANKI_CARDS_STORE, user),
      countAnkiStore(ANKI_NOTES_STORE, user),
      countAnkiStore(ANKI_REVLOGS_STORE, user),
    ]);
    if (cards === collection.cards.length && notes === collection.notes.length && logs === collection.reviewLogs.length) {
      await deleteSettingFromDB(COLLECTION_KEY);
    } else {
      console.error("Anki migration count mismatch; keeping legacy blob", { cards, notes, logs });
      await deleteSettingFromDB(META_KEY); // next load re-attempts migration from the intact blob
    }
  } catch (err) {
    console.error("Anki migration failed; keeping legacy blob", err);
  }
  return collection;
}

// Bulk save (import, structural edits, sync apply). Cheap per-record writes below handle the
// hot review path.
export async function saveAnkiCollection(collection: AnkiCollection): Promise<void> {
  await writeAnkiCollectionStores(collection);
  // A bulk write (import, deck delete, editor add) touches many records, so force the next sync
  // to be a full reseed rather than trying to delta-track every change.
  await saveSettingToDB(SEEDED_KEY, false);
  // Writing the meta blob triggers the autosave sync push (see saveSettingToDB).
  await saveSettingToDB(META_KEY, metaOf(collection));
}

// Incremental writes for the hot path: persist only the one card / one review log that changed,
// and record it as dirty so the next sync pushes just that record (delta sync).
export async function saveAnkiCard(card: AnkiCard): Promise<void> {
  await putAnkiRecord(ANKI_CARDS_STORE, currentUserScope(), card.id, card);
  await addDirty(DIRTY_CARDS_KEY, [card.id]);
}

export async function appendAnkiReviewLog(log: AnkiReviewLog): Promise<void> {
  await putAnkiRecord(ANKI_REVLOGS_STORE, currentUserScope(), log.id, log);
  await addDirty(DIRTY_LOGS_KEY, [log.id]);
}

// ---- Delta sync (Phase 4) ----
// The sync push sends only what changed since the last successful push, tracked as id sets in
// user-scoped settings keys (persisted so an un-pushed change survives a reload). The first
// push after upgrade is a full seed (SEEDED_KEY unset), which also seeds the server's per-record
// store from this device's already-migrated data.
const DIRTY_CARDS_KEY = "anki_dirty_card_ids";
const DIRTY_LOGS_KEY = "anki_dirty_revlog_ids";
const DELETED_CARDS_KEY = "anki_deleted_card_ids"; // tombstones to propagate
const SEEDED_KEY = "anki_sync_seeded_v4";

async function addDirty(key: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const current = await getSettingFromDB<string[]>(key, []);
  const next = Array.from(new Set([...current, ...ids]));
  await saveSettingToDB(key, next);
}

// Record card ids as deleted so the deletion propagates to the server and other devices instead
// of being resurrected by their copies. Also drops them from the dirty-cards set.
export async function markAnkiCardsDeleted(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await addDirty(DELETED_CARDS_KEY, ids);
  const dirty = await getSettingFromDB<string[]>(DIRTY_CARDS_KEY, []);
  const removed = new Set(ids);
  await saveSettingToDB(DIRTY_CARDS_KEY, dirty.filter((id) => !removed.has(id)));
}

export interface AnkiSyncDelta {
  meta: AnkiCollection;        // collection metadata (small)
  cards: AnkiCard[];           // changed (or all, when seeding) cards
  notes: AnkiNote[];
  reviewLogs: AnkiReviewLog[];
  deletedCardIds: string[];
  snapshot: { cardIds: string[]; logIds: string[]; deletedIds: string[]; full: boolean };
}

// Build the payload for a push. When not yet seeded, sends the full collection (and notes, so
// the server's note store is seeded too); otherwise just the dirty cards/logs. Returns null when
// there is no local Anki data at all, so a fresh device never clobbers the server.
export async function getAnkiSyncDelta(): Promise<AnkiSyncDelta | null> {
  const meta = await getSettingFromDB<Partial<AnkiCollection> | null>(META_KEY, null);
  const legacy = meta ? null : await getSettingFromDB<Partial<AnkiCollection> | null>(COLLECTION_KEY, null);
  if (!meta && !legacy) return null;

  const collection = await getAnkiCollection(); // also performs legacy migration if needed
  const user = currentUserScope();
  const seeded = await getSettingFromDB<boolean>(SEEDED_KEY, false);
  const deletedCardIds = await getSettingFromDB<string[]>(DELETED_CARDS_KEY, []);

  if (!seeded) {
    return {
      meta: metaOf(collection),
      cards: collection.cards,
      notes: collection.notes,
      reviewLogs: collection.reviewLogs,
      deletedCardIds,
      snapshot: { cardIds: collection.cards.map((c) => c.id), logIds: collection.reviewLogs.map((l) => l.id), deletedIds: deletedCardIds, full: true },
    };
  }

  const dirtyCardIds = await getSettingFromDB<string[]>(DIRTY_CARDS_KEY, []);
  const dirtyLogIds = await getSettingFromDB<string[]>(DIRTY_LOGS_KEY, []);
  const [cards, reviewLogs] = await Promise.all([
    getAnkiRecordsByIds<AnkiCard>(ANKI_CARDS_STORE, user, dirtyCardIds),
    getAnkiRecordsByIds<AnkiReviewLog>(ANKI_REVLOGS_STORE, user, dirtyLogIds),
  ]);
  return {
    meta: metaOf(collection),
    cards,
    notes: [], // notes only change on import/edit, which reseed; nothing to send incrementally
    reviewLogs,
    deletedCardIds,
    snapshot: { cardIds: dirtyCardIds, logIds: dirtyLogIds, deletedIds: deletedCardIds, full: false },
  };
}

// After a push succeeds, drop exactly the ids that were sent (not a blanket clear, so changes
// made during the in-flight push stay dirty) and mark the collection as seeded.
export async function commitAnkiSync(snapshot: AnkiSyncDelta["snapshot"]): Promise<void> {
  await saveSettingToDB(SEEDED_KEY, true);
  const subtract = async (key: string, sent: string[]) => {
    if (sent.length === 0) return;
    const current = await getSettingFromDB<string[]>(key, []);
    const sentSet = new Set(sent);
    await saveSettingToDB(key, current.filter((id) => !sentSet.has(id)));
  };
  await subtract(DIRTY_CARDS_KEY, snapshot.cardIds);
  await subtract(DIRTY_LOGS_KEY, snapshot.logIds);
  await subtract(DELETED_CARDS_KEY, snapshot.deletedIds); // server retains the tombstone durably
}

// Apply server records into the local stores incrementally (used on pull). Does not clear the
// stores or trigger a push, so a 10k-card collection isn't rewritten wholesale on every sync.
export async function applyAnkiRemote(state: {
  anki_v3_collection?: Partial<AnkiCollection> | null;
  anki_cards_list?: AnkiCard[];
  anki_notes_list?: AnkiNote[];
  anki_revlogs_list?: AnkiReviewLog[];
  deleted_card_ids?: string[];
}): Promise<void> {
  const user = currentUserScope();
  if (state.anki_v3_collection) {
    await saveSettingToDB(META_KEY, metaOf(normalizeCollection(state.anki_v3_collection)));
  }
  await Promise.all([
    upsertAnkiRecords(ANKI_CARDS_STORE, user, (state.anki_cards_list || []).map((c) => makeAnkiRecord(user, c.id, c))),
    upsertAnkiRecords(ANKI_NOTES_STORE, user, (state.anki_notes_list || []).map((n) => makeAnkiRecord(user, n.id, n))),
    upsertAnkiRecords(ANKI_REVLOGS_STORE, user, (state.anki_revlogs_list || []).map((l) => makeAnkiRecord(user, l.id, l))),
  ]);
  await deleteAnkiRecordsByIds(ANKI_CARDS_STORE, user, state.deleted_card_ids || []);
  // Only mark seeded when the server actually had an Anki collection to give us. An empty pull
  // (fresh account, server has nothing yet) must NOT flip seeded — otherwise the next push takes
  // the delta path and a locally-imported collection the server has never seen is never uploaded
  // (its cards aren't individually dirty). This previously broke sync for large decks, whose slow
  // import let a reconcile pull mark seeded before the full-seed push could run.
  if (state.anki_v3_collection) {
    await saveSettingToDB(SEEDED_KEY, true);
  }
}

// Used by the sync collector. Returns null when there is no local Anki data at all, so a fresh
// device never pushes an empty collection that would clobber the server's real data.
export async function getAnkiCollectionForSync(): Promise<AnkiCollection | null> {
  const meta = await getSettingFromDB<Partial<AnkiCollection> | null>(META_KEY, null);
  const legacy = meta ? null : await getSettingFromDB<Partial<AnkiCollection> | null>(COLLECTION_KEY, null);
  if (!meta && !legacy) return null;
  return getAnkiCollection();
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

// Chunked upload tuning. The deck is sent as a sequence of fixed-size requests so each one
// stays well under proxy request-size caps (e.g. Cloudflare's 100 MB), which a single
// whole-file POST of a large .apkg would exceed.
const UPLOAD_CHUNK_SIZE = 10 * 1024 * 1024; // 10 MB per request.
const UPLOAD_CONCURRENCY = 3;
const UPLOAD_CHUNK_RETRIES = 3;

interface UploadInitResponse {
  uploadId: string;
  receivedChunks: number[];
}

// Parsing a large deck on the server can take longer than Cloudflare's ~100s proxy timeout, so
// /complete only enqueues the parse and the client polls this status until the deck is ready.
interface UploadStatusResponse {
  status: "pending" | "done" | "error";
  result?: ImportResponse;
  error?: string;
}

// How often, and for how long, to poll the import-status endpoint. The cap is generous: a very
// large deck can take minutes to parse, and the only cost of waiting is a spinner.
const IMPORT_POLL_INTERVAL_MS = 2000;
const IMPORT_POLL_TIMEOUT_MS = 30 * 60 * 1000; // 30 min, matching the server's job TTL.

// fileFingerprint identifies a file across page reloads so an interrupted upload resumes
// instead of restarting. The server matches it to a stored session and reports which chunks
// it already has.
function fileFingerprint(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

async function uploadChunkWithRetry(uploadId: string, index: number, file: File): Promise<void> {
  const start = index * UPLOAD_CHUNK_SIZE;
  const blob = file.slice(start, Math.min(start + UPLOAD_CHUNK_SIZE, file.size));
  let lastError: unknown;
  for (let attempt = 0; attempt < UPLOAD_CHUNK_RETRIES; attempt++) {
    try {
      const response = await fetch(
        `/api/import-anki-package/upload/${encodeURIComponent(uploadId)}/chunk/${index}`,
        { method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: blob }
      );
      if (response.ok) return;
      lastError = new Error(`Chunk ${index} upload failed: ${response.status}`);
    } catch (err) {
      lastError = err;
    }
    // Linear backoff before retrying a transient network/server failure.
    await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
  }
  throw lastError instanceof Error ? lastError : new Error(`Chunk ${index} upload failed`);
}

// uploadAnkiPackageChunked sends the file as 10 MB chunks (init → chunks → complete) and
// returns the parsed import payload. It resumes from whatever chunks the server already holds
// and uploads the rest with bounded concurrency and per-chunk retries. onProgress, if given,
// is called with the upload fraction (0–1) as chunks land, including any already on the server.
async function uploadAnkiPackageChunked(
  file: File,
  onProgress?: (fraction: number) => void
): Promise<ImportResponse> {
  const totalChunks = Math.max(1, Math.ceil(file.size / UPLOAD_CHUNK_SIZE));

  const initResponse = await fetch("/api/import-anki-package/upload/init", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fingerprint: fileFingerprint(file),
      fileName: file.name,
      totalSize: file.size,
      totalChunks,
      chunkSize: UPLOAD_CHUNK_SIZE,
    }),
  });
  if (!initResponse.ok) {
    const errJson = await initResponse.json().catch(() => ({}));
    throw new Error(errJson.error || `Server error: ${initResponse.status}`);
  }
  const initPayload = await initResponse.json();
  const init = initPayload.data as UploadInitResponse | undefined;
  if (!initPayload.success || !init?.uploadId) {
    throw new Error("Failed to start Anki package upload.");
  }

  const have = new Set(init.receivedChunks ?? []);
  const pending: number[] = [];
  for (let i = 0; i < totalChunks; i++) {
    if (!have.has(i)) pending.push(i);
  }

  // Chunks already on the server (from a resumed upload) count as done immediately.
  let completed = have.size;
  const reportProgress = () => onProgress?.(completed / totalChunks);
  reportProgress();

  // Concurrency-limited worker pool, mirroring cacheImportedMedia below: a fixed number of
  // workers drain a shared cursor so we never open more than UPLOAD_CONCURRENCY connections.
  let cursor = 0;
  const worker = async () => {
    while (cursor < pending.length) {
      await uploadChunkWithRetry(init.uploadId, pending[cursor++], file);
      completed++;
      reportProgress();
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(UPLOAD_CONCURRENCY, pending.length) }, worker)
  );

  // Enqueue the parse. This returns immediately (202) with the job pending; the server parses in
  // the background so a slow deck no longer holds the request open past the proxy timeout.
  const completeResponse = await fetch(
    `/api/import-anki-package/upload/${encodeURIComponent(init.uploadId)}/complete`,
    { method: "POST" }
  );
  if (!completeResponse.ok) {
    const errJson = await completeResponse.json().catch(() => ({}));
    throw new Error(errJson.error || `Server error: ${completeResponse.status}`);
  }

  return pollImportStatus(init.uploadId);
}

// pollImportStatus waits for a background parse to finish, returning the parsed payload. On
// failure it throws the server's message; the upload session is left intact on the server, so
// re-running the import resumes from the chunks already uploaded rather than starting over.
async function pollImportStatus(uploadId: string): Promise<ImportResponse> {
  const deadline = Date.now() + IMPORT_POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, IMPORT_POLL_INTERVAL_MS));
    const response = await fetch(
      `/api/import-anki-package/upload/${encodeURIComponent(uploadId)}/status`
    );
    if (!response.ok) {
      const errJson = await response.json().catch(() => ({}));
      throw new Error(errJson.error || `Server error: ${response.status}`);
    }
    const payload = await response.json();
    const status = payload.data as UploadStatusResponse | undefined;
    if (!payload.success || !status) {
      throw new Error("Invalid import status response.");
    }
    if (status.status === "error") {
      throw new Error(status.error || "Anki package import failed on the server.");
    }
    if (status.status === "done") {
      if (!status.result?.collection) {
        throw new Error("Invalid Anki package import response.");
      }
      return status.result;
    }
  }
  throw new Error("Anki package import timed out while the server was parsing the deck.");
}

// Client-side parsing is the default import path: the .apkg is parsed in a Web Worker and
// only the media blobs the server lacks are uploaded — no more shipping the whole archive up
// just to download the parsed result back. The chunked-upload/server-parse path below remains
// as the automatic fallback for any client-parse failure (old browser, WASM out-of-memory on
// a giant deck, malformed archive) and can be forced off via the localStorage flag.
const CLIENT_PARSE_FLAG = "myanki:clientParse";

function clientParseEnabled(): boolean {
  if (!clientParseSupported()) return false;
  try {
    const value = localStorage.getItem(CLIENT_PARSE_FLAG);
    if (value !== null) return value !== "0" && value !== "false";
  } catch {
    // Storage can be unavailable (private mode); treat as unset.
  }
  return true;
}

export interface PendingMediaTransfer {
  file: File;
  manifest: AnkiMediaRef[];
}

export interface ImportOutcome {
  collection: AnkiCollection;
  /**
   * Set only after a client-side parse that found media to move. The legacy server-parse
   * path already persisted media to the cloud store as a side effect of the server doing the
   * parsing, so there's nothing left for the caller to transfer. When present, the caller
   * (see MediaTransferPanel.tsx) drives getting this media to the user's other devices —
   * P2P first, cloud upload only if no peer answers.
   */
  pendingMediaTransfer?: PendingMediaTransfer;
}

export async function importAnkiPackage(
  file: File,
  onProgress?: (fraction: number) => void
): Promise<ImportOutcome> {
  let imported: ImportResponse;
  let clientParsed = false;
  if (clientParseEnabled()) {
    try {
      imported = (await importApkgLocally(file, onProgress)) as unknown as ImportResponse;
      clientParsed = true;
    } catch (err) {
      console.warn("[anki] client-side parse failed, falling back to server import:", err);
      imported = await uploadAnkiPackageChunked(file, onProgress);
    }
  } else {
    imported = await uploadAnkiPackageChunked(file, onProgress);
  }
  const current = await getAnkiCollection();
  const merged = mergeImportedCollection(current, imported);
  await saveAnkiCollection(merged);
  return {
    collection: merged,
    pendingMediaTransfer:
      clientParsed && imported.mediaManifest.length > 0 ? { file, manifest: imported.mediaManifest } : undefined,
  };
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
    mediaManifest: mergeById(
      current.mediaManifest,
      imported.mediaManifest.map((m) => ({ ...m, importId: imported.importId })),
      "hash"
    ),
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
  manifest: AnkiMediaRef[],
  onProgress?: (processed: number, total: number) => void
): Promise<{ cached: number; failed: number }> {
  let cached = 0;
  let failed = 0;
  // Best-effort, concurrency-limited. Firing every media GET at once (Promise.all over the
  // full manifest) exhausts browser connections on large decks and any single rejection
  // (net::ERR_FAILED) used to abort the whole import. Each item now fails independently.
  const CONCURRENCY = 6;
  let cursor = 0;
  const total = manifest.length;
  const worker = async () => {
    while (cursor < manifest.length) {
      const media = manifest[cursor++];
      try {
        const existing = await getMediaBlob(media.hash);
        if (existing) { cached++; continue; }
        const blob = await fetchImportedMediaBlob({ ...media, importId });
        if (!blob) { failed++; continue; }
        await saveMediaBlob(media, blob);
        cached++;
      } catch {
        failed++;
      } finally {
        onProgress?.(cached + failed, total);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, manifest.length) }, worker));
  return { cached, failed };
}

// ---------------------------------------------------------------------------
// Media cache: 50 MB LRU cap backed by a lightweight settings key for meta.
// Blobs live in the anki_media IndexedDB store; eviction decisions read only
// the meta key (hash → {bytes, lastAccessedAt}) to avoid loading all blobs.
// ---------------------------------------------------------------------------

const MEDIA_CACHE_LIMIT = 50 * 1024 * 1024; // 50 MB
const MEDIA_META_KEY = "anki_media_lru_meta";

type MediaMeta = Record<string, { bytes: number; lastAccessedAt: number }>;

async function readMediaMeta(): Promise<MediaMeta> {
  return (await getSettingFromDB<MediaMeta>(MEDIA_META_KEY, {})) ?? {};
}

async function writeMediaMeta(meta: MediaMeta): Promise<void> {
  await saveSettingToDB(MEDIA_META_KEY, meta);
}

async function touchMediaMeta(hash: string): Promise<void> {
  const meta = await readMediaMeta();
  if (meta[hash]) {
    meta[hash].lastAccessedAt = Date.now();
    await writeMediaMeta(meta);
  }
}

async function deleteMediaBlob(hash: string): Promise<void> {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("anki_media", "readwrite");
    tx.objectStore("anki_media").delete(hash);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function enforceMediaCacheLimit(): Promise<void> {
  const meta = await readMediaMeta();
  const entries = Object.entries(meta);
  const total = entries.reduce((s, [, v]) => s + v.bytes, 0);
  if (total <= MEDIA_CACHE_LIMIT) return;
  entries.sort(([, a], [, b]) => a.lastAccessedAt - b.lastAccessedAt);
  let running = total;
  for (const [hash, { bytes }] of entries) {
    if (running <= MEDIA_CACHE_LIMIT) break;
    await deleteMediaBlob(hash);
    delete meta[hash];
    running -= bytes;
  }
  await writeMediaMeta(meta);
}

export async function saveMediaBlob(media: AnkiMediaRef, blob: Blob): Promise<void> {
  const now = Date.now();
  const db = await initDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("anki_media", "readwrite");
    tx.objectStore("anki_media").put({ ...media, blob, storedAt: now });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  const meta = await readMediaMeta();
  meta[media.hash] = { bytes: media.bytes, lastAccessedAt: now };
  await writeMediaMeta(meta);
  await enforceMediaCacheLimit();
}

// Cache-only lookup — updates LRU timestamp on hit, never fetches from API.
export async function getMediaBlob(hash: string): Promise<Blob | null> {
  const db = await initDB();
  const record: { blob: Blob } | undefined = await new Promise((resolve) => {
    const tx = db.transaction("anki_media", "readonly");
    const req = tx.objectStore("anki_media").get(hash);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(undefined);
  });
  if (record?.blob) {
    void touchMediaMeta(hash);
    return record.blob;
  }
  return null;
}

// Fetch a media blob from the server. Tries the import-scoped endpoint first (warm in-memory
// cache, right after an import), then falls back to the durable, content-addressed store at
// /api/media/{hash}. The fallback is what makes media work on a *second* device — and on the
// importing device after the import's in-memory cache TTL expires — once the importing device's
// server persisted the blob to disk. Returns null only if neither source has it.
async function fetchImportedMediaBlob(media: AnkiMediaRef): Promise<Blob | null> {
  if (media.importId) {
    try {
      const res = await fetch(`/api/import-anki-package/media/${encodeURIComponent(media.importId)}/${media.hash}`);
      if (res.ok) return await res.blob();
    } catch {
      // fall through to the durable store
    }
  }
  try {
    const res = await fetch(`/api/media/${media.hash}`);
    if (res.ok) return await res.blob();
  } catch {
    // give up below
  }
  return null;
}

// Cache + API fallback — used for per-card lazy loading.
async function resolveMediaBlob(media: AnkiMediaRef): Promise<Blob | null> {
  const cached = await getMediaBlob(media.hash);
  if (cached) return cached;
  const blob = await fetchImportedMediaBlob(media);
  if (!blob) return null;
  await saveMediaBlob(media, blob);
  return blob;
}

// Build URL map from locally cached blobs only (fast, no network).
export async function buildMediaURLMap(manifest: AnkiMediaRef[]): Promise<Record<string, string>> {
  const entries = await Promise.all(manifest.map(async (media) => {
    const blob = await getMediaBlob(media.hash);
    if (!blob) return null;
    return [media.fileName, URL.createObjectURL(blob)] as const;
  }));
  return Object.fromEntries(entries.filter(Boolean) as [string, string][]);
}

// Resolve missing media for a specific card's files, fetching from API as needed.
export async function resolveCardMedia(mediaFiles: AnkiMediaRef[]): Promise<Record<string, string>> {
  const entries = await Promise.all(mediaFiles.map(async (media) => {
    const blob = await resolveMediaBlob(media);
    if (!blob) return null;
    return [media.fileName, URL.createObjectURL(blob)] as const;
  }));
  return Object.fromEntries(entries.filter(Boolean) as [string, string][]);
}

// CollectionIndex turns the collection's flat arrays into id→record lookups. Render and search
// paths run per-card over thousands of items, so the old linear `.find()` calls were O(n) each
// (O(n²) across a list). Build this once per collection (memoized) and thread it through.
export interface CollectionIndex {
  cardsById: Map<string, AnkiCard>;
  notesById: Map<string, AnkiNote>;
  noteTypesById: Map<string, AnkiNoteType>;
  decksById: Map<string, AnkiDeck>;
}

export function buildCollectionIndex(collection: AnkiCollection): CollectionIndex {
  return {
    cardsById: new Map(collection.cards.map((c) => [c.id, c])),
    notesById: new Map(collection.notes.map((n) => [n.id, n])),
    noteTypesById: new Map(collection.noteTypes.map((m) => [m.id, m])),
    decksById: new Map(collection.decks.map((d) => [d.id, d])),
  };
}

export function renderAnkiCard(collection: AnkiCollection, card: AnkiCard, mediaUrls: Record<string, string> = {}, index?: CollectionIndex): RenderedAnkiCard | null {
  const note = index ? index.notesById.get(card.noteId) : collection.notes.find((n) => n.id === card.noteId);
  if (!note) return null;
  const noteType = index ? index.noteTypesById.get(note.noteTypeId) : collection.noteTypes.find((m) => m.id === note.noteTypeId);
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
    css: sanitizeTemplateHTML(`<style>${resolveCSSMediaRefs(noteType.css || "", mediaUrls)}</style>`),
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
    // Until the blob URL resolves (media now loads lazily per card), render a compact, styled
    // placeholder rather than the raw "[sound:<hash>.mp3]" tag — that leaked the internal
    // filename and overflowed the card at prose font size on every audio card.
    // The filename is retained in data-anki-audio (not shown to the user) so the lazy-media
    // detector in renderAnkiCard — which finds a card's media by scanning the rendered HTML for
    // each manifest filename — still recognises this clip and fetches it. Dropping the filename
    // here would silently disable audio loading on every card.
    return url
      ? `<audio controls preload="none" src="${escapeAttr(url)}"></audio>`
      : `<span class="kiroku-audio-pending" role="img" aria-label="Audio loading" data-anki-audio="${escapeAttr(fileName)}">🔈</span>`;
  });
  output = output.replace(/(<(?:img|audio|video)\b[^>]*\s(?:src|poster)=["'])([^"']+)(["'][^>]*>)/gi, (_match, prefix, fileName, suffix) => {
    return `${prefix}${escapeAttr(mediaUrls[fileName] || fileName)}${suffix}`;
  });
  return output;
}

// resolveCSSMediaRefs rewrites url(...) references in note-type CSS (e.g. @font-face fonts or
// background images packaged with the deck) to their imported blob URLs, so embedded media
// declared in CSS renders just like media referenced from card HTML.
function resolveCSSMediaRefs(css: string, mediaUrls: Record<string, string>): string {
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (match, _quote, ref) => {
    const fileName = String(ref).trim();
    // Leave already-resolved or external references (data:, blob:, http(s):, //) untouched.
    if (/^(data:|blob:|https?:|\/\/)/i.test(fileName)) return match;
    const url = mediaUrls[fileName] || mediaUrls[decodeURIComponent(fileName)];
    return url ? `url("${escapeAttr(url)}")` : match;
  });
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

// ankiStudyRank groups a card the way Anki's v3 scheduler gathers a deck's queue: due
// intraday learning first, then due reviews, then new cards, then everything not yet due
// (including suspended/buried). Lower ranks are shown first.
export function ankiStudyRank(card: AnkiCard, now = Date.now()): number {
  if (card.suspended) return 3;
  if (card.buriedUntil && card.buriedUntil > now) return 3;
  const state = card.fsrs?.state ?? card.type;
  const isLearning = state === State.Learning || state === State.Relearning || card.queue === 1 || card.queue === 3;
  const isNew = state === State.New || card.queue === 0;
  if (isLearning && isV3CardDue(card, now)) return 0;
  if (!isNew && isV3CardDue(card, now)) return 1;
  if (isNew) return 2;
  return 3;
}

// dueSortValue is the timestamp a card next becomes due, used to order cards within the
// learning and review groups.
function dueSortValue(card: AnkiCard): number {
  if (card.fsrs?.due) return new Date(card.fsrs.due).getTime();
  return card.due;
}

// compareCardIds compares Anki's numeric card ids (creation epoch ms), falling back to a
// string compare for our synthetic non-numeric ids ("card-...").
function compareCardIds(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  return a < b ? -1 : a > b ? 1 : 0;
}

// compareAnkiStudyOrder orders cards to match the sequence the official Anki app presents.
// The key fix over raw import (SQLite rowid) order: new cards are sorted by their authored
// position (the `due` field), which is the learner-friendly teaching sequence shared decks
// rely on, with the template ordinal and card id as stable tie-breakers.
export function compareAnkiStudyOrder(a: AnkiCard, b: AnkiCard, now = Date.now()): number {
  const ra = ankiStudyRank(a, now);
  const rb = ankiStudyRank(b, now);
  if (ra !== rb) return ra - rb;
  if (ra === 2) {
    return (a.due - b.due) || ((a.ord || 0) - (b.ord || 0)) || compareCardIds(a.id, b.id);
  }
  return (dueSortValue(a) - dueSortValue(b)) || compareCardIds(a.id, b.id);
}

// orderCardsForStudy returns a new array sorted into Anki's study order (see
// compareAnkiStudyOrder). It does not mutate the input.
export function orderCardsForStudy(cards: AnkiCard[], now = Date.now()): AnkiCard[] {
  return [...cards].sort((a, b) => compareAnkiStudyOrder(a, b, now));
}

// firstDeckWithCards returns the id of the first deck that actually contains cards, so callers
// can default-select a meaningful deck instead of Anki's built-in (and usually empty) "Default"
// deck — which would otherwise make the review view and the "due now" count read as empty right
// after importing a populated package. Falls back to the first deck, then to "".
export function firstDeckWithCards(collection: AnkiCollection): string {
  const deckIdsWithCards = new Set(collection.cards.map((card) => card.deckId));
  const deck = collection.decks.find((d) => deckIdsWithCards.has(d.id));
  return deck?.id || collection.decks[0]?.id || "";
}

export function isV3CardDue(card: AnkiCard, now = Date.now()): boolean {
  if (card.suspended) return false;
  if (card.buriedUntil && card.buriedUntil > now) return false;
  if (card.fsrs?.due) return new Date(card.fsrs.due).getTime() <= now;
  return card.queue <= 0 || card.due <= Math.floor(now / 86400000);
}

export function cardSearchText(collection: AnkiCollection, card: AnkiCard, index?: CollectionIndex): string {
  const note = index ? index.notesById.get(card.noteId) : collection.notes.find((n) => n.id === card.noteId);
  const deck = index ? index.decksById.get(card.deckId) : collection.decks.find((d) => d.id === card.deckId);
  return [
    deck?.name,
    card.templateName,
    card.front,
    card.back,
    note?.tags.join(" "),
    ...(note ? Object.entries(note.fields).flatMap(([k, v]) => [k, stripHTML(v)]) : []),
  ].filter(Boolean).join(" ").toLowerCase();
}

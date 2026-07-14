import { getAllCardsFromDB, saveAllCardsToDB, getSettingFromDB, saveSettingToDB, setSyncRequestSuppressed } from "./db";
import { DEFAULT_ACTIVE_GROUP_IDS } from "../types";
import { normalizeActiveRows, normalizeSRSCards } from "./srs";
import { n5Course } from "../content/n5/raw";
import { normalizeN5Cards, normalizeN5Progress, type N5CourseProgress, type N5SRSCard } from "./n5-course";
import { normalizeLookupCards, type LookupCard } from "./lookup-deck";
import { normalizeVocabWords, type VocabWord } from "./vocab-words";
import { getAnkiSyncDelta, commitAnkiSync, applyAnkiRemote, type AnkiSyncDelta } from "./anki-v3";

// Snapshot of the Anki ids included in the in-flight push, so we can clear exactly those from
// the dirty sets once the server confirms (changes made mid-push stay dirty).
let pendingAnkiSnapshot: AnkiSyncDelta["snapshot"] | null = null;

export interface SyncState {
  _meta?: {
    schemaVersion: number;
    clientId: string;
    generatedAt: number;
    dirtySince?: number;
  };
  srs_cards_list: any[];
  active_rows: string[];
  active_rows_info?: { updatedAt?: number; clientId?: string };
  streak_info: { current: number; highest: number };
  anki_v3_collection?: any; // collection metadata only (decks/note types/media); big arrays below
  anki_cards_list?: any[];
  anki_notes_list?: any[];
  anki_revlogs_list?: any[];
  deleted_card_ids?: string[];
  deleted_deck_ids?: string[];
  n5_course_progress?: N5CourseProgress;
  n5_srs_cards?: N5SRSCard[];
  lookup_deck?: LookupCard[];
  vocab_words?: VocabWord[];
}

const SYNC_DIRTY_KEY = "kiroku_sync_dirty_v1";
const SYNC_DIRTY_AT_KEY = "kiroku_sync_dirty_at_v1";
const SYNC_CLIENT_ID_KEY = "kiroku_sync_client_id_v1";
const SYNC_LAST_PULL_KEY = "kiroku_sync_last_pull_v1";
const SYNC_LAST_PUSH_KEY = "kiroku_sync_last_push_v1";
const LEGACY_SYNC_DIRTY_KEY = "myanki_sync_dirty_v1";
const LEGACY_SYNC_DIRTY_AT_KEY = "myanki_sync_dirty_at_v1";
const LEGACY_SYNC_CLIENT_ID_KEY = "myanki_sync_client_id_v1";

function getMigratedStorageValue(key: string, legacyKey: string): string | null {
  const value = localStorage.getItem(key);
  if (value) return value;

  const legacyValue = localStorage.getItem(legacyKey);
  if (legacyValue) {
    localStorage.setItem(key, legacyValue);
  }
  return legacyValue;
}

export function markSyncDirty(): void {
  try {
    if (!localStorage.getItem(SYNC_DIRTY_KEY)) {
      localStorage.setItem(SYNC_DIRTY_AT_KEY, String(Date.now()));
    }
    localStorage.setItem(SYNC_DIRTY_KEY, "1");
  } catch {
    // ignore
  }
}

export function clearSyncDirty(): void {
  try {
    localStorage.removeItem(SYNC_DIRTY_KEY);
    localStorage.removeItem(SYNC_DIRTY_AT_KEY);
    localStorage.removeItem(LEGACY_SYNC_DIRTY_KEY);
    localStorage.removeItem(LEGACY_SYNC_DIRTY_AT_KEY);
  } catch {
    // ignore
  }
}

export function hasSyncDirtyState(): boolean {
  try {
    return getMigratedStorageValue(SYNC_DIRTY_KEY, LEGACY_SYNC_DIRTY_KEY) === "1";
  } catch {
    return false;
  }
}

function getClientId(): string {
  try {
    const existing = getMigratedStorageValue(SYNC_CLIENT_ID_KEY, LEGACY_SYNC_CLIENT_ID_KEY);
    if (existing) return existing;
    const generated = crypto.randomUUID ? crypto.randomUUID() : `client-${Date.now()}-${Math.random()}`;
    localStorage.setItem(SYNC_CLIENT_ID_KEY, generated);
    return generated;
  } catch {
    return `client-${Date.now()}`;
  }
}

function dirtySince(): number | undefined {
  try {
    const raw = getMigratedStorageValue(SYNC_DIRTY_AT_KEY, LEGACY_SYNC_DIRTY_AT_KEY);
    return raw ? Number(raw) || undefined : undefined;
  } catch {
    return undefined;
  }
}

function stampCollection<T extends Record<string, any>>(items: T[], defaultUpdatedAt: number): T[] {
  return items.map((item) => ({
    ...item,
    updatedAt: typeof item.updatedAt === "number" ? item.updatedAt : defaultUpdatedAt,
  }));
}

async function collectSyncState(): Promise<SyncState> {
  const now = Date.now();
  const clientId = getClientId();
  const srs_cards_list = stampCollection(normalizeSRSCards(await getAllCardsFromDB()) as any[], now);
  const active_rows = normalizeActiveRows(await getSettingFromDB<string[]>("active_rows", DEFAULT_ACTIVE_GROUP_IDS));
  const active_rows_info = await getSettingFromDB<{ updatedAt?: number; clientId?: string }>("active_rows_info", {});
  const streak_info = await getSettingFromDB<{ current: number; highest: number; updatedAt?: number }>("streak_info", { current: 0, highest: 0 });
  const ankiDelta = await getAnkiSyncDelta();
  pendingAnkiSnapshot = ankiDelta ? ankiDelta.snapshot : null;
  const deleted_deck_ids = await getSettingFromDB<string[]>("deleted_deck_ids", []);

  // Only include n5 progress when something is actually stored locally.
  // Sending a freshly-normalised default would stamp updatedAt: now and clobber
  // the server's real progress via last-write-wins.
  const rawN5Progress = await getSettingFromDB<Partial<N5CourseProgress> | null>("n5_course_progress", null);
  const n5_course_progress = rawN5Progress ? normalizeN5Progress(rawN5Progress, n5Course) : undefined;
  const rawN5Cards = await getSettingFromDB<N5SRSCard[]>("n5_srs_cards", []);
  const n5_srs_cards = rawN5Cards?.length ? normalizeN5Cards(rawN5Cards) : [];
  const rawLookupCards = await getSettingFromDB<LookupCard[]>("lookup_deck_cards_v1", []);
  const lookup_deck = rawLookupCards?.length ? normalizeLookupCards(rawLookupCards) : [];
  const rawVocabWords = await getSettingFromDB<VocabWord[]>("vocab_words_v1", []);
  const vocab_words = rawVocabWords?.length ? normalizeVocabWords(rawVocabWords) : [];

  return {
    _meta: {
      schemaVersion: 5,
      clientId,
      generatedAt: now,
      dirtySince: dirtySince(),
    },
    srs_cards_list,
    active_rows,
    active_rows_info,
    streak_info: {
      ...streak_info,
      updatedAt: typeof streak_info.updatedAt === "number" ? streak_info.updatedAt : now,
    } as any,
    anki_v3_collection: ankiDelta ? ankiDelta.meta : undefined,
    anki_cards_list: ankiDelta ? ankiDelta.cards : undefined,
    anki_notes_list: ankiDelta && ankiDelta.notes.length ? ankiDelta.notes : undefined,
    anki_revlogs_list: ankiDelta ? ankiDelta.reviewLogs : undefined,
    deleted_card_ids: ankiDelta && ankiDelta.deletedCardIds.length ? ankiDelta.deletedCardIds : undefined,
    deleted_deck_ids,
    n5_course_progress,
    n5_srs_cards: stampCollection(n5_srs_cards as any[], now) as N5SRSCard[],
    lookup_deck: stampCollection(lookup_deck as any[], now) as LookupCard[],
    vocab_words: stampCollection(vocab_words as any[], now) as VocabWord[],
  };
}

let reconcileInFlight = false;

type SyncListener = () => void;
const listeners = new Set<SyncListener>();

export const syncEvents = {
  subscribe(listener: SyncListener) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  emit() {
    listeners.forEach((listener) => {
      try {
        listener();
      } catch (err) {
        console.error("Error in sync listener", err);
      }
    });
  }
};

/** Write a remote SyncState into local IndexedDB (suppresses auto-push during writes). */
async function applyRemoteState(state: SyncState, opts: { applyAnki?: boolean } = {}): Promise<void> {
  const { applyAnki = true } = opts;
  setSyncRequestSuppressed(true);
  try {
    if (Array.isArray(state.srs_cards_list)) {
      await saveAllCardsToDB(normalizeSRSCards(state.srs_cards_list));
    }
    if (Array.isArray(state.active_rows)) {
      await saveSettingToDB("active_rows", normalizeActiveRows(state.active_rows));
    }
    if (state.active_rows_info) {
      await saveSettingToDB("active_rows_info", state.active_rows_info);
    }
    if (state.streak_info) {
      await saveSettingToDB("streak_info", state.streak_info);
    }
    // Apply Anki only on pull (applyAnki). The server returns the full merged card set, so
    // applying it on every debounced push would rewrite the whole local store each review;
    // instead the local store is already authoritative for this device and picks up other
    // devices' changes on the next pull. The apply is incremental (upsert + tombstone delete).
    if (applyAnki) {
      await applyAnkiRemote(state);
    }
    if (Array.isArray(state.deleted_deck_ids)) {
      await saveSettingToDB("deleted_deck_ids", state.deleted_deck_ids);
    }
    if (state.n5_course_progress) {
      await saveSettingToDB("n5_course_progress", normalizeN5Progress(state.n5_course_progress, n5Course));
    }
    if (Array.isArray(state.n5_srs_cards)) {
      await saveSettingToDB("n5_srs_cards", normalizeN5Cards(state.n5_srs_cards));
    }
    if (Array.isArray(state.lookup_deck)) {
      await saveSettingToDB("lookup_deck_cards_v1", normalizeLookupCards(state.lookup_deck));
    }
    if (Array.isArray(state.vocab_words)) {
      await saveSettingToDB("vocab_words_v1", normalizeVocabWords(state.vocab_words));
    }
  } finally {
    setSyncRequestSuppressed(false);
  }
}

/**
 * Gather all user scoped tables and push them to backend.
 * The server returns the merged state; we apply it locally so this session
 * converges immediately without a separate pull.
 */
export async function triggerPushSync(email: string): Promise<boolean> {
  if (!navigator.onLine) {
    console.log("Offline mode - skipping sync push.");
    return false;
  }

  try {
    const state = await collectSyncState();

    const resp = await fetch("/api/sync/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, state })
    });

    if (resp.ok) {
      const data = await resp.json();
      if (!data.success) {
        throw new Error(data.error || "Push failed");
      }
      clearSyncDirty();
      localStorage.setItem(SYNC_LAST_PUSH_KEY, String(Date.now()));
      // The push of Anki records succeeded — drop exactly the ids we sent from the dirty sets.
      if (pendingAnkiSnapshot) {
        await commitAnkiSync(pendingAnkiSnapshot);
        pendingAnkiSnapshot = null;
      }
      // Apply the server-merged non-Anki state so we pick up other sessions' changes. Anki is
      // intentionally not applied here (see applyRemoteState) to avoid rewriting the local store
      // on every push; it converges on the next pull.
      const merged = data.data as SyncState | null;
      if (merged && typeof merged === "object" && !("ignored" in merged)) {
        await applyRemoteState(merged, { applyAnki: false });
        syncEvents.emit();
      }
      console.log("Backend synchronization push complete.");
      return true;
    }
    return false;
  } catch (error) {
    console.error("Sync push failed:", error);
    return false;
  }
}

// Serialized form of the last pull we applied. The 15s reconcile loop pulls unconditionally,
// but most ticks return exactly what we already applied — re-applying would rewrite every
// Anki record in IndexedDB and wake syncEvents listeners for nothing. Comparing the raw JSON
// makes syncEvents mean "remote state actually changed". Deliberately NOT updated on the push
// path: push applies the merged response with applyAnki:false, so an identical follow-up pull
// must still run to converge the Anki stores.
let lastAppliedPullRaw: string | null = null;

/**
 * Pull state from the backend and overwrite local IndexedDB/local storage cache
 */
export async function triggerPullSync(email: string): Promise<boolean> {
  if (!navigator.onLine) {
    console.log("Offline mode - skipping sync pull.");
    return false;
  }

  try {
    const resp = await fetch("/api/sync/pull", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email })
    });

    if (!resp.ok) {
      console.warn("Pull query failed or returned invalid status.");
      return false;
    }

    const data = await resp.json();
    if (!data.success) {
      throw new Error(data.error || "Pull failed");
    }
    const state = data.data as SyncState | null;
    if (!state) {
      console.log("No backend state stored for user yet. Push will initialize it later.");
      return false;
    }

    const raw = JSON.stringify(state);
    if (raw === lastAppliedPullRaw) {
      localStorage.setItem(SYNC_LAST_PULL_KEY, String(Date.now()));
      return false;
    }

    await applyRemoteState(state);
    lastAppliedPullRaw = raw;

    console.log("Sync pull complete, database cached with remote state.");
    localStorage.setItem(SYNC_LAST_PULL_KEY, String(Date.now()));

    // Emit sync event so active views can pull updated state
    syncEvents.emit();
    return true;
  } catch (error) {
    console.error("Sync pull failed:", error);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Live sync: the 15s reconcile loop stays as the safety net. The immediate-push half of
// "device → Go merge → device, streaming" already existed — db.ts's requestSyncPush debounces
// a push shortly after every local mutation. The missing half was the *receiving* device
// finding out sooner than its next 15s tick; connectSyncEvents below is that piece: an
// EventSource on /api/sync/events pokes this device the moment another one pushes. Pokes
// carry no state — the pull fetches the canonical merged result — so a dropped event costs
// nothing, and EventSource reconnects on its own.
// ---------------------------------------------------------------------------

let livePullInFlight = false;

/**
 * connectSyncEvents opens the live-notification stream for this user. Returns a cleanup
 * function; safe to call in environments without EventSource (it becomes a no-op and the
 * polling loop carries on alone, exactly like before live sync existed).
 */
export function connectSyncEvents(email: string): () => void {
  if (typeof EventSource === "undefined") return () => {};
  const source = new EventSource(`/api/sync/events?email=${encodeURIComponent(email)}`);
  source.addEventListener("sync", (event) => {
    try {
      const poke = JSON.parse((event as MessageEvent).data);
      // Our own push echoes back too; the origin check avoids re-pulling what we just wrote.
      if (poke?.origin && poke.origin === getClientId()) return;
    } catch {
      // Malformed poke — pulling anyway is always safe.
    }
    if (reconcileInFlight || livePullInFlight) return;
    livePullInFlight = true;
    void triggerPullSync(email).finally(() => {
      livePullInFlight = false;
    });
  });
  return () => source.close();
}

/**
 * Push dirty local state then pull the latest server state.
 * A module-level guard prevents concurrent interleaved calls (e.g. from
 * AuthCenter + App effect + 15s interval firing simultaneously).
 */
export async function reconcileOnStartup(email: string): Promise<boolean> {
  if (!navigator.onLine) return false;
  if (reconcileInFlight) return false;

  reconcileInFlight = true;
  try {
    if (hasSyncDirtyState()) {
      // Push includes applying the merged response, so dirty sessions converge
      // even if the subsequent pull is redundant.
      await triggerPushSync(email);
    }
    return await triggerPullSync(email);
  } finally {
    reconcileInFlight = false;
  }
}

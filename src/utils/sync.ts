import { getAllCardsFromDB, saveAllCardsToDB, getSettingFromDB, saveSettingToDB, setSyncRequestSuppressed } from "./db";
import { DEFAULT_ACTIVE_GROUP_IDS } from "../types";
import { normalizeActiveRows, normalizeSRSCards } from "./srs";

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
  anki_v3_collection?: any;
  deleted_deck_ids?: string[];
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
  const anki_v3_collection = await getSettingFromDB<any>("anki_v3_collection", null);
  const deleted_deck_ids = await getSettingFromDB<string[]>("deleted_deck_ids", []);

  return {
    _meta: {
      schemaVersion: 2,
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
    anki_v3_collection,
    deleted_deck_ids,
  };
}

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

/**
 * Gather all user scoped tables and push them to backend
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
      console.log("Backend synchronization push complete.", data.data);
      clearSyncDirty();
      localStorage.setItem(SYNC_LAST_PUSH_KEY, String(Date.now()));
      return true;
    }
    return false;
  } catch (error) {
    console.error("Sync push failed:", error);
    return false;
  }
}

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

    setSyncRequestSuppressed(true);
    try {
      // Save fetched state to IndexedDB scoped for user prefix
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
      if (state.anki_v3_collection) {
        await saveSettingToDB("anki_v3_collection", state.anki_v3_collection);
      }
      if (Array.isArray(state.deleted_deck_ids)) {
        await saveSettingToDB("deleted_deck_ids", state.deleted_deck_ids);
      }
    } finally {
      setSyncRequestSuppressed(false);
    }

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

export async function reconcileOnStartup(email: string): Promise<void> {
  if (!navigator.onLine) return;

  if (hasSyncDirtyState()) {
    const pushed = await triggerPushSync(email);
    if (!pushed) return;
  }

  await triggerPullSync(email);
}

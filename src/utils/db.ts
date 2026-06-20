import { SRSCard, SpeedTestSession } from "../types";

const DB_NAME = "hiragana_flow_pwa_db";
const DB_VERSION = 4;

// Anki v3 normalized object stores (DB v4). The big collection arrays used to live inside one
// settings blob; they now live here so a card review writes one record instead of rewriting
// the whole collection. Records are user-scoped: object stores are NOT key-prefixed the way
// settings keys are, so every record carries a `user` field (the settings prefix, possibly "")
// and is keyed by `${user}|${id}` to keep multiple accounts on one browser isolated.
export const ANKI_CARDS_STORE = "anki_cards";
export const ANKI_NOTES_STORE = "anki_notes";
export const ANKI_REVLOGS_STORE = "anki_revlogs";
const ANKI_STORES = [ANKI_CARDS_STORE, ANKI_NOTES_STORE, ANKI_REVLOGS_STORE] as const;

// One record wrapping a domain object (card/note/review log) with its scoping fields.
export interface AnkiStoreRecord<T> {
  key: string;
  user: string;
  data: T;
}

export interface DBReviewAction {
  id?: number;
  char: string;
  isCorrect: boolean;
  previousBox: number;
  newBox: number;
  timestamp: number;
  offline: boolean;
}

let syncDebounceTimer: any = null;
let suppressSyncRequests = false;

export function setSyncRequestSuppressed(value: boolean): void {
  suppressSyncRequests = value;
}

export function requestSyncPush() {
  try {
    if (suppressSyncRequests) return;

    const raw = localStorage.getItem("current_logged_in_user_v1");
    if (!raw) return;
    const user = JSON.parse(raw);
    if (!user || !user.email) return;

    import("./sync")
      .then((m) => m.markSyncDirty())
      .catch(() => {
        localStorage.setItem("kiroku_sync_dirty_v1", "1");
        localStorage.setItem("kiroku_sync_dirty_at_v1", String(Date.now()));
      });

    if (syncDebounceTimer) {
      clearTimeout(syncDebounceTimer);
    }

    syncDebounceTimer = setTimeout(() => {
      import("./sync")
        .then((m) => {
          m.triggerPushSync(user.email).catch((e) =>
            console.warn("Autosave push background synchronization failed", e)
          );
        })
        .catch((err) => {
          console.warn("Failed to load sync dynamic module", err);
        });
    // Coalesce bursts of writes (e.g. answering several cards in a row) into one push. Each
    // push currently serializes the whole collection, so a longer debounce meaningfully cuts
    // redundant full-state uploads during an active review session.
    }, 2500);
  } catch {
    // ignore
  }
}

/**
 * Direct User Prefix from localStorage to avoid circular imports with auth.ts
 */
function getUserPrefix(): string {
  try {
    const raw = localStorage.getItem("current_logged_in_user_v1");
    if (!raw) return "";
    const user = JSON.parse(raw);
    if (user && user.email) {
      return "user_scoped_" + user.email.toLowerCase().replace(/[^a-z0-9]/g, "_") + "_";
    }
  } catch (e) {
    // ignore
  }
  return "";
}

export function initDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // Cards store
      if (!db.objectStoreNames.contains("cards")) {
        db.createObjectStore("cards", { keyPath: "char" });
      }

      // Offline and online review actions store
      if (!db.objectStoreNames.contains("review_actions")) {
        db.createObjectStore("review_actions", { keyPath: "id", autoIncrement: true });
      }

      // Settings and persistent indicators (streak, activeRows, etc.)
      if (!db.objectStoreNames.contains("settings")) {
        db.createObjectStore("settings", { keyPath: "key" });
      }

      if (!db.objectStoreNames.contains("anki_media")) {
        db.createObjectStore("anki_media", { keyPath: "hash" });
      }

      if (!db.objectStoreNames.contains("anki_review_logs")) {
        db.createObjectStore("anki_review_logs", { keyPath: "id" });
      }

      // DB v4: normalized, user-scoped Anki stores. Each is keyed by `${user}|${id}` and has a
      // `by_user` index so a user's full set can be loaded (and cleared) without scanning others.
      for (const storeName of ANKI_STORES) {
        if (!db.objectStoreNames.contains(storeName)) {
          const store = db.createObjectStore(storeName, { keyPath: "key" });
          store.createIndex("by_user", "user", { unique: false });
        }
      }
    };

    request.onsuccess = (event) => {
      resolve((event.target as IDBOpenDBRequest).result);
    };

    request.onerror = (event) => {
      reject((event.target as IDBOpenDBRequest).error);
    };
  });
}

/**
 * Fetch all cards from IndexedDB (or settings if scoped to user)
 */
export async function getAllCardsFromDB(): Promise<SRSCard[]> {
  const prefix = getUserPrefix();
  if (prefix) {
    return await getSettingFromDB<SRSCard[]>("srs_cards_list", []);
  }

  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("cards", "readonly");
    const store = transaction.objectStore("cards");
    const request = store.getAll();

    request.onsuccess = () => {
      resolve(request.result as SRSCard[]);
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}

/**
 * Save multiple cards to IndexedDB (or settings if scoped to user)
 */
export async function saveAllCardsToDB(cards: SRSCard[]): Promise<void> {
  const prefix = getUserPrefix();
  if (prefix) {
    await saveSettingToDB("srs_cards_list", cards);
    return;
  }

  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("cards", "readwrite");
    const store = transaction.objectStore("cards");

    cards.forEach((card) => {
      store.put(card);
    });

    transaction.oncomplete = () => {
      requestSyncPush();
      resolve();
    };

    transaction.onerror = () => {
      reject(transaction.error);
    };
  });
}

/**
 * Save a single card to IndexedDB (or update user array in settings)
 */
export async function saveCardToDB(card: SRSCard): Promise<void> {
  const prefix = getUserPrefix();
  if (prefix) {
    const cards = await getAllCardsFromDB();
    const updated = cards.map((c) => (c.char === card.char ? card : c));
    if (!updated.some((c) => c.char === card.char)) {
      updated.push(card);
    }
    await saveAllCardsToDB(updated);
    return;
  }

  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("cards", "readwrite");
    const store = transaction.objectStore("cards");
    const request = store.put(card);

    request.onsuccess = () => {
      requestSyncPush();
      resolve();
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}

/**
 * Log a review action (offline or online) to IndexedDB
 */
export async function logReviewActionToDB(
  char: string,
  isCorrect: boolean,
  previousBox: number,
  newBox: number
): Promise<void> {
  const db = await initDB();
  const offline = !navigator.onLine;
  const action: DBReviewAction = {
    char,
    isCorrect,
    previousBox,
    newBox,
    timestamp: Date.now(),
    offline,
  };

  return new Promise((resolve, reject) => {
    const transaction = db.transaction("review_actions", "readwrite");
    const store = transaction.objectStore("review_actions");
    const request = store.add(action);

    request.onsuccess = () => {
      resolve();
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}

/**
 * Get all saved review actions (for offline logging / audits)
 */
export async function getReviewActionsFromDB(): Promise<DBReviewAction[]> {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("review_actions", "readonly");
    const store = transaction.objectStore("review_actions");
    const request = store.getAll();

    request.onsuccess = () => {
      resolve(request.result as DBReviewAction[]);
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}

/**
 * Clear all review actions log
 */
export async function clearReviewActionsFromDB(): Promise<void> {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("review_actions", "readwrite");
    const store = transaction.objectStore("review_actions");
    const request = store.clear();

    request.onsuccess = () => {
      resolve();
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}

/**
 * Save setting value
 */
export async function saveSettingToDB(key: string, value: any): Promise<void> {
  const prefix = (key === "local_registered_users_v1") ? "" : getUserPrefix();
  const dbKey = prefix + key;
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("settings", "readwrite");
    const store = transaction.objectStore("settings");
    const request = store.put({ key: dbKey, value });

    request.onsuccess = () => {
      if (key !== "local_registered_users_v1") {
        requestSyncPush();
      }
      resolve();
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}

/**
 * Fetch setting value
 */
export async function getSettingFromDB<T>(key: string, defaultValue: T): Promise<T> {
  const prefix = (key === "local_registered_users_v1") ? "" : getUserPrefix();
  const dbKey = prefix + key;
  const db = await initDB();
  return new Promise((resolve) => {
    const transaction = db.transaction("settings", "readonly");
    const store = transaction.objectStore("settings");
    const request = store.get(dbKey);

    request.onsuccess = () => {
      if (request.result) {
        resolve(request.result.value as T);
      } else {
        resolve(defaultValue);
      }
    };

    request.onerror = () => {
      resolve(defaultValue);
    };
  });
}

/**
 * Clear only kana study data (cards, review log, kana-related settings).
 * Leaves N5 course progress, Anki collections, media, and auth profiles intact.
 */
// ---- Anki v3 normalized object-store helpers (DB v4) ----

// The current user's settings prefix ("" when logged out). Object-store records embed this so
// accounts on a shared browser stay isolated, mirroring how settings keys are prefixed.
export function currentUserScope(): string {
  return getUserPrefix();
}

// Build a record without touching the DB (used for bulk writes and the migration).
export function makeAnkiRecord<T>(user: string, id: string, data: T): AnkiStoreRecord<T> {
  return { key: `${user}|${id}`, user, data };
}

// Replace all of `user`'s records in `storeName` with `records`, in one transaction.
export async function replaceAnkiStore<T>(storeName: string, user: string, records: AnkiStoreRecord<T>[]): Promise<void> {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    const cursorReq = store.index("by_user").openCursor(IDBKeyRange.only(user));
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      } else {
        for (const record of records) store.put(record);
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// All of `user`'s domain objects from `storeName`.
export async function getAnkiStoreRecords<T>(storeName: string, user: string): Promise<T[]> {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).index("by_user").getAll(IDBKeyRange.only(user));
    req.onsuccess = () => resolve((req.result as AnkiStoreRecord<T>[]).map((r) => r.data));
    req.onerror = () => reject(req.error);
  });
}

// Upsert a single record (one card / review log). Triggers an autosave sync push like settings.
export async function putAnkiRecord<T>(storeName: string, user: string, id: string, data: T): Promise<void> {
  const db = await initDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).put(makeAnkiRecord(user, id, data));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  requestSyncPush();
}

// Load specific records by id for the current user (used to build a sync delta of just the
// cards/logs that changed). Missing ids are skipped.
export async function getAnkiRecordsByIds<T>(storeName: string, user: string, ids: string[]): Promise<T[]> {
  if (ids.length === 0) return [];
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const out: T[] = [];
    for (const id of ids) {
      const req = store.get(`${user}|${id}`);
      req.onsuccess = () => {
        if (req.result) out.push((req.result as AnkiStoreRecord<T>).data);
      };
    }
    tx.oncomplete = () => resolve(out);
    tx.onerror = () => reject(tx.error);
  });
}

// Upsert many records without clearing the store and WITHOUT triggering a sync push (used to
// apply records pulled from the server — they must not bounce straight back as local changes).
export async function upsertAnkiRecords<T>(storeName: string, user: string, records: AnkiStoreRecord<T>[]): Promise<void> {
  if (records.length === 0) return;
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    for (const record of records) store.put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Delete records by id for the current user (applying deletion tombstones from the server).
export async function deleteAnkiRecordsByIds(storeName: string, user: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    for (const id of ids) store.delete(`${user}|${id}`);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Count `user`'s records in `storeName` (used to verify a migration before dropping the blob).
export async function countAnkiStore(storeName: string, user: string): Promise<number> {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).index("by_user").count(IDBKeyRange.only(user));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Delete a settings key. The settings helpers only put/get; the migration needs to drop the
// legacy blob once its data is safely in the new stores.
export async function deleteSettingFromDB(key: string): Promise<void> {
  const prefix = (key === "local_registered_users_v1") ? "" : getUserPrefix();
  const dbKey = prefix + key;
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("settings", "readwrite");
    tx.objectStore("settings").delete(dbKey);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearKanaDataFromDB(): Promise<void> {
  const KANA_SETTING_KEYS = ["srs_cards_list", "active_rows", "active_rows_info", "streak_info"];
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(["cards", "review_actions", "settings"], "readwrite");

    transaction.objectStore("cards").clear();
    transaction.objectStore("review_actions").clear();

    const settings = transaction.objectStore("settings");
    const keysRequest = settings.getAllKeys();
    keysRequest.onsuccess = () => {
      (keysRequest.result as string[]).forEach((key) => {
        // settings keys may be stored with a user prefix (user_scoped_..._<key>)
        if (KANA_SETTING_KEYS.some((kanaKey) => key === kanaKey || key.endsWith("_" + kanaKey))) {
          settings.delete(key);
        }
      });
    };

    transaction.oncomplete = () => {
      resolve();
    };

    transaction.onerror = () => {
      reject(transaction.error);
    };
  });
}

/**
 * Reset entire IndexedDB database tables
 */
export async function clearAllIndexedDB(): Promise<void> {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(["cards", "review_actions", "settings", ...ANKI_STORES], "readwrite");

    transaction.objectStore("cards").clear();
    transaction.objectStore("review_actions").clear();
    transaction.objectStore("settings").clear();
    for (const storeName of ANKI_STORES) transaction.objectStore(storeName).clear();

    transaction.oncomplete = () => {
      resolve();
    };

    transaction.onerror = () => {
      reject(transaction.error);
    };
  });
}

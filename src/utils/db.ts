import { SRSCard, SpeedTestSession } from "../types";

const DB_NAME = "hiragana_flow_pwa_db";
const DB_VERSION = 3;

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

function requestSyncPush() {
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
    }, 1000);
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
    const transaction = db.transaction(["cards", "review_actions", "settings"], "readwrite");
    
    transaction.objectStore("cards").clear();
    transaction.objectStore("review_actions").clear();
    transaction.objectStore("settings").clear();

    transaction.oncomplete = () => {
      resolve();
    };

    transaction.onerror = () => {
      reject(transaction.error);
    };
  });
}

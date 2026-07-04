// Minimal IndexedDB writer for persisting an import's media locally, from inside the parse
// worker. This exists because the source device that imports a deck is also the device that
// studies it — its cards need the media available offline immediately, with no network round
// trip and no dependency on a cloud upload or a P2P peer ever happening.
//
// Blobs are written to the same "anki_media" object store the main thread reads
// (see db.ts getMediaBlob/buildMediaURLMap) — keyed by content hash, record shape matching
// saveMediaBlob — but deliberately WITHOUT an LRU-meta entry. enforceMediaCacheLimit only
// evicts hashes that appear in the meta map, so a metaless blob is effectively pinned: the
// media of a deck you imported here never gets evicted out from under you, unlike media lazily
// fetched from the server for a deck synced from another device (which stays under the 50 MB
// cap). Opening with no version avoids ever triggering the schema upgrade that lives in db.ts;
// the app always initializes the DB on load before an import can run, so the store exists.

const DB_NAME = "hiragana_flow_pwa_db";
const STORE = "anki_media";

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDB(): Promise<IDBDatabase | null> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME);
        req.onsuccess = () => {
          const db = req.result;
          // If the store somehow isn't there yet (import before the main thread ever
          // initialized the DB — shouldn't happen for a logged-in user), skip persistence
          // rather than crash the import; media still reaches peers/cloud via the archive.
          resolve(db.objectStoreNames.contains(STORE) ? db : null);
        };
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }
  return dbPromise;
}

/** saveImportedMediaLocally pins one decoded blob in the local media store, keyed by hash. */
export async function saveImportedMediaLocally(
  ref: { hash: string; fileName: string; contentType: string; bytes: number },
  bytes: Uint8Array
): Promise<void> {
  const db = await openDB();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({
      hash: ref.hash,
      fileName: ref.fileName,
      contentType: ref.contentType,
      bytes: ref.bytes,
      blob: new Blob([bytes as BlobPart], { type: ref.contentType }),
      storedAt: Date.now(),
    });
    // Best-effort: a failed local save shouldn't abort the import (the media still parsed and
    // can reach other devices). Resolve on both complete and error.
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    tx.onabort = () => resolve();
  });
}

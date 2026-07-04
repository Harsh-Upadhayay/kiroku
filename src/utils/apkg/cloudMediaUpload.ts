// Pushing media blobs the server's content-addressed store is missing — shared by the import
// worker (see worker.ts, used when client-side parsing can't find a P2P peer to hand media to
// directly) and the main-thread P2P transfer panel (see MediaTransferPanel.tsx) when it falls
// back to the cloud after waiting for another device. One implementation, two callers, so the
// retry/batching behavior can't drift between the two paths.

const UPLOAD_CONCURRENCY = 3;
const UPLOAD_RETRIES = 3;
const CHECK_BATCH_SIZE = 1000;

export interface UploadProgress {
  current: number;
  total: number;
}

/**
 * missingHashes asks the store which of the given hashes it lacks, batched so the request
 * body stays small on decks with thousands of files. A failed check treats every hash in that
 * batch as missing — uploading a blob the server already has is a cheap content-addressed
 * no-op, so erring toward "missing" is always safe.
 */
export async function missingHashes(hashes: string[]): Promise<Set<string>> {
  const missing = new Set<string>();
  for (let at = 0; at < hashes.length; at += CHECK_BATCH_SIZE) {
    const batch = hashes.slice(at, at + CHECK_BATCH_SIZE);
    try {
      const res = await fetch("/api/media/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hashes: batch }),
      });
      if (!res.ok) throw new Error(`check failed: ${res.status}`);
      const payload = await res.json();
      for (const hash of payload?.data?.missing ?? batch) missing.add(hash);
    } catch {
      for (const hash of batch) missing.add(hash);
    }
  }
  return missing;
}

async function putBlobWithRetry(hash: string, bytes: Uint8Array): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < UPLOAD_RETRIES; attempt++) {
    try {
      const res = await fetch(`/api/media/${hash}`, {
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream" },
        body: new Blob([bytes as BlobPart]),
      });
      if (res.ok) return;
      lastError = new Error(`media upload failed: ${res.status}`);
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
  }
  throw lastError instanceof Error ? lastError : new Error("media upload failed");
}

/**
 * uploadMissingMedia checks which of manifest's hashes the server lacks and uploads just
 * those, reading each blob via readEntry (e.g. re-reading the .apkg archive by zip entry
 * name). Bounded concurrency, same shape as the chunked-upload client in anki-v3.ts. Returns
 * how many files failed after retries — never throws for an individual file's failure, since
 * one bad blob shouldn't abort the rest of a large deck.
 */
export async function uploadMissingMedia(
  manifest: { hash: string; entryName: string }[],
  readEntry: (entryName: string) => Promise<Uint8Array>,
  onProgress?: (p: UploadProgress) => void
): Promise<{ uploaded: number; failed: number }> {
  const missing = await missingHashes(manifest.map((m) => m.hash));
  const pending = manifest.filter((m) => missing.has(m.hash));
  const total = pending.length;
  let completed = 0;
  let failed = 0;
  let cursor = 0;
  onProgress?.({ current: 0, total });

  const worker = async () => {
    while (cursor < pending.length) {
      const ref = pending[cursor++];
      try {
        const bytes = await readEntry(ref.entryName);
        await putBlobWithRetry(ref.hash, bytes);
      } catch {
        failed++;
      } finally {
        completed++;
        onProgress?.({ current: completed, total });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, pending.length) }, worker));
  return { uploaded: total - failed, failed };
}

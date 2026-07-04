// Web Worker entry for client-side .apkg import: parse the package off the main thread,
// then push the media blobs the server is missing into its content-addressed store
// (PUT /api/media/{hash}). The heavy pieces — unzip, SQLite-in-WASM, zstd, hashing — all
// happen here so a hundreds-of-MB deck never janks the UI.
//
// Media flows in two passes over the archive. Pass 1 (inside parseApkg) streams every blob
// through the hasher to build the manifest — one blob in memory at a time. Pass 2 asks the
// server which hashes it lacks (one POST /api/media/check) and re-reads just those entries
// for upload. Re-reading beats the alternatives: holding every decoded blob for the upload
// would pin hundreds of MB, and uploading blindly during pass 1 would re-send a whole deck
// the server already has.

import initSqlJs from "sql.js";
import sqlWasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import { ApkgArchive } from "./archive";
import { maybeDecompressZstd } from "./media";
import { parseApkg } from "./parse";
import type { ApkgImportResult, ApkgMediaRef } from "./types";

export interface ApkgWorkerRequest {
  file: Blob;
  /** When true, media blobs missing from the server store are uploaded after parsing. */
  uploadMedia: boolean;
}

export type ApkgWorkerResponse =
  | { type: "progress"; phase: "parse" | "media" | "upload"; current: number; total: number }
  | { type: "done"; result: ApkgImportResult }
  | { type: "error"; message: string };

const UPLOAD_CONCURRENCY = 3;
const UPLOAD_RETRIES = 3;
const CHECK_BATCH_SIZE = 1000;

const post = (message: ApkgWorkerResponse) => (self as unknown as Worker).postMessage(message);

self.onmessage = async (event: MessageEvent<ApkgWorkerRequest>) => {
  const { file, uploadMedia } = event.data;
  let archive: ApkgArchive | null = null;
  try {
    const sql = await initSqlJs({ locateFile: () => sqlWasmUrl });
    archive = await ApkgArchive.open(file);

    const result = await parseApkg(archive, sql, {
      onProgress: (p) => {
        if (p.stage === "media") post({ type: "progress", phase: "media", current: p.current, total: p.total });
        else post({ type: "progress", phase: "parse", current: p.current, total: p.total });
      },
    });

    if (uploadMedia && result.mediaManifest && result.mediaManifest.length > 0) {
      const failed = await uploadMissingMedia(archive, result.mediaManifest);
      if (failed > 0) {
        result.report.warnings.push(`media upload failed for ${failed} of ${result.mediaManifest.length} files`);
        // Every upload failing means the store is unreachable; surfacing an error (rather
        // than a quiet warning) lets the caller fall back to the server-parse path, which
        // would hit the same wall anyway and report it properly.
        if (failed === result.mediaManifest.length) {
          throw new Error("media upload failed for every file — is the server reachable?");
        }
      }
    }

    post({ type: "done", result });
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  } finally {
    await archive?.close().catch(() => {});
  }
};

/**
 * uploadMissingMedia sends the blobs the server lacks, re-reading each from the archive.
 * Returns the number of files that still failed after retries.
 */
async function uploadMissingMedia(archive: ApkgArchive, manifest: ApkgMediaRef[]): Promise<number> {
  const missing = await missingHashes(manifest.map((m) => m.hash));
  const pending = manifest.filter((m) => missing.has(m.hash));
  const total = pending.length;
  if (total === 0) {
    post({ type: "progress", phase: "upload", current: 0, total: 0 });
    return 0;
  }

  let completed = 0;
  let failed = 0;
  let cursor = 0;
  post({ type: "progress", phase: "upload", current: 0, total });
  // Fixed worker pool draining a shared cursor — the same bounded-concurrency shape as the
  // chunked-upload client in anki-v3.ts.
  const worker = async () => {
    while (cursor < pending.length) {
      const ref = pending[cursor++];
      try {
        const raw = await archive.read(ref.entryName);
        if (!raw) throw new Error(`media entry ${ref.entryName} vanished from archive`);
        await putBlobWithRetry(ref.hash, maybeDecompressZstd(raw));
      } catch {
        failed++;
      } finally {
        completed++;
        post({ type: "progress", phase: "upload", current: completed, total });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, pending.length) }, worker));
  return failed;
}

/**
 * missingHashes asks the store which hashes it lacks, batched so the request body stays
 * small on 8k-file decks. If the check itself fails, every hash is treated as missing —
 * uploads of blobs the server already has are cheap no-ops (content-addressed short-circuit).
 */
async function missingHashes(hashes: string[]): Promise<Set<string>> {
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

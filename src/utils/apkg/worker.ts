// Web Worker entry for client-side .apkg import: parse the package off the main thread and
// persist its media locally so the importing device can study the deck immediately. The heavy
// pieces — unzip, SQLite-in-WASM, zstd, hashing — all happen here so a hundreds-of-MB deck
// never janks the UI.
//
// Media handling, in one streaming pass over the archive (inside parseApkg): each blob is
// decoded one at a time, hashed to build the manifest, and saved straight into the local
// anki_media store (pinned — see workerMediaStore.ts). That local save is what makes the
// source device's own cards work offline with no cloud upload and no dependency on a P2P peer.
//
// A second, optional pass uploads media to the server's content-addressed store (only when
// uploadMedia is set — the cloud-fallback path in MediaTransferPanel). It asks the server
// which hashes it lacks (one POST /api/media/check) and re-reads just those entries from the
// archive, rather than holding every decoded blob in memory for a possible upload.

import initSqlJs from "sql.js";
import sqlWasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import { ApkgArchive } from "./archive";
import { uploadMissingMedia } from "./cloudMediaUpload";
import { maybeDecompressZstd } from "./media";
import { parseApkg } from "./parse";
import type { ApkgImportResult } from "./types";
import { saveImportedMediaLocally } from "./workerMediaStore";

export interface ApkgWorkerRequest {
  file: Blob;
  /** When true, media blobs missing from the server store are uploaded after parsing. Only
   * used when the caller has already given up on finding a P2P peer to hand media to
   * directly (see MediaTransferPanel.tsx) — defaults to false so a normal client-side import
   * doesn't pay this bandwidth cost before P2P even gets a chance. */
  uploadMedia: boolean;
}

export type ApkgWorkerResponse =
  | { type: "progress"; phase: "parse" | "media" | "upload"; current: number; total: number }
  | { type: "done"; result: ApkgImportResult }
  | { type: "error"; message: string };

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
      // Persist each blob locally as it's decoded, so this device's cards render offline
      // without ever fetching from the server or waiting on a peer.
      onMediaBlob: (ref, bytes) => saveImportedMediaLocally(ref, bytes),
    });

    if (uploadMedia && result.mediaManifest && result.mediaManifest.length > 0) {
      const manifest = result.mediaManifest;
      const openArchive = archive; // narrow the outer `let` to a stable non-null reference
      const { failed } = await uploadMissingMedia(
        manifest,
        async (entryName) => {
          const raw = await openArchive.read(entryName);
          if (!raw) throw new Error(`media entry ${entryName} vanished from archive`);
          return maybeDecompressZstd(raw);
        },
        (p) => post({ type: "progress", phase: "upload", current: p.current, total: p.total })
      );
      if (failed > 0) {
        result.report.warnings.push(`media upload failed for ${failed} of ${manifest.length} files`);
        // Every upload failing means the store is unreachable; surfacing an error (rather
        // than a quiet warning) lets the caller fall back to the server-parse path, which
        // would hit the same wall anyway and report it properly.
        if (failed === manifest.length) {
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


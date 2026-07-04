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
import { uploadMissingMedia } from "./cloudMediaUpload";
import { maybeDecompressZstd } from "./media";
import { parseApkg } from "./parse";
import type { ApkgImportResult } from "./types";

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


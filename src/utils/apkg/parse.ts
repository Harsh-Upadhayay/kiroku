// The client-side .apkg parsing pipeline, mirroring backend/internal/anki/import.go. The
// browser does exactly what the Go server does: unzip, open the SQLite collection (sql.js —
// SQLite compiled to WASM), read metadata/notes/cards/revlog, then hash the media blobs.
// Parity between the two is enforced by the shared goldens under fixtures/anki/.

import type { SqlJsStatic } from "sql.js";
import { ApkgArchive } from "./archive";
import { readMetadata } from "./collection";
import { maybeDecompressZstd, mimeTypeFor, parseMediaManifest, sha256Hex } from "./media";
import { readCards, readNotes, readReviewLogs } from "./queries";
import type { ApkgImportResult, ApkgMediaRef } from "./types";

export interface ParseProgress {
  stage: "open" | "collection" | "tables" | "media";
  current: number;
  total: number;
}

export interface ParseCallbacks {
  onProgress?: (progress: ParseProgress) => void;
  /**
   * onMediaBlob receives each decoded media blob right after hashing. Blobs are streamed one
   * at a time and not retained — a caller that needs them later (e.g. to upload) re-reads
   * them from the archive by entry name.
   */
  onMediaBlob?: (ref: ApkgMediaRef, bytes: Uint8Array) => void | Promise<void>;
}

// The four collection file names Anki has shipped, in preference order; the "b" variants
// are zstd-compressed (Go: readCollection).
const collectionCandidates: Array<{ name: string; compressed: boolean }> = [
  { name: "collection.anki21b", compressed: true },
  { name: "collection.anki2b", compressed: true },
  { name: "collection.anki21", compressed: false },
  { name: "collection.anki2", compressed: false },
];

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** parseApkgBlob opens, parses and closes an .apkg File/Blob. */
export async function parseApkgBlob(blob: Blob, sql: SqlJsStatic, callbacks: ParseCallbacks = {}): Promise<ApkgImportResult> {
  const archive = await ApkgArchive.open(blob);
  try {
    return await parseApkg(archive, sql, callbacks);
  } finally {
    await archive.close();
  }
}

/** parseApkg parses an already-opened archive (Go: importFromZipReader). */
export async function parseApkg(archive: ApkgArchive, sql: SqlJsStatic, callbacks: ParseCallbacks = {}): Promise<ApkgImportResult> {
  const { onProgress, onMediaBlob } = callbacks;
  onProgress?.({ stage: "open", current: 0, total: 1 });

  let collectionBytes: Uint8Array | null = null;
  let collectionKind = "";
  for (const candidate of collectionCandidates) {
    const raw = await archive.read(candidate.name);
    if (!raw) continue;
    if (candidate.compressed) {
      // Unlike media blobs (decompressed defensively), a compressed collection that fails
      // to decode is a fatal, malformed package — same as the Go parser.
      const decoded = maybeDecompressZstd(raw);
      if (decoded === raw) throw new Error(`failed to decompress ${candidate.name}`);
      collectionBytes = decoded;
    } else {
      collectionBytes = raw;
    }
    collectionKind = candidate.name;
    break;
  }
  if (!collectionBytes) throw new Error("no Anki collection found in package");

  onProgress?.({ stage: "collection", current: 0, total: 1 });
  const db = new sql.Database(collectionBytes);
  const importId = crypto.randomUUID();
  let warnings: string[] = [];
  try {
    const metadata = readMetadata(db, warnings);
    warnings = metadata.warnings;
    const noteTypes = metadata.noteTypes ?? [];
    const [notes, noteById] = readNotes(db, noteTypes);
    const cards = readCards(db, noteTypes, noteById);
    // Review logs are optional history; a failure downgrades to a warning (Go parity).
    let reviewLogs: ReturnType<typeof readReviewLogs> = [];
    try {
      reviewLogs = readReviewLogs(db);
    } catch (err) {
      warnings.push(`review log import failed: ${errMessage(err)}`);
    }
    onProgress?.({ stage: "tables", current: 1, total: 1 });

    const newFormat = collectionKind.endsWith("b");
    const mediaManifest = await readMedia(archive, newFormat, warnings, onProgress, onMediaBlob);

    const decks = metadata.decks;
    const packageKind = "apkg";
    return {
      importId,
      collection: {
        id: `collection-${importId}`,
        name: decks && decks.length > 0 ? decks[0].name : packageKind,
        createdAt: Date.now(),
        decks,
        deckConfigs: metadata.deckConfigs,
        noteTypes: metadata.noteTypes,
        notes,
        cards,
        reviewLogs,
      },
      mediaManifest,
      report: {
        packageKind: `${packageKind}/${collectionKind}`,
        warnings,
        decks: decks?.length ?? 0,
        deckConfigs: metadata.deckConfigs?.length ?? 0,
        noteTypes: metadata.noteTypes?.length ?? 0,
        notes: notes.length,
        cards: cards.length,
        reviewLogs: reviewLogs.length,
        mediaFiles: mediaManifest?.length ?? 0,
      },
    };
  } finally {
    db.close();
  }
}

/**
 * readMedia decodes the manifest and streams each blob through hash + onMediaBlob, one at a
 * time — peak memory is a single decoded blob, which is what makes hundreds-of-MB decks
 * parseable on a phone (Go: readMedia).
 */
async function readMedia(
  archive: ApkgArchive,
  newFormat: boolean,
  warnings: string[],
  onProgress?: ParseCallbacks["onProgress"],
  onMediaBlob?: ParseCallbacks["onMediaBlob"]
): Promise<ApkgMediaRef[] | null> {
  const raw = await archive.read("media");
  if (!raw) return null;

  let entries;
  try {
    entries = parseMediaManifest(raw, newFormat);
  } catch (err) {
    warnings.push(`media map could not be parsed: ${errMessage(err)}`);
    return null;
  }

  const manifest: ApkgMediaRef[] = [];
  let processed = 0;
  for (const entry of entries) {
    onProgress?.({ stage: "media", current: processed++, total: entries.length });
    if (entry.fileName === "") continue;
    const blobRaw = await archive.read(entry.entryName);
    if (!blobRaw) {
      warnings.push(`media entry ${entry.entryName} (${entry.fileName}) missing`);
      continue;
    }
    // Newer packages zstd-compress each blob; decompress defensively regardless of the
    // declared format so a single odd archive does not break the whole import.
    const blob = maybeDecompressZstd(blobRaw);
    const ref: ApkgMediaRef = {
      hash: await sha256Hex(blob),
      fileName: entry.fileName,
      entryName: entry.entryName,
      contentType: mimeTypeFor(entry.fileName),
      bytes: blob.length,
    };
    manifest.push(ref);
    await onMediaBlob?.(ref, blob);
  }
  onProgress?.({ stage: "media", current: entries.length, total: entries.length });
  manifest.sort((a, b) => (a.fileName < b.fileName ? -1 : a.fileName > b.fileName ? 1 : 0));
  return manifest;
}

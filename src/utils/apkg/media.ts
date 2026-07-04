// Media manifest decoding, zstd handling and content hashing, mirroring
// backend/internal/anki/media.go. Blobs are processed one at a time by the caller; nothing
// here holds more than a single decoded blob.

import { decompress } from "fzstd";
import { parseMediaEntriesProto } from "./proto";

/** zstdMagic is the 4-byte frame magic prefixing every zstd stream. */
const zstdMagic = [0x28, 0xb5, 0x2f, 0xfd];

/**
 * maybeDecompressZstd returns the decompressed form of b when it carries the zstd frame
 * magic, or b unchanged otherwise. Failures fall back to the original bytes so one malformed
 * stream degrades to "unreadable media" rather than a failed import (Go: maybeDecompressZstd).
 */
export function maybeDecompressZstd(b: Uint8Array): Uint8Array {
  if (b.length < 4 || b[0] !== zstdMagic[0] || b[1] !== zstdMagic[1] || b[2] !== zstdMagic[2] || b[3] !== zstdMagic[3]) {
    return b;
  }
  try {
    return decompress(b);
  } catch {
    return b;
  }
}

/** A media manifest entry: zip entry name ("0", "1", ...) → original file name. */
export interface MediaEntry {
  entryName: string;
  fileName: string;
}

/**
 * parseMediaManifest decodes the archive's "media" file: legacy JSON object first (unless the
 * package declares the new format), protobuf second, JSON again as the last resort for
 * mislabeled archives — the same ordering as the Go parser.
 */
export function parseMediaManifest(raw: Uint8Array, newFormat: boolean): MediaEntry[] {
  if (!newFormat) {
    const entries = parseJSONMediaManifest(raw);
    if (entries) return entries;
  }
  try {
    const names = parseMediaEntriesProto(maybeDecompressZstd(raw));
    return names.map((fileName, i) => ({ entryName: String(i), fileName }));
  } catch (err) {
    const entries = parseJSONMediaManifest(raw);
    if (entries) return entries;
    throw err;
  }
}

/** parseJSONMediaManifest decodes the legacy {"0": "file.mp3", ...} object, or null. */
function parseJSONMediaManifest(raw: Uint8Array): MediaEntry[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  return Object.entries(parsed as Record<string, unknown>).map(([entryName, fileName]) => ({
    entryName,
    fileName: String(fileName),
  }));
}

/** sha256Hex hashes bytes with WebCrypto — the same content addressing as the Go store. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

// mimeTypeFor guesses a content type from the file extension. The table replicates what the
// Go server resolves via its mime package for the extensions that occur in real decks; an
// unknown extension falls back to application/octet-stream on both sides.
const mimeTypes: Record<string, string> = {
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".css": "text/css; charset=utf-8",
  ".flac": "audio/flac",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".oga": "audio/ogg",
  ".ogg": "audio/ogg",
  ".ogv": "video/ogg",
  ".opus": "audio/ogg",
  ".otf": "font/otf",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
  ".wav": "audio/x-wav",
  ".webm": "video/webm",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

export function mimeTypeFor(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  const ext = dot === -1 ? "" : fileName.slice(dot).toLowerCase();
  return mimeTypes[ext] ?? "application/octet-stream";
}

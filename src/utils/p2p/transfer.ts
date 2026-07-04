// The media transfer protocol running over an already-open RTCDataChannel (see peer.ts for
// how that channel gets opened). One sender and one receiver role; both are plain functions
// over any object shaped like a data channel, which is what makes them testable with an
// in-memory mock pair instead of real WebRTC (see transfer.test.ts).
//
// Wire protocol (JSON control frames interleaved with raw binary chunks on the same channel):
//
//   sender   -> {t:"manifest", files:[{hash,fileName,contentType,bytes}]}
//   receiver -> {t:"want", hashes:[...]}            // diffed against what it already has
//   sender, per wanted file:
//     -> {t:"file", hash, size}
//     -> <binary chunks>
//     -> {t:"file-end", hash}
//   receiver -> {t:"ack", hash}                      // after SHA-256 verify + persisting
//   sender   -> {t:"done"}                           // sent once every wanted file is acked

import { sha256Hex } from "../apkg/media";

export interface MediaEntry {
  hash: string;
  fileName: string;
  contentType: string;
  bytes: number;
}

/** The subset of RTCDataChannel this protocol needs — narrow enough that a plain in-memory
 * mock can stand in for it in tests without touching real WebRTC. */
export interface DataChannelLike {
  readonly bufferedAmount: number;
  bufferedAmountLowThreshold: number;
  binaryType: string;
  send(data: string | ArrayBufferView): void;
  addEventListener(type: string, listener: (event: any) => void): void;
  removeEventListener(type: string, listener: (event: any) => void): void;
}

const CHUNK_SIZE = 64 * 1024;
// Pause sending once this much is buffered locally, resume once it drains below the low
// threshold. Without backpressure, calling send() in a tight loop queues the entire file in
// the browser's memory before any of it reaches the wire.
const BUFFERED_AMOUNT_HIGH = 8 * 1024 * 1024;
const BUFFERED_AMOUNT_LOW = 1 * 1024 * 1024;

// A data channel can report readyState "open" a moment before the underlying transport is
// symmetrically ready — observed in practice as the very first message sent right after open
// occasionally never arriving, even though later messages over the same channel are fully
// reliable. Resending the manifest on an interval until the receiver's "want" arrives costs
// nothing (the receiver only ever acts on the latest one) and turns that race into a non-issue.
const MANIFEST_RETRY_MS = 1000;
const MANIFEST_RETRY_LIMIT = 20;

export interface SendProgress {
  sentBytes: number;
  totalBytes: number;
  ackedFiles: number;
  totalFiles: number;
}

/**
 * runSender waits for the receiver's want-list, then streams each wanted file as
 * {file}<chunks>{file-end}, backpressured on bufferedAmount. It resolves only once every
 * wanted file has been acked — not merely handed to the transport — so a caller can safely
 * close the connection right after this returns without truncating anything in flight.
 */
export async function runSender(
  channel: DataChannelLike,
  files: MediaEntry[],
  readBlob: (hash: string) => Promise<Uint8Array>,
  onProgress?: (p: SendProgress) => void
): Promise<void> {
  channel.binaryType = "arraybuffer";
  channel.bufferedAmountLowThreshold = BUFFERED_AMOUNT_LOW;

  const wanted = await waitForWant(channel, files);
  const wantedFiles = files.filter((f) => wanted.has(f.hash));
  const totalBytes = wantedFiles.reduce((sum, f) => sum + f.bytes, 0);
  const totalFiles = wantedFiles.length;
  let sentBytes = 0;

  const acked = new Set<string>();
  const progress = () => onProgress?.({ sentBytes, totalBytes, ackedFiles: acked.size, totalFiles });
  const allAcked = waitForAllAcked(channel, wanted, (hash) => {
    acked.add(hash);
    progress();
  });
  progress();

  for (const file of wantedFiles) {
    const bytes = await readBlob(file.hash);
    channel.send(JSON.stringify({ t: "file", hash: file.hash, size: bytes.length }));
    for (let offset = 0; offset < bytes.length; offset += CHUNK_SIZE) {
      await waitForBufferLow(channel);
      const chunk = bytes.subarray(offset, Math.min(offset + CHUNK_SIZE, bytes.length));
      channel.send(chunk);
      sentBytes += chunk.length;
      progress();
    }
    channel.send(JSON.stringify({ t: "file-end", hash: file.hash }));
  }

  if (totalFiles > 0) await allAcked;
  channel.send(JSON.stringify({ t: "done" }));
}

function waitForWant(channel: DataChannelLike, files: MediaEntry[]): Promise<Set<string>> {
  const manifestFrame = JSON.stringify({
    t: "manifest",
    files: files.map(({ hash, fileName, contentType, bytes }) => ({ hash, fileName, contentType, bytes })),
  });
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const onMessage = (e: MessageEvent) => {
      if (typeof e.data !== "string") return;
      const msg = JSON.parse(e.data);
      if (msg.t === "want") {
        clearInterval(retry);
        channel.removeEventListener("message", onMessage);
        resolve(new Set<string>(msg.hashes));
      }
    };
    channel.addEventListener("message", onMessage);
    channel.send(manifestFrame);
    const retry = setInterval(() => {
      if (++attempts >= MANIFEST_RETRY_LIMIT) {
        clearInterval(retry);
        channel.removeEventListener("message", onMessage);
        reject(new Error("Timed out waiting for the receiver's want-list"));
        return;
      }
      channel.send(manifestFrame);
    }, MANIFEST_RETRY_MS);
  });
}

/** waitForAllAcked resolves once every hash in wanted has been acked. onAck fires (for
 * progress reporting) as each ack arrives; it does not gate resolution itself. */
function waitForAllAcked(channel: DataChannelLike, wanted: Set<string>, onAck: (hash: string) => void): Promise<void> {
  return new Promise((resolve) => {
    if (wanted.size === 0) return resolve();
    const acked = new Set<string>();
    const onMessage = (e: MessageEvent) => {
      if (typeof e.data !== "string") return;
      const msg = JSON.parse(e.data);
      if (msg.t === "ack" && wanted.has(msg.hash) && !acked.has(msg.hash)) {
        acked.add(msg.hash);
        onAck(msg.hash);
        if (acked.size === wanted.size) {
          channel.removeEventListener("message", onMessage);
          resolve();
        }
      }
    };
    channel.addEventListener("message", onMessage);
  });
}

function waitForBufferLow(channel: DataChannelLike): Promise<void> {
  if (channel.bufferedAmount <= BUFFERED_AMOUNT_HIGH) return Promise.resolve();
  return new Promise((resolve) => {
    const onLow = () => {
      channel.removeEventListener("bufferedamountlow", onLow);
      resolve();
    };
    channel.addEventListener("bufferedamountlow", onLow);
  });
}

export interface ReceiveProgress {
  receivedBytes: number;
  totalBytes: number;
  receivedFiles: number;
  totalFiles: number;
}

export interface ReceiverCallbacks {
  /** hasBlob reports whether this hash is already stored locally, so it's excluded from the
   * want-list (e.g. a resumed or partially-overlapping transfer doesn't re-fetch it). */
  hasBlob: (hash: string) => Promise<boolean>;
  /** onFile receives a verified blob for the caller to persist (e.g. into IndexedDB). */
  onFile: (entry: MediaEntry, bytes: Uint8Array) => Promise<void>;
  onProgress?: (p: ReceiveProgress) => void;
}

/**
 * runReceiver waits for the manifest, sends back a want-list of whatever hasBlob says is
 * missing, then assembles and verifies each incoming file before handing it to onFile and
 * acking it. Resolves once every wanted file has arrived (or immediately, if none are wanted).
 */
export async function runReceiver(channel: DataChannelLike, callbacks: ReceiverCallbacks): Promise<void> {
  channel.binaryType = "arraybuffer";

  const manifest = await waitForManifest(channel);
  const want: MediaEntry[] = [];
  for (const entry of manifest) {
    if (!(await callbacks.hasBlob(entry.hash))) want.push(entry);
  }
  const totalBytes = want.reduce((sum, f) => sum + f.bytes, 0);
  const totalFiles = want.length;
  let receivedBytes = 0;
  let receivedFiles = 0;
  const progress = () => callbacks.onProgress?.({ receivedBytes, totalBytes, receivedFiles, totalFiles });
  progress();

  channel.send(JSON.stringify({ t: "want", hashes: want.map((f) => f.hash) }));
  if (totalFiles === 0) return;

  const byHash = new Map(want.map((f) => [f.hash, f]));
  let current: { entry: MediaEntry; chunks: Uint8Array[]; received: number } | null = null;

  await new Promise<void>((resolve, reject) => {
    const onMessage = (e: MessageEvent) => {
      void (async () => {
        try {
          if (typeof e.data === "string") {
            const msg = JSON.parse(e.data);
            if (msg.t === "file" && byHash.has(msg.hash)) {
              current = { entry: byHash.get(msg.hash)!, chunks: [], received: 0 };
            } else if (msg.t === "file-end" && current && current.entry.hash === msg.hash) {
              const finished = current;
              current = null;
              const bytes = concatChunks(finished.chunks, finished.received);
              const hash = await sha256Hex(bytes);
              if (hash !== finished.entry.hash) {
                // Corrupt or truncated file: dropped silently. The caller sees fewer than
                // totalFiles delivered and can retry the whole room on a fresh attempt —
                // there's no per-file retry inside a single connection.
                return;
              }
              await callbacks.onFile(finished.entry, bytes);
              channel.send(JSON.stringify({ t: "ack", hash: finished.entry.hash }));
              receivedBytes += bytes.length;
              receivedFiles++;
              progress();
              if (receivedFiles === totalFiles) {
                channel.removeEventListener("message", onMessage);
                resolve();
              }
            }
          } else if (current) {
            const chunk = new Uint8Array(e.data as ArrayBuffer);
            current.chunks.push(chunk);
            current.received += chunk.length;
          }
        } catch (err) {
          channel.removeEventListener("message", onMessage);
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      })();
    };
    channel.addEventListener("message", onMessage);
  });
}

function waitForManifest(channel: DataChannelLike): Promise<MediaEntry[]> {
  return new Promise((resolve) => {
    const onMessage = (e: MessageEvent) => {
      if (typeof e.data !== "string") return;
      const msg = JSON.parse(e.data);
      if (msg.t === "manifest") {
        channel.removeEventListener("message", onMessage);
        resolve(msg.files as MediaEntry[]);
      }
    };
    channel.addEventListener("message", onMessage);
  });
}

function concatChunks(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

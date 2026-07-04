// Main-thread wrapper around the .apkg import worker: spawn, translate its phase progress
// into a single 0–1 fraction for the import progress bar, and hand back a result shaped
// exactly like the server's ImportResponse so the merge path can't tell the difference.

import type { ApkgWorkerRequest, ApkgWorkerResponse } from "./worker";
import type { ApkgImportResult } from "./types";

// How each phase maps onto the progress bar. Media hashing dominates parse time and upload
// dominates wall time on a fresh import, so they get the bulk of the bar.
const PHASE_RANGES: Record<"parse" | "media" | "upload", [number, number]> = {
  parse: [0, 0.15],
  media: [0.15, 0.55],
  upload: [0.55, 1],
};

/**
 * clientParseSupported reports whether this environment can run the worker pipeline at all.
 * When false (ancient browser, no WebCrypto, tests under happy-dom) the caller uses the
 * server-parse path — same behavior as before client parsing existed.
 */
export function clientParseSupported(): boolean {
  return typeof Worker !== "undefined" && typeof crypto !== "undefined" && !!crypto.subtle;
}

/**
 * importApkgLocally parses file in a Web Worker. Media is *not* uploaded to the cloud store by
 * default (uploadMedia: false) — P2P (see MediaTransferPanel.tsx) is the primary way media
 * reaches another device now, and the cloud store is only a fallback for when no peer answers.
 * Pass uploadMedia: true to skip straight to the old always-upload behavior. Throws on any
 * failure; the caller falls back to server parsing.
 */
export function importApkgLocally(
  file: File,
  onProgress?: (fraction: number) => void,
  opts: { uploadMedia?: boolean } = {}
): Promise<ApkgImportResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    const finish = (fn: () => void) => {
      worker.terminate();
      fn();
    };

    worker.onmessage = (event: MessageEvent<ApkgWorkerResponse>) => {
      const msg = event.data;
      if (msg.type === "progress") {
        const [from, to] = PHASE_RANGES[msg.phase];
        const within = msg.total > 0 ? msg.current / msg.total : 1;
        onProgress?.(Math.min(1, from + (to - from) * within));
        return;
      }
      if (msg.type === "done") {
        onProgress?.(1);
        finish(() => resolve(sanitize(msg.result)));
        return;
      }
      finish(() => reject(new Error(msg.message)));
    };
    worker.onerror = (event) => {
      // A worker that fails to even load (bad wasm asset path, CSP) surfaces here rather
      // than as a message; treat it exactly like a parse failure so the fallback kicks in.
      finish(() => reject(new Error(event.message || "apkg worker failed to start")));
    };

    const request: ApkgWorkerRequest = { file, uploadMedia: opts.uploadMedia ?? false };
    worker.postMessage(request);
  });
}

/**
 * sanitize replaces the Go-parity nulls (a package with unreadable metadata yields null
 * decks, mirroring Go's nil slices) with empty arrays, which is what the merge code expects.
 */
function sanitize(result: ApkgImportResult): ApkgImportResult {
  return {
    ...result,
    collection: {
      ...result.collection,
      decks: result.collection.decks ?? [],
      deckConfigs: result.collection.deckConfigs ?? [],
      noteTypes: result.collection.noteTypes ?? [],
    },
    mediaManifest: result.mediaManifest ?? [],
  };
}

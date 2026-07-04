import React, { useEffect, useRef, useState } from "react";
import { Cloud, Wifi, X } from "lucide-react";
import type { AnkiMediaRef } from "../utils/anki-v3";
import { ApkgArchive } from "../utils/apkg/archive";
import { maybeDecompressZstd } from "../utils/apkg/media";
import { uploadMissingMedia } from "../utils/apkg/cloudMediaUpload";
import { createRoom, closeRoom, newDeviceId } from "../utils/p2p/signaling";
import { connect, type ConnectHandle } from "../utils/p2p/peer";
import { runSender, type MediaEntry } from "../utils/p2p/transfer";

// Announcing has no hard timeout — the user might take a minute to walk over to their other
// device. The signaling room itself expires after 10 minutes server-side (see main.go
// signalRoomTTL), so that's the natural ceiling; this just needs to comfortably outlast it.
const ANNOUNCE_TIMEOUT_MS = 9 * 60 * 1000;
// After this long with nobody joining, the "use cloud instead" button gets visually promoted
// rather than sitting as a quiet secondary action — the plan's "still worth trying, but here's
// the easy way out" moment.
const PROMOTE_FALLBACK_AFTER_MS = 60_000;

type TransferState =
  | { phase: "announcing" }
  | { phase: "transferring"; sentBytes: number; totalBytes: number; ackedFiles: number; totalFiles: number }
  | { phase: "cloud-fallback"; reason: string }
  | { phase: "uploading"; current: number; total: number }
  | { phase: "done"; via: "p2p" | "cloud" }
  | { phase: "failed"; message: string };

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 ** 2).toFixed(1)} MB`;
}

export interface MediaTransferPanelProps {
  file: File;
  manifest: AnkiMediaRef[];
  email: string;
  onDone: () => void;
}

/**
 * Shown right after a client-side import finds media to move. Direct device-to-device
 * transfer is the primary path — the cloud store is a fallback, used only if no other device
 * answers (or the user chooses not to wait). See docs/plans/2026-07-04-client-apkg-parse-p2p-media.md.
 */
export const MediaTransferPanel: React.FC<MediaTransferPanelProps> = ({ file, manifest, email, onDone }) => {
  const [state, setState] = useState<TransferState>({ phase: "announcing" });
  const [dismissed, setDismissed] = useState(false);
  const [promoteFallback, setPromoteFallback] = useState(false);
  const cancelRef = useRef<(() => void) | null>(null);
  const roomIdRef = useRef<string | null>(null);
  // Set the instant the user clicks "use cloud instead." cancelRef isn't populated until
  // connect() is actually called, which is after the createRoom() network round trip — a
  // click during that window needs somewhere to land so it isn't silently dropped.
  const cloudRequestedRef = useRef(false);

  const totalBytes = manifest.reduce((sum, m) => sum + m.bytes, 0);

  useEffect(() => {
    const promoteTimer = window.setTimeout(() => setPromoteFallback(true), PROMOTE_FALLBACK_AFTER_MS);

    let cancelled = false;
    const deviceId = newDeviceId();
    const entryByHash = new Map<string, AnkiMediaRef>(manifest.map((m) => [m.hash, m]));
    const files: MediaEntry[] = manifest.map((m) => ({ hash: m.hash, fileName: m.fileName, contentType: m.contentType, bytes: m.bytes }));

    const fallbackToCloud = async (reason: string) => {
      if (cancelled) return;
      setState({ phase: "cloud-fallback", reason });
      try {
        const archive = await ApkgArchive.open(file);
        try {
          await uploadMissingMedia(
            manifest.map((m) => ({ hash: m.hash, entryName: m.entryName || "" })).filter((m) => m.entryName),
            async (entryName) => {
              const raw = await archive.read(entryName);
              if (!raw) throw new Error(`media entry ${entryName} vanished from archive`);
              return maybeDecompressZstd(raw);
            },
            (p) => {
              if (!cancelled) setState({ phase: "uploading", current: p.current, total: p.total });
            }
          );
        } finally {
          await archive.close();
        }
        if (!cancelled) setState({ phase: "done", via: "cloud" });
      } catch (err) {
        if (!cancelled) setState({ phase: "failed", message: err instanceof Error ? err.message : "Upload failed." });
      }
    };

    const runP2P = async () => {
      let room;
      try {
        room = await createRoom(email, { mode: "push", deckName: file.name, mediaCount: manifest.length, totalBytes });
      } catch {
        // Signaling itself is unreachable — no point waiting on something that can't work.
        return fallbackToCloud("Couldn't reach the server to start a direct transfer.");
      }
      roomIdRef.current = room.id;
      if (cancelled) return;

      const handle: ConnectHandle = connect({ roomId: room.id, deviceId, role: "offerer", timeoutMs: ANNOUNCE_TIMEOUT_MS });
      cancelRef.current = handle.cancel;
      // The user may have clicked "use cloud instead" while createRoom() was still in
      // flight, before there was a handle to cancel — honor it now instead of leaving the
      // handshake to run for the full ANNOUNCE_TIMEOUT_MS.
      if (cloudRequestedRef.current) handle.cancel();

      let session;
      try {
        session = await handle.promise;
      } catch (err) {
        if (cancelled) return;
        if (cloudRequestedRef.current) return fallbackToCloud("Switched to cloud upload.");
        return fallbackToCloud(err instanceof Error ? err.message : "Direct transfer didn't connect.");
      }
      cancelRef.current = null;
      if (cancelled) {
        session.close();
        return;
      }

      setState({ phase: "transferring", sentBytes: 0, totalBytes, ackedFiles: 0, totalFiles: files.length });
      const archive = await ApkgArchive.open(file);
      try {
        await runSender(
          session.channel,
          files,
          async (hash) => {
            const entry = entryByHash.get(hash);
            if (!entry?.entryName) throw new Error(`no archive entry for ${hash}`);
            const raw = await archive.read(entry.entryName);
            if (!raw) throw new Error(`media entry ${entry.entryName} vanished from archive`);
            return maybeDecompressZstd(raw);
          },
          (p) => {
            if (!cancelled) setState({ phase: "transferring", sentBytes: p.sentBytes, totalBytes: p.totalBytes, ackedFiles: p.ackedFiles, totalFiles: p.totalFiles });
          }
        );
        if (!cancelled) setState({ phase: "done", via: "p2p" });
      } catch (err) {
        if (!cancelled) await fallbackToCloud(err instanceof Error ? err.message : "Direct transfer was interrupted.");
      } finally {
        await archive.close();
        session.close();
      }
    };

    void runP2P();

    return () => {
      cancelled = true;
      window.clearTimeout(promoteTimer);
      cancelRef.current?.();
      if (roomIdRef.current) void closeRoom(roomIdRef.current);
    };
    // Intentionally run once per mount — file/manifest/email identify a single import's
    // transfer and never change under this component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (state.phase === "done") {
      const t = window.setTimeout(onDone, 2500);
      return () => window.clearTimeout(t);
    }
  }, [state.phase, onDone]);

  if (dismissed) return null;

  const useCloudNow = () => {
    cloudRequestedRef.current = true;
    cancelRef.current?.();
  };

  return (
    <div className="fixed bottom-4 right-4 z-50 w-[340px] bg-white border-2 border-zinc-900 rounded-[20px] shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] p-4 text-sm">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 font-bold">
          {state.phase === "cloud-fallback" || state.phase === "uploading" ? <Cloud className="h-4 w-4" /> : <Wifi className="h-4 w-4" />}
          Send this deck's media
        </div>
        <button onClick={() => setDismissed(true)} className="text-zinc-400 hover:text-zinc-900" aria-label="Dismiss">
          <X className="h-4 w-4" />
        </button>
      </div>

      {state.phase === "announcing" && (
        <>
          <p className="text-zinc-600 mb-2">
            Direct device-to-device transfer is the fastest and most reliable way to move media. Open myAnki on your
            other device now and keep both devices online until the transfer finishes.
          </p>
          <p className="text-zinc-500 text-xs mb-3">Waiting for your other device…</p>
        </>
      )}
      {state.phase === "transferring" && (
        <>
          <p className="text-zinc-500 text-xs mb-1">
            Transferring — {state.ackedFiles} / {state.totalFiles} files · {formatBytes(state.sentBytes)} / {formatBytes(state.totalBytes)}
          </p>
          <ProgressBar fraction={state.totalBytes ? state.sentBytes / state.totalBytes : 1} />
        </>
      )}
      {state.phase === "cloud-fallback" && <p className="text-zinc-600 mb-2">{state.reason} Uploading to the cloud instead…</p>}
      {state.phase === "uploading" && (
        <>
          <p className="text-zinc-500 text-xs mb-1">Uploading to cloud — {state.current} / {state.total} files</p>
          <ProgressBar fraction={state.total ? state.current / state.total : 1} />
        </>
      )}
      {state.phase === "done" && (
        <p className="text-emerald-600 font-medium">
          Done ✓ {state.via === "p2p" ? "Sent directly to your other device." : "Uploaded to the cloud."}
        </p>
      )}
      {state.phase === "failed" && <p className="text-red-600">{state.message}</p>}

      {state.phase === "announcing" && (
        <button
          onClick={useCloudNow}
          className={
            promoteFallback
              ? "mt-2 w-full rounded-full border-2 border-zinc-900 bg-zinc-900 text-white py-1.5 font-semibold"
              : "mt-2 text-xs text-zinc-500 underline"
          }
        >
          Upload to cloud instead
        </button>
      )}
    </div>
  );
};

const ProgressBar: React.FC<{ fraction: number }> = ({ fraction }) => (
  <div className="h-2 rounded-full bg-zinc-200 overflow-hidden">
    <div className="h-full bg-zinc-900" style={{ width: `${Math.min(100, Math.round(fraction * 100))}%` }} />
  </div>
);

import React, { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { getMediaBlob, saveMediaBlobPinned, type AnkiMediaRef } from "../utils/anki-v3";
import { createRoom, closeRoom, newDeviceId } from "../utils/p2p/signaling";
import { connect } from "../utils/p2p/peer";
import { runReceiver } from "../utils/p2p/transfer";

// No hard timeout of its own — bounded by the signaling room's 10-minute server-side TTL,
// same reasoning as MediaTransferPanel's ANNOUNCE_TIMEOUT_MS.
const SEED_TIMEOUT_MS = 9 * 60 * 1000;

type SeedState = { phase: "requesting" | "receiving" | "done"; receivedFiles: number; totalFiles: number };

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 ** 2).toFixed(1)} MB`;
}

export interface SeedMediaPanelProps {
  email: string;
  /** Media this device's synced collection references but doesn't have cached locally. */
  manifest: AnkiMediaRef[];
  onDone: () => void;
}

/**
 * Shown on a device that's missing media its own synced collection references — typically a
 * fresh login, or one that fell behind the local 50MB LRU cache. Requests it P2P-first from
 * any of the user's other devices that happen to be online (see SeedResponder.tsx); if none
 * ever answer, nothing breaks — the existing per-card lazy fetch (resolveCardMedia) already
 * covers missing media individually as cards are studied, so this panel is a pure UX
 * accelerator, not a dependency the app needs to work.
 */
export const SeedMediaPanel: React.FC<SeedMediaPanelProps> = ({ email, manifest, onDone }) => {
  const [state, setState] = useState<SeedState>({ phase: "requesting", receivedFiles: 0, totalFiles: manifest.length });
  const [dismissed, setDismissed] = useState(false);
  const roomIdRef = useRef<string | null>(null);

  const totalBytes = manifest.reduce((sum, m) => sum + m.bytes, 0);

  useEffect(() => {
    let cancelled = false;
    const deviceId = newDeviceId();

    const run = async () => {
      let room;
      try {
        room = await createRoom(email, { mode: "pull", mediaCount: manifest.length, totalBytes });
      } catch {
        return; // Signaling unreachable — the per-card lazy fetch remains the fallback.
      }
      roomIdRef.current = room.id;
      if (cancelled) return;

      const handle = connect({ roomId: room.id, deviceId, role: "offerer", timeoutMs: SEED_TIMEOUT_MS });
      let session;
      try {
        session = await handle.promise;
      } catch {
        return; // Nobody came online in time; per-card lazy fetch covers the rest.
      }
      if (cancelled) {
        session.close();
        return;
      }

      setState({ phase: "receiving", receivedFiles: 0, totalFiles: manifest.length });
      try {
        await runReceiver(session.channel, {
          hasBlob: async (hash) => (await getMediaBlob(hash)) !== null,
          onFile: async (entry, bytes) => {
            await saveMediaBlobPinned(
              { hash: entry.hash, fileName: entry.fileName, contentType: entry.contentType, bytes: entry.bytes },
              new Blob([bytes as BlobPart], { type: entry.contentType })
            );
          },
          onProgress: (p) => {
            if (!cancelled) setState({ phase: "receiving", receivedFiles: p.receivedFiles, totalFiles: p.totalFiles });
          },
        });
        if (!cancelled) setState((s) => ({ ...s, phase: "done" }));
      } catch {
        // Partial or interrupted — whatever didn't arrive falls back to per-card lazy fetch.
      } finally {
        session.close();
      }
    };

    void run();
    return () => {
      cancelled = true;
      if (roomIdRef.current) void closeRoom(roomIdRef.current);
    };
    // manifest/email identify a single seeding request and never change under this component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (state.phase === "done") {
      const t = window.setTimeout(onDone, 2000);
      return () => window.clearTimeout(t);
    }
  }, [state.phase, onDone]);

  if (dismissed) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 w-[320px] bg-white border-2 border-zinc-900 rounded-[20px] shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] p-4 text-sm">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="font-bold">Get your media</div>
        <button onClick={() => setDismissed(true)} className="text-zinc-400 hover:text-zinc-900" aria-label="Dismiss">
          <X className="h-4 w-4" />
        </button>
      </div>
      <p className="text-zinc-600 mb-2">
        Open myAnki on a device that has your decks — direct transfer is fastest. Cards fetch media individually as
        you study either way, so nothing's blocked while we wait.
      </p>
      {state.phase !== "done" && (
        <p className="text-zinc-500 text-xs">
          {state.receivedFiles} / {state.totalFiles} files · {formatBytes(totalBytes)} total
        </p>
      )}
      {state.phase === "done" && <p className="text-emerald-600 font-medium">Done ✓ Media received.</p>}
    </div>
  );
};

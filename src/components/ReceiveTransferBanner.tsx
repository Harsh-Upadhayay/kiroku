import React, { useEffect, useRef, useState } from "react";
import { Wifi, X } from "lucide-react";
import { getMediaBlob, saveMediaBlobPinned } from "../utils/anki-v3";
import { listRooms, newDeviceId, type RoomMeta } from "../utils/p2p/signaling";
import { connect } from "../utils/p2p/peer";
import { runReceiver } from "../utils/p2p/transfer";

// How often to check for another of the user's devices offering a transfer. Piggybacked on
// the same cadence as the sync reconcile loop in App.tsx rather than sharing its timer — a
// second independent interval is simpler than threading a shared one through both concerns.
const DISCOVERY_POLL_MS = 15_000;

type ReceiveState =
  | { phase: "idle" }
  | { phase: "receiving"; receivedFiles: number; totalFiles: number; receivedBytes: number; totalBytes: number }
  | { phase: "done" }
  | { phase: "failed"; message: string };

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 ** 2).toFixed(1)} MB`;
}

export interface ReceiveTransferBannerProps {
  email: string;
}

/**
 * Watches for another of the user's devices offering media over P2P (an import in progress
 * elsewhere) and offers to receive it. One room at a time — accepting or dismissing a room
 * clears it before the next poll can surface another.
 */
export const ReceiveTransferBanner: React.FC<ReceiveTransferBannerProps> = ({ email }) => {
  const [room, setRoom] = useState<RoomMeta | null>(null);
  const [state, setState] = useState<ReceiveState>({ phase: "idle" });
  const dismissedRef = useRef<Set<string>>(new Set());
  const busyRef = useRef(false);

  useEffect(() => {
    if (!email) return;
    let stopped = false;
    const poll = async () => {
      if (stopped || busyRef.current || room) return;
      try {
        const rooms = await listRooms(email);
        const candidate = rooms.find((r) => r.mode === "push" && !dismissedRef.current.has(r.id));
        if (candidate && !stopped) setRoom(candidate);
      } catch {
        // Signaling being briefly unreachable just means we try again next poll.
      }
    };
    const interval = window.setInterval(poll, DISCOVERY_POLL_MS);
    void poll();
    return () => {
      stopped = true;
      window.clearInterval(interval);
    };
  }, [email, room]);

  const dismiss = () => {
    if (room) dismissedRef.current.add(room.id);
    setRoom(null);
    setState({ phase: "idle" });
  };

  const accept = async () => {
    if (!room) return;
    busyRef.current = true;
    setState({ phase: "receiving", receivedFiles: 0, totalFiles: room.mediaCount, receivedBytes: 0, totalBytes: room.totalBytes });
    const deviceId = newDeviceId();
    const handle = connect({ roomId: room.id, deviceId, role: "answerer", timeoutMs: 30_000 });
    try {
      const session = await handle.promise;
      try {
        await runReceiver(session.channel, {
          hasBlob: async (hash) => (await getMediaBlob(hash)) !== null,
          onFile: async (entry, bytes) => {
            await saveMediaBlobPinned(
              { hash: entry.hash, fileName: entry.fileName, contentType: entry.contentType, bytes: entry.bytes },
              new Blob([bytes as BlobPart], { type: entry.contentType })
            );
          },
          onProgress: (p) => setState({ phase: "receiving", receivedFiles: p.receivedFiles, totalFiles: p.totalFiles, receivedBytes: p.receivedBytes, totalBytes: p.totalBytes }),
        });
      } finally {
        session.close();
      }
      setState({ phase: "done" });
      dismissedRef.current.add(room.id);
      window.setTimeout(() => {
        setRoom(null);
        setState({ phase: "idle" });
      }, 2500);
    } catch (err) {
      setState({ phase: "failed", message: err instanceof Error ? err.message : "Couldn't receive media." });
      dismissedRef.current.add(room.id);
    } finally {
      busyRef.current = false;
    }
  };

  if (!room) return null;

  return (
    <div className="fixed bottom-4 left-4 z-50 w-[340px] bg-white border-2 border-zinc-900 rounded-[20px] shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] p-4 text-sm">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 font-bold">
          <Wifi className="h-4 w-4" />
          Media available
        </div>
        <button onClick={dismiss} className="text-zinc-400 hover:text-zinc-900" aria-label="Dismiss">
          <X className="h-4 w-4" />
        </button>
      </div>

      {state.phase === "idle" && (
        <>
          <p className="text-zinc-600 mb-3">
            {room.deckName ? `"${room.deckName}"` : "A deck"} is being imported on your other device — receive{" "}
            {room.mediaCount.toLocaleString()} files ({formatBytes(room.totalBytes)}) now?
          </p>
          <div className="flex gap-2">
            <button onClick={accept} className="flex-1 rounded-full border-2 border-zinc-900 bg-zinc-900 text-white py-1.5 font-semibold">
              Receive
            </button>
            <button onClick={dismiss} className="px-3 text-zinc-500">
              Later
            </button>
          </div>
        </>
      )}
      {state.phase === "receiving" && (
        <>
          <p className="text-zinc-500 text-xs mb-1">
            Receiving — {state.receivedFiles} / {state.totalFiles} files · {formatBytes(state.receivedBytes)} / {formatBytes(state.totalBytes)}
          </p>
          <div className="h-2 rounded-full bg-zinc-200 overflow-hidden">
            <div
              className="h-full bg-zinc-900"
              style={{ width: `${state.totalBytes ? Math.min(100, Math.round((state.receivedBytes / state.totalBytes) * 100)) : 100}%` }}
            />
          </div>
        </>
      )}
      {state.phase === "done" && <p className="text-emerald-600 font-medium">Media received — this deck is fully available offline.</p>}
      {state.phase === "failed" && <p className="text-red-600">{state.message}</p>}
    </div>
  );
};

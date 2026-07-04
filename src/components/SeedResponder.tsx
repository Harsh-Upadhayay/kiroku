import React, { useEffect, useRef, useState } from "react";
import { getAllStoredMediaRefs, getMediaBlob } from "../utils/anki-v3";
import { listRooms, newDeviceId } from "../utils/p2p/signaling";
import { connect } from "../utils/p2p/peer";
import { runSender, type MediaEntry } from "../utils/p2p/transfer";

// Same cadence as ReceiveTransferBanner's discovery poll — a separate interval rather than a
// shared one, since the two concerns (accepting an import's media vs. seeding a new device)
// are independent and simpler to reason about apart.
const DISCOVERY_POLL_MS = 15_000;
const RESPOND_TIMEOUT_MS = 30_000;

export interface SeedResponderProps {
  email: string;
}

/**
 * Auto-answers another of the user's devices asking for media it's missing (a fresh login, or
 * one that fell behind the local media cache's LRU eviction). Unlike ReceiveTransferBanner,
 * this needs no confirmation click — it's serving a request from the same account, not
 * accepting a new deck — so it only surfaces a quiet status pill while actively sending.
 */
export const SeedResponder: React.FC<SeedResponderProps> = ({ email }) => {
  const [status, setStatus] = useState<{ sentFiles: number; totalFiles: number } | null>(null);
  const respondedRef = useRef<Set<string>>(new Set());
  const busyRef = useRef(false);

  useEffect(() => {
    if (!email) return;
    let stopped = false;
    const poll = async () => {
      if (stopped || busyRef.current) return;
      try {
        const rooms = await listRooms(email);
        const candidate = rooms.find((r) => r.mode === "pull" && !respondedRef.current.has(r.id));
        if (candidate && !stopped) {
          respondedRef.current.add(candidate.id);
          void respond(candidate.id);
        }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email]);

  const respond = async (roomId: string) => {
    // Nothing to offer — e.g. this is the device that originally imported the deck but never
    // persisted its own media locally (see MediaTransferPanel's doc comment). Skip connecting
    // at all rather than handshaking just to send an empty manifest; it also avoids two
    // devices racing to answer the same room when only one of them actually has anything.
    const stored = await getAllStoredMediaRefs();
    if (stored.length === 0) return;

    busyRef.current = true;
    const deviceId = newDeviceId();
    const handle = connect({ roomId, deviceId, role: "answerer", timeoutMs: RESPOND_TIMEOUT_MS });
    try {
      const session = await handle.promise;
      try {
        const files: MediaEntry[] = stored.map(({ hash, fileName, contentType, bytes }) => ({ hash, fileName, contentType, bytes }));
        setStatus({ sentFiles: 0, totalFiles: files.length });
        await runSender(
          session.channel,
          files,
          async (hash) => {
            const blob = await getMediaBlob(hash);
            if (!blob) throw new Error(`media ${hash} vanished from local store`);
            return new Uint8Array(await blob.arrayBuffer());
          },
          (p) => setStatus({ sentFiles: p.ackedFiles, totalFiles: p.totalFiles })
        );
      } finally {
        session.close();
      }
    } catch {
      // Best-effort: this device just doesn't help this time. The requester's room stays
      // open (until its own timeout) for another device to answer instead.
    } finally {
      busyRef.current = false;
      setStatus(null);
    }
  };

  if (!status) return null;

  return (
    <div className="fixed bottom-20 left-4 z-50 bg-white border-2 border-zinc-900 rounded-full shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] px-4 py-2 text-xs font-bold">
      Sending media to your other device — {status.sentFiles} / {status.totalFiles}
    </div>
  );
};

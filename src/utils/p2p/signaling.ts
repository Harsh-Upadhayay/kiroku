// REST client for the signaling mailbox at backend/internal/signal. This is pure transport —
// creating/discovering/closing rooms and posting/reading the opaque SDP/ICE messages that
// flow through them. The WebRTC-specific meaning of those messages lives in peer.ts.

export type RoomMode = "push" | "pull";

export interface RoomMeta {
  id: string;
  mode: RoomMode;
  deckName?: string;
  mediaCount: number;
  totalBytes: number;
  createdAt: number;
}

export interface SignalMessage {
  from: string;
  seq: number;
  kind: string;
  payload: unknown;
}

async function apiCall<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.success) {
    throw new Error(json.error || `${path} failed: ${res.status}`);
  }
  return json.data as T;
}

function postJSON<T>(path: string, body: unknown): Promise<T> {
  return apiCall<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function createRoom(
  email: string,
  meta: { mode: RoomMode; deckName?: string; mediaCount: number; totalBytes: number }
): Promise<RoomMeta> {
  return postJSON("/api/p2p/rooms", { email, ...meta });
}

export async function listRooms(email: string): Promise<RoomMeta[]> {
  const data = await apiCall<{ rooms: RoomMeta[] }>(`/api/p2p/rooms?email=${encodeURIComponent(email)}`);
  return data.rooms;
}

export async function postMessage(roomId: string, from: string, kind: string, payload: unknown): Promise<number> {
  const data = await postJSON<{ seq: number }>(`/api/p2p/rooms/${encodeURIComponent(roomId)}/messages`, {
    from,
    kind,
    payload,
  });
  return data.seq;
}

export function getMessages(
  roomId: string,
  from: string,
  since: number
): Promise<{ messages: SignalMessage[]; nextSince: number }> {
  return apiCall(
    `/api/p2p/rooms/${encodeURIComponent(roomId)}/messages?from=${encodeURIComponent(from)}&since=${since}`
  );
}

/** closeRoom ends a room. Best-effort: an already-gone or unreachable room isn't an error the
 * caller needs to handle — the room's TTL reclaims it either way. */
export async function closeRoom(roomId: string): Promise<void> {
  await fetch(`/api/p2p/rooms/${encodeURIComponent(roomId)}`, { method: "DELETE" }).catch(() => {});
}

/** deviceId is a per-tab identifier for signaling messages — distinct from the sync client id
 * in sync.ts, since a room only ever has two participants and doesn't need durability. */
export function newDeviceId(): string {
  return crypto.randomUUID();
}

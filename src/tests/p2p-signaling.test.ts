// Unit tests for src/utils/p2p/signaling.ts against a mocked fetch — this is a thin REST
// client, so the tests just pin request shapes and error handling.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRoom, listRooms, postMessage, getMessages, closeRoom } from "../utils/p2p/signaling";

describe("p2p signaling client", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("createRoom posts email + meta and returns the created room", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { id: "room-1", mode: "push", mediaCount: 2, totalBytes: 10, createdAt: 1 } }),
    });

    const room = await createRoom("user@example.com", { mode: "push", deckName: "N5", mediaCount: 2, totalBytes: 10 });

    expect(room.id).toBe("room-1");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/p2p/rooms");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      email: "user@example.com",
      mode: "push",
      deckName: "N5",
      mediaCount: 2,
      totalBytes: 10,
    });
  });

  it("listRooms GETs with the email query param and unwraps the rooms array", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { rooms: [{ id: "r1" }] } }),
    });

    const rooms = await listRooms("a b@example.com");

    expect(rooms).toEqual([{ id: "r1" }]);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/p2p/rooms?email=a%20b%40example.com");
  });

  it("postMessage returns the assigned seq", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: true, data: { seq: 3 } }) });
    const seq = await postMessage("room-1", "device-a", "offer", { sdp: "x" });
    expect(seq).toBe(3);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ from: "device-a", kind: "offer", payload: { sdp: "x" } });
  });

  it("getMessages builds the from/since query string", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: true, data: { messages: [], nextSince: 5 } }) });
    await getMessages("room-1", "device-a", 5);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/p2p/rooms/room-1/messages?from=device-a&since=5");
  });

  it("throws with the server's error message on failure", async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ success: false, error: "Room not found" }) });
    await expect(getMessages("room-1", "device-a", 0)).rejects.toThrow("Room not found");
  });

  it("closeRoom swallows a network failure rather than throwing", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    await expect(closeRoom("room-1")).resolves.toBeUndefined();
  });
});

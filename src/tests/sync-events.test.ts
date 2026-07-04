// Unit tests for connectSyncEvents (src/utils/sync.ts), the live-sync SSE listener: it must
// trigger an immediate pull on another device's poke, ignore its own echoed poke, and degrade
// to a no-op when EventSource isn't available (happy-dom has none, which is also how an old
// browser without EventSource support would behave — same fallback path, exercised for free).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { connectSyncEvents } from "../utils/sync";

const CLIENT_ID_KEY = "kiroku_sync_client_id_v1";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  listeners: Record<string, ((event: MessageEvent) => void)[]> = {};
  closed = false;
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, cb: (event: MessageEvent) => void) {
    (this.listeners[type] ??= []).push(cb);
  }
  close() {
    this.closed = true;
  }
  emit(type: string, data: unknown) {
    for (const cb of this.listeners[type] ?? []) {
      cb({ data: JSON.stringify(data) } as MessageEvent);
    }
  }
}

describe("connectSyncEvents", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    FakeEventSource.instances = [];
    (globalThis as any).EventSource = FakeEventSource;
    localStorage.clear();
    localStorage.setItem(CLIENT_ID_KEY, "this-device");
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: null }),
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    delete (globalThis as any).EventSource;
    vi.unstubAllGlobals();
  });

  it("opens a stream scoped to the given email", () => {
    connectSyncEvents("user@example.com");
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0].url).toBe("/api/sync/events?email=user%40example.com");
  });

  it("pulls immediately when another device pokes", async () => {
    connectSyncEvents("user@example.com");
    FakeEventSource.instances[0].emit("sync", { origin: "other-device", at: 1 });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/sync/pull", expect.anything()));
  });

  it("ignores its own echoed poke", async () => {
    connectSyncEvents("user@example.com");
    FakeEventSource.instances[0].emit("sync", { origin: "this-device", at: 1 });
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("pulls anyway on a malformed poke, since pulling is always safe", async () => {
    connectSyncEvents("user@example.com");
    FakeEventSource.instances[0].emit("sync", "not-json-parseable-as-an-object-with-origin");
    // The handler JSON.parses event.data; a string still parses as valid JSON (a JS string),
    // so `poke?.origin` is undefined and the pull proceeds — this is the "no origin" path.
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/sync/pull", expect.anything()));
  });

  it("closing the connection stops the underlying EventSource", () => {
    const disconnect = connectSyncEvents("user@example.com");
    disconnect();
    expect(FakeEventSource.instances[0].closed).toBe(true);
  });

  it("is a safe no-op when EventSource is unavailable", () => {
    delete (globalThis as any).EventSource;
    expect(() => connectSyncEvents("user@example.com")()).not.toThrow();
  });
});

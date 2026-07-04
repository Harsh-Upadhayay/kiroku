// Unit tests for src/utils/apkg/cloudMediaUpload.ts against a mocked fetch. This is the
// fallback path used both by the import worker (when uploadMedia is explicitly requested) and
// by MediaTransferPanel (when no P2P peer answers), so its retry/batching behavior matters to
// both callers.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { missingHashes, uploadMissingMedia } from "../utils/apkg/cloudMediaUpload";

describe("missingHashes", () => {
  it("returns the server's reported missing subset", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { missing: ["b"] } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const missing = await missingHashes(["a", "b"]);

    expect(missing).toEqual(new Set(["b"]));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ hashes: ["a", "b"] });
    vi.unstubAllGlobals();
  });

  it("treats every hash in a batch as missing when the check request fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const missing = await missingHashes(["a", "b"]);
    expect(missing).toEqual(new Set(["a", "b"]));
    vi.unstubAllGlobals();
  });

  it("batches large hash lists into multiple requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, data: { missing: [] } }) });
    vi.stubGlobal("fetch", fetchMock);
    const hashes = Array.from({ length: 2500 }, (_, i) => `hash-${i}`);
    await missingHashes(hashes);
    expect(fetchMock).toHaveBeenCalledTimes(3); // 1000 + 1000 + 500
    vi.unstubAllGlobals();
  });
});

describe("uploadMissingMedia", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("uploads only the hashes the server reports missing, reading each via readEntry", async () => {
    const manifest = [
      { hash: "present", entryName: "0" },
      { hash: "missing", entryName: "1" },
    ];
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/media/check") return { ok: true, json: async () => ({ success: true, data: { missing: ["missing"] } }) };
      if (url === "/api/media/missing") return { ok: true, json: async () => ({ success: true }) };
      throw new Error("unexpected call to " + url);
    });
    vi.stubGlobal("fetch", fetchMock);
    const readEntry = vi.fn(async () => new Uint8Array([1, 2, 3]));

    const result = await uploadMissingMedia(manifest, readEntry);

    expect(result).toEqual({ uploaded: 1, failed: 0 });
    expect(readEntry).toHaveBeenCalledTimes(1);
    expect(readEntry).toHaveBeenCalledWith("1");
    expect(fetchMock).not.toHaveBeenCalledWith("/api/media/present", expect.anything());
  });

  it("counts a file as failed after retries are exhausted, without aborting the rest", async () => {
    const manifest = [
      { hash: "ok", entryName: "0" },
      { hash: "bad", entryName: "1" },
    ];
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/media/check") return { ok: true, json: async () => ({ success: true, data: { missing: ["ok", "bad"] } }) };
      if (url === "/api/media/bad") return { ok: false, status: 500 };
      return { ok: true, json: async () => ({ success: true }) };
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("setTimeout", ((fn: () => void) => { fn(); return 0; }) as unknown as typeof setTimeout);

    const result = await uploadMissingMedia(manifest, async () => new Uint8Array([1]));

    expect(result).toEqual({ uploaded: 1, failed: 1 });
  });

  it("reports progress reaching the total pending count", async () => {
    const manifest = [{ hash: "a", entryName: "0" }, { hash: "b", entryName: "1" }];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url === "/api/media/check") return { ok: true, json: async () => ({ success: true, data: { missing: ["a", "b"] } }) };
      return { ok: true, json: async () => ({ success: true }) };
    }));
    const seen: number[] = [];

    await uploadMissingMedia(manifest, async () => new Uint8Array([1]), (p) => seen.push(p.current));

    expect(seen.at(-1)).toBe(2);
  });
});

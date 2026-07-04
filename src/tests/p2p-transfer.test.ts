// Protocol tests for src/utils/p2p/transfer.ts, run against an in-memory mock DataChannel
// pair instead of real WebRTC — the DataChannelLike interface is narrow enough that this pair
// is a faithful stand-in for the pieces the protocol actually touches (send/addEventListener/
// bufferedAmount).
import { describe, it, expect, vi } from "vitest";
import { runSender, runReceiver, type DataChannelLike, type MediaEntry } from "../utils/p2p/transfer";

/** A pair of DataChannelLike endpoints that deliver messages to each other asynchronously
 * (queueMicrotask), which is close enough to real DataChannel delivery timing to exercise the
 * protocol's event-driven waits without any real networking. */
function createChannelPair(): [DataChannelLike, DataChannelLike] {
  function makeSide(): { channel: DataChannelLike; listeners: Map<string, Set<(e: any) => void>> } {
    const listeners = new Map<string, Set<(e: any) => void>>();
    const channel: DataChannelLike = {
      bufferedAmount: 0,
      bufferedAmountLowThreshold: 0,
      binaryType: "blob",
      send: () => {
        throw new Error("send should be reassigned by createChannelPair");
      },
      addEventListener: (type, listener) => {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type)!.add(listener);
      },
      removeEventListener: (type, listener) => {
        listeners.get(type)?.delete(listener);
      },
    };
    return { channel, listeners };
  }

  const a = makeSide();
  const b = makeSide();

  const deliver = (listeners: Map<string, Set<(e: any) => void>>, data: unknown) => {
    queueMicrotask(() => {
      for (const listener of listeners.get("message") ?? []) listener({ data });
    });
  };

  a.channel.send = (data) => deliver(b.listeners, data);
  b.channel.send = (data) => deliver(a.listeners, data);

  return [a.channel, b.channel];
}

const FILES: MediaEntry[] = [
  { hash: "hash-a", fileName: "a.mp3", contentType: "audio/mpeg", bytes: 5 },
  { hash: "hash-b", fileName: "b.png", contentType: "image/png", bytes: 200_000 }, // spans multiple 64KiB chunks
];

const BLOBS: Record<string, Uint8Array> = {
  "hash-a": new Uint8Array([1, 2, 3, 4, 5]),
  "hash-b": (() => {
    const arr = new Uint8Array(200_000);
    for (let i = 0; i < arr.length; i++) arr[i] = i % 256;
    return arr;
  })(),
};

// sha256Hex is real (WebCrypto is available under vitest's environment), so hashes must be
// computed from the actual bytes for the receiver's verification step to pass.
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function filesWithRealHashes(): Promise<MediaEntry[]> {
  return Promise.all(
    FILES.map(async (f) => ({ ...f, hash: await sha256Hex(BLOBS[f.hash === "hash-a" ? "hash-a" : "hash-b"]) }))
  );
}

describe("P2P transfer protocol", () => {
  it("transfers every wanted file and the receiver ends up with correct bytes", async () => {
    const files = await filesWithRealHashes();
    const blobsByRealHash: Record<string, Uint8Array> = {
      [files[0].hash]: BLOBS["hash-a"],
      [files[1].hash]: BLOBS["hash-b"],
    };
    const [senderChannel, receiverChannel] = createChannelPair();

    const received: Record<string, Uint8Array> = {};
    const senderProgressCalls: number[] = [];
    const receiverProgressCalls: number[] = [];

    const [senderResult, receiverResult] = await Promise.all([
      runSender(
        senderChannel,
        files,
        async (hash) => blobsByRealHash[hash],
        (p) => senderProgressCalls.push(p.ackedFiles)
      ),
      runReceiver(receiverChannel, {
        hasBlob: async () => false,
        onFile: async (entry, bytes) => {
          received[entry.hash] = bytes;
        },
        onProgress: (p) => receiverProgressCalls.push(p.receivedFiles),
      }),
    ]);

    expect(senderResult).toBeUndefined();
    expect(receiverResult).toBeUndefined();
    expect(Object.keys(received)).toHaveLength(2);
    expect(received[files[0].hash]).toEqual(BLOBS["hash-a"]);
    expect(received[files[1].hash]).toEqual(BLOBS["hash-b"]);
    // Progress must have reached the final count on both sides, not just started.
    expect(senderProgressCalls.at(-1)).toBe(2);
    expect(receiverProgressCalls.at(-1)).toBe(2);
  });

  it("skips files the receiver already has, wanting only the rest", async () => {
    const files = await filesWithRealHashes();
    const blobsByRealHash: Record<string, Uint8Array> = {
      [files[0].hash]: BLOBS["hash-a"],
      [files[1].hash]: BLOBS["hash-b"],
    };
    const [senderChannel, receiverChannel] = createChannelPair();
    const readBlob = vi.fn(async (hash: string) => blobsByRealHash[hash]);
    const received: string[] = [];

    await Promise.all([
      runSender(senderChannel, files, readBlob),
      runReceiver(receiverChannel, {
        hasBlob: async (hash) => hash === files[0].hash, // already has the first file
        onFile: async (entry) => {
          received.push(entry.hash);
        },
      }),
    ]);

    expect(received).toEqual([files[1].hash]);
    // The sender must never even read the blob for a file nobody wanted.
    expect(readBlob).not.toHaveBeenCalledWith(files[0].hash);
  });

  it("resolves immediately when the receiver wants nothing", async () => {
    const files = await filesWithRealHashes();
    const [senderChannel, receiverChannel] = createChannelPair();
    const readBlob = vi.fn(async () => new Uint8Array());

    await Promise.all([
      runSender(senderChannel, files, readBlob),
      runReceiver(receiverChannel, { hasBlob: async () => true, onFile: async () => {} }),
    ]);

    expect(readBlob).not.toHaveBeenCalled();
  });

  it("retries the manifest if the first send is lost before the receiver attaches its listener", async () => {
    // Regression test: real WebRTC data channels can occasionally drop the very first message
    // sent right after the channel reports "open" (observed via a live two-browser E2E, not
    // reproducible through this mock's synchronous delivery) — simulate that by having the
    // channel pair swallow the first send() on the sender's side.
    const files = await filesWithRealHashes();
    const [senderChannel, receiverChannel] = createChannelPair();
    const realSend = senderChannel.send.bind(senderChannel);
    let dropped = false;
    senderChannel.send = (data: any) => {
      if (!dropped && typeof data === "string" && JSON.parse(data).t === "manifest") {
        dropped = true; // swallow only the first manifest frame
        return;
      }
      realSend(data);
    };

    const received: string[] = [];
    await Promise.all([
      runSender(senderChannel, files, async (hash) => (hash === files[0].hash ? BLOBS["hash-a"] : BLOBS["hash-b"])),
      runReceiver(receiverChannel, {
        hasBlob: async () => false,
        onFile: async (entry) => {
          received.push(entry.hash);
        },
      }),
    ]);

    expect(dropped).toBe(true);
    expect(received.sort()).toEqual([files[0].hash, files[1].hash].sort());
  });

  it("drops a file whose received bytes don't hash to the advertised hash", async () => {
    const files: MediaEntry[] = [{ hash: "claimed-hash-does-not-match", fileName: "x.bin", contentType: "application/octet-stream", bytes: 3 }];
    const [senderChannel, receiverChannel] = createChannelPair();
    const onFile = vi.fn(async () => {});

    const senderDone = runSender(senderChannel, files, async () => new Uint8Array([9, 9, 9]));
    // The receiver never gets its wanted file acked (hash mismatch drops it silently), so it
    // would hang forever waiting for receivedFiles === totalFiles — race it against a timeout
    // instead of awaiting it directly.
    const receiverDone = runReceiver(receiverChannel, { hasBlob: async () => false, onFile });
    const outcome = await Promise.race([
      receiverDone.then(() => "resolved"),
      new Promise((resolve) => setTimeout(() => resolve("timed-out"), 200)),
    ]);

    expect(outcome).toBe("timed-out");
    expect(onFile).not.toHaveBeenCalled();
    // The sender is still waiting on an ack that will never come — that's expected for this
    // deliberately-corrupt scenario; nothing here needs it to resolve.
    void senderDone;
  });
});

import { describe, it, expect, vi, afterEach } from "vitest";
import { State } from "ts-fsrs";

// anki-v3.ts imports the IndexedDB-backed db module at load time. The functions under test
// here are pure, so stub the db boundary to keep the suite in-memory (mirrors lookup-deck.test).
vi.mock("../utils/db", () => ({
  getSettingFromDB: vi.fn(async (_key: string, defaultValue: unknown) => defaultValue),
  saveSettingToDB: vi.fn(async () => {}),
  initDB: vi.fn(async () => ({})),
}));

import {
  orderCardsForStudy,
  compareAnkiStudyOrder,
  renderAnkiCard,
  buildCollectionIndex,
  cardSearchText,
  importAnkiPackage,
  type AnkiCard,
  type AnkiCollection,
} from "../utils/anki-v3";

function card(overrides: Partial<AnkiCard>): AnkiCard {
  return {
    id: "1",
    noteId: "n1",
    deckId: "d1",
    ord: 0,
    type: 0,
    queue: 0,
    due: 0,
    interval: 0,
    factor: 0,
    reps: 0,
    lapses: 0,
    ...overrides,
  };
}

describe("orderCardsForStudy", () => {
  it("orders new cards by authored position (due), not import/rowid order", () => {
    // Simulate an import where the array order (rowid) differs from the deck's teaching order.
    const cards = [
      card({ id: "1003", due: 3 }),
      card({ id: "1001", due: 1 }),
      card({ id: "1002", due: 2 }),
    ];
    expect(orderCardsForStudy(cards).map((c) => c.due)).toEqual([1, 2, 3]);
  });

  it("does not mutate the input array", () => {
    const cards = [card({ id: "2", due: 2 }), card({ id: "1", due: 1 })];
    const before = cards.map((c) => c.id);
    orderCardsForStudy(cards);
    expect(cards.map((c) => c.id)).toEqual(before);
  });

  it("places due reviews and learning before new cards, and not-yet-due/suspended last", () => {
    const now = Date.now();
    const today = Math.floor(now / 86400000);
    const learning = card({ id: "L", queue: 1, type: 1, fsrs: { due: new Date(now - 1000).toISOString() } as any });
    const reviewDue = card({ id: "R", queue: 2, type: 2, due: today });
    const newCard = card({ id: "N", queue: 0, type: 0, due: 5 });
    const future = card({ id: "F", queue: 2, type: 2, due: today + 10 });
    const suspended = card({ id: "S", queue: 0, type: 0, due: 1, suspended: true });

    const ordered = orderCardsForStudy([future, suspended, newCard, reviewDue, learning], now).map((c) => c.id);
    // Studyable cards come first in scheduler order; the non-due/suspended cards trail (their
    // relative order among themselves is immaterial).
    expect(ordered.slice(0, 3)).toEqual(["L", "R", "N"]);
    expect(ordered.slice(3).sort()).toEqual(["F", "S"]);
  });

  it("breaks ties on equal position by template ordinal then card id", () => {
    const a = card({ id: "1002", due: 1, ord: 0 });
    const b = card({ id: "1001", due: 1, ord: 1 });
    // Same position: lower ord first; ids are tie-breaker only when ord matches.
    expect(compareAnkiStudyOrder(a, b)).toBeLessThan(0);
  });
});

describe("renderAnkiCard CSS media resolution", () => {
  const collection: AnkiCollection = {
    id: "c",
    name: "c",
    createdAt: 0,
    decks: [{ id: "d1", name: "Deck" }],
    deckConfigs: [],
    noteTypes: [
      {
        id: "m1",
        name: "Model",
        type: 0,
        css: "@font-face { font-family: K; src: url('_Stroke.ttf'); } .card { background: url(\"bg.png\"); }",
        fields: [{ name: "Front", ord: 0 }],
        templates: [{ name: "Card 1", ord: 0, qfmt: "{{Front}}", afmt: "{{FrontSide}}" }],
      },
    ],
    notes: [
      {
        id: "n1",
        guid: "g",
        noteTypeId: "m1",
        tags: [],
        fields: { Front: "hello" },
        fieldOrder: ["Front"],
        rawFields: ["hello"],
      },
    ],
    cards: [card({ id: "1", noteId: "n1", deckId: "d1" })],
    reviewLogs: [],
    mediaManifest: [],
    importReports: [],
    filteredDecks: [],
    schedulerPresets: [],
  };

  it("rewrites CSS url() references to imported blob URLs", () => {
    const mediaUrls = { "_Stroke.ttf": "blob:font", "bg.png": "blob:bg" };
    const rendered = renderAnkiCard(collection, collection.cards[0], mediaUrls);
    expect(rendered?.css).toContain("blob:font");
    expect(rendered?.css).toContain("blob:bg");
    expect(rendered?.css).not.toContain("_Stroke.ttf");
  });

  it("leaves CSS url() untouched when the media is not present", () => {
    const rendered = renderAnkiCard(collection, collection.cards[0], {});
    expect(rendered?.css).toContain("_Stroke.ttf");
  });

  it("renders identically with a CollectionIndex (O(1) lookups) as without", () => {
    const index = buildCollectionIndex(collection);
    const withIndex = renderAnkiCard(collection, collection.cards[0], {}, index);
    const without = renderAnkiCard(collection, collection.cards[0], {});
    expect(withIndex).toEqual(without);
    expect(withIndex?.frontHTML).toContain("hello");
  });

  it("cardSearchText matches the linear-scan result when given an index", () => {
    const index = buildCollectionIndex(collection);
    expect(cardSearchText(collection, collection.cards[0], index)).toBe(
      cardSearchText(collection, collection.cards[0])
    );
    expect(cardSearchText(collection, collection.cards[0], index)).toContain("hello");
  });
});

describe("importAnkiPackage chunked upload", () => {
  const CHUNK = 10 * 1024 * 1024;

  afterEach(() => vi.unstubAllGlobals());

  // A minimal File stand-in: the function only reads name/size/lastModified and slices it.
  // This avoids allocating a real multi-megabyte File in the test.
  function fakeFile(size: number): File {
    return { name: "deck.apkg", size, lastModified: 123, slice: () => new Blob() } as unknown as File;
  }

  function jsonResponse(data: unknown): Response {
    return { ok: true, status: 200, json: async () => data } as unknown as Response;
  }

  // A complete-endpoint payload with the empty-but-present arrays the merge step expects.
  function completePayload() {
    return {
      success: true,
      data: {
        importId: "imp1",
        collection: { decks: [], deckConfigs: [], noteTypes: [], notes: [], cards: [], reviewLogs: [] },
        mediaManifest: [],
        report: {},
      },
    };
  }

  function stubUpload(receivedChunks: number[]) {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.endsWith("/upload/init")) {
        return jsonResponse({ success: true, data: { uploadId: "u1", receivedChunks } });
      }
      if (url.includes("/chunk/")) return jsonResponse({ success: true });
      if (url.endsWith("/complete")) return jsonResponse(completePayload());
      throw new Error("unexpected fetch url: " + url);
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("splits the file into 10MB chunk PUTs, reports progress, and completes", async () => {
    const fetchMock = stubUpload([]);
    const file = fakeFile(CHUNK * 2 + 5); // 3 chunks
    const progress: number[] = [];

    await importAnkiPackage(file, (f) => progress.push(f));

    const calls = fetchMock.mock.calls.map(([url, init]) => ({ url: String(url), method: (init as RequestInit)?.method }));
    const chunkPuts = calls.filter((c) => c.url.includes("/chunk/"));
    expect(chunkPuts).toHaveLength(3);
    expect(chunkPuts.every((c) => c.method === "PUT")).toBe(true);
    expect(calls.some((c) => c.url.endsWith("/upload/init"))).toBe(true);
    expect(calls.some((c) => c.url.endsWith("/complete"))).toBe(true);
    // Progress starts at 0 (nothing on the server) and climbs to a full 1.
    expect(progress[0]).toBe(0);
    expect(progress[progress.length - 1]).toBe(1);
  });

  it("resumes by skipping chunks the server already holds", async () => {
    const fetchMock = stubUpload([0, 2]); // server already has chunks 0 and 2
    const file = fakeFile(CHUNK * 2 + 5); // 3 chunks total

    await importAnkiPackage(file);

    const chunkPuts = fetchMock.mock.calls
      .map(([url]) => String(url))
      .filter((url) => url.includes("/chunk/"));
    expect(chunkPuts).toHaveLength(1); // only the missing chunk 1 is uploaded
    expect(chunkPuts[0]).toContain("/chunk/1");
  });
});

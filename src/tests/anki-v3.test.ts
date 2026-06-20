import { describe, it, expect, vi, afterEach } from "vitest";
import { State } from "ts-fsrs";

// anki-v3.ts imports the IndexedDB-backed db module at load time. The functions under test
// here are pure, so stub the db boundary to keep the suite in-memory (mirrors lookup-deck.test).
vi.mock("../utils/db", () => ({
  getSettingFromDB: vi.fn(async (_key: string, defaultValue: unknown) => defaultValue),
  saveSettingToDB: vi.fn(async () => {}),
  initDB: vi.fn(async () => ({})),
  // DB v4 normalized-store boundary, stubbed so the unit suite stays in-memory.
  deleteSettingFromDB: vi.fn(async () => {}),
  currentUserScope: vi.fn(() => ""),
  replaceAnkiStore: vi.fn(async () => {}),
  getAnkiStoreRecords: vi.fn(async () => []),
  putAnkiRecord: vi.fn(async () => {}),
  countAnkiStore: vi.fn(async () => 0),
  makeAnkiRecord: (user: string, id: string, data: unknown) => ({ key: `${user}|${id}`, user, data }),
  ANKI_CARDS_STORE: "anki_cards",
  ANKI_NOTES_STORE: "anki_notes",
  ANKI_REVLOGS_STORE: "anki_revlogs",
}));

import {
  saveSettingToDB as mockedSaveSettingToDB,
  replaceAnkiStore as mockedReplaceAnkiStore,
} from "../utils/db";

import {
  orderCardsForStudy,
  firstDeckWithCards,
  compareAnkiStudyOrder,
  renderAnkiCard,
  buildCollectionIndex,
  cardSearchText,
  emptyCollection,
  saveAnkiCollection,
  metaOf,
  assembleCollection,
  normalizeCollection,
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

describe("firstDeckWithCards", () => {
  it("skips an empty leading deck (e.g. Anki's Default) and picks the first deck with cards", () => {
    const coll: AnkiCollection = {
      ...emptyCollection(),
      decks: [
        { id: "default", name: "Default" } as any,
        { id: "rrtk", name: "RRTK" } as any,
      ],
      cards: [card({ id: "c1", deckId: "rrtk" })],
    };
    expect(firstDeckWithCards(coll)).toBe("rrtk");
  });

  it("falls back to the first deck when no deck has cards", () => {
    const coll: AnkiCollection = {
      ...emptyCollection(),
      decks: [{ id: "default", name: "Default" } as any],
      cards: [],
    };
    expect(firstDeckWithCards(coll)).toBe("default");
  });

  it("returns \"\" for a collection with no decks", () => {
    expect(firstDeckWithCards(emptyCollection())).toBe("");
  });
});

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

  // Regression for the "[sound:<hash>.mp3] flashes as oversized text" bug: with media lazy-loaded,
  // an unresolved [sound:] tag must never leak its raw filename into the rendered card.
  const soundCollection: AnkiCollection = {
    ...collection,
    notes: [{ ...collection.notes[0], fields: { Front: "Listen.[sound:abc123.mp3]" }, rawFields: ["Listen.[sound:abc123.mp3]"] }],
    mediaManifest: [{ fileName: "abc123.mp3", hash: "h-abc", bytes: 1, contentType: "audio/mpeg" } as any],
  };

  it("renders a neutral placeholder (not the raw tag) for an unresolved [sound:] clip", () => {
    const rendered = renderAnkiCard(soundCollection, soundCollection.cards[0], {});
    // No visible raw tag, but the filename survives in a data attribute so the lazy-media
    // detector still finds and fetches the clip.
    expect(rendered?.frontHTML).not.toContain("[sound:");
    expect(rendered?.frontHTML).toContain("kiroku-audio-pending");
    expect(rendered?.frontHTML).toContain('data-anki-audio="abc123.mp3"');
    expect(rendered?.mediaFiles.some((m) => m.fileName === "abc123.mp3")).toBe(true);
  });

  it("renders an <audio> element once the [sound:] clip resolves to a blob URL", () => {
    const rendered = renderAnkiCard(soundCollection, soundCollection.cards[0], { "abc123.mp3": "blob:clip" });
    expect(rendered?.frontHTML).toContain("<audio");
    expect(rendered?.frontHTML).toContain("blob:clip");
    expect(rendered?.frontHTML).not.toContain("[sound:");
  });
});

describe("saveAnkiCollection writes the normalized stores + meta (Phase 3)", () => {
  afterEach(() => {
    vi.mocked(mockedSaveSettingToDB).mockClear();
    vi.mocked(mockedReplaceAnkiStore).mockClear();
  });

  it("stores the meta blob (big arrays emptied) and the cards in their own store", async () => {
    const coll = { ...emptyCollection(), cards: [card({ id: "c1", noteId: "n1", deckId: "d1" })] };
    await saveAnkiCollection(coll);

    // Meta blob carries everything except the big arrays.
    const metaCall = vi.mocked(mockedSaveSettingToDB).mock.calls.at(-1)!;
    expect(metaCall[0]).toBe("anki_v3_meta");
    expect((metaCall[1] as any).cards).toEqual([]);
    expect((metaCall[1] as any).reviewLogs).toEqual([]);

    // Cards go to the cards store, each wrapping the original (not re-normalized) card object.
    const cardsStoreCall = vi.mocked(mockedReplaceAnkiStore).mock.calls.find((c) => c[0] === "anki_cards")!;
    expect(cardsStoreCall).toBeTruthy();
    expect((cardsStoreCall[2] as any[])[0].data).toBe(coll.cards[0]);
  });
});

describe("collection split/assemble round-trip (Phase 3 migration core)", () => {
  const sample: AnkiCollection = {
    ...emptyCollection(),
    decks: [{ id: "d1", name: "Deck" }],
    notes: [{ id: "n1", guid: "g", noteTypeId: "m1", tags: [], fields: { Front: "x" }, fieldOrder: ["Front"], rawFields: ["x"] }],
    cards: [card({ id: "c1", noteId: "n1", deckId: "d1" }), card({ id: "c2", noteId: "n1", deckId: "d1" })],
    reviewLogs: [{ id: "l1", cardId: "c1", rating: 3, reviewedAt: 1, intervalDays: 1, lastIntervalDays: 0, ease: 2500, type: 0, takenSeconds: 5 } as any],
  };

  it("assembleCollection(metaOf(c), …arrays) reproduces the normalized collection", () => {
    const rebuilt = assembleCollection(metaOf(sample), sample.cards, sample.notes, sample.reviewLogs);
    expect(rebuilt).toEqual(normalizeCollection(sample));
  });

  it("is idempotent: splitting an assembled collection yields the same parts", () => {
    const once = assembleCollection(metaOf(sample), sample.cards, sample.notes, sample.reviewLogs);
    const twice = assembleCollection(metaOf(once), once.cards, once.notes, once.reviewLogs);
    expect(twice).toEqual(once);
    expect(metaOf(once).cards).toEqual([]);
  });
});

describe("importAnkiPackage chunked upload", () => {
  const CHUNK = 10 * 1024 * 1024;

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  // A minimal File stand-in: the function only reads name/size/lastModified and slices it.
  // This avoids allocating a real multi-megabyte File in the test.
  function fakeFile(size: number): File {
    return { name: "deck.apkg", size, lastModified: 123, slice: () => new Blob() } as unknown as File;
  }

  function jsonResponse(data: unknown): Response {
    return { ok: true, status: 200, json: async () => data } as unknown as Response;
  }

  // The import result payload returned by the /status endpoint once parsing is done.
  function importResult() {
    return {
      importId: "imp1",
      collection: { decks: [], deckConfigs: [], noteTypes: [], notes: [], cards: [], reviewLogs: [] },
      mediaManifest: [],
      report: {},
    };
  }

  function stubUpload(receivedChunks: number[]) {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.endsWith("/upload/init")) {
        return jsonResponse({ success: true, data: { uploadId: "u1", receivedChunks } });
      }
      if (url.includes("/chunk/")) return jsonResponse({ success: true });
      // /complete only enqueues the parse job; no result data in the response.
      if (url.endsWith("/complete")) return jsonResponse({ success: true });
      // /status returns the final parse result immediately (simulating a fast server).
      if (url.endsWith("/status")) {
        return jsonResponse({ success: true, data: { status: "done", result: importResult() } });
      }
      throw new Error("unexpected fetch url: " + url);
    });
    vi.stubGlobal("fetch", fetchMock);
    // Use fake timers so pollImportStatus doesn't actually wait 2 s per tick.
    vi.useFakeTimers();
    // Advance time past the poll interval on every setTimeout call.
    vi.stubGlobal("setTimeout", (fn: () => void, _ms?: number) => { fn(); return 0 as unknown as ReturnType<typeof setTimeout>; });
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

import { describe, it, expect, vi } from "vitest";
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
});

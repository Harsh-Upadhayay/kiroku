// Integration tests for the DB v4 normalized Anki storage. Unlike anki-v3.test.ts (which
// mocks the db boundary), these run the REAL db.ts + anki-v3 storage code against a real
// IndexedDB provided by fake-indexeddb — so they cover the cursor-based store replace, index
// reads, the legacy-blob migration, and multi-user isolation that the in-memory mock can't.
import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import {
  getAnkiCollection,
  saveAnkiCollection,
  saveAnkiCard,
  getAnkiSyncDelta,
  commitAnkiSync,
  applyAnkiRemote,
  markAnkiCardsDeleted,
  emptyCollection,
  type AnkiCard,
  type AnkiCollection,
} from "../utils/anki-v3";
import { saveSettingToDB, getSettingFromDB, clearAllIndexedDB, setSyncRequestSuppressed } from "../utils/db";

function card(id: string, deckId = "d1", noteId = "n1"): AnkiCard {
  return {
    id, noteId, deckId, ord: 0, type: 0, queue: 0, due: 0, interval: 0, factor: 0, reps: 0, lapses: 0,
  } as AnkiCard;
}

function collectionWith(cards: AnkiCard[]): AnkiCollection {
  return {
    ...emptyCollection(),
    decks: [{ id: "d1", name: "Deck" }],
    notes: [{ id: "n1", guid: "g", noteTypeId: "m1", tags: [], fields: { Front: "x" }, fieldOrder: ["Front"], rawFields: ["x"] }],
    cards,
    reviewLogs: [{ id: "l1", cardId: "c1" } as any],
  };
}

function setUser(email: string | null) {
  if (email) localStorage.setItem("current_logged_in_user_v1", JSON.stringify({ email }));
  else localStorage.removeItem("current_logged_in_user_v1");
}

beforeEach(async () => {
  setSyncRequestSuppressed(true); // no background sync/network during these tests
  setUser(null);
  await clearAllIndexedDB();
});

describe("normalized Anki storage (DB v4)", () => {
  it("round-trips a collection through the per-record stores", async () => {
    await saveAnkiCollection(collectionWith([card("c1"), card("c2")]));
    const loaded = await getAnkiCollection();
    expect(loaded.cards.map((c) => c.id).sort()).toEqual(["c1", "c2"]);
    expect(loaded.notes).toHaveLength(1);
    expect(loaded.reviewLogs).toHaveLength(1);
    expect(loaded.decks).toHaveLength(1);
  });

  it("saveAnkiCard updates a single card without disturbing the rest", async () => {
    await saveAnkiCollection(collectionWith([card("c1"), card("c2")]));
    await saveAnkiCard({ ...card("c1"), reps: 99 });
    const loaded = await getAnkiCollection();
    expect(loaded.cards).toHaveLength(2);
    expect(loaded.cards.find((c) => c.id === "c1")!.reps).toBe(99);
    expect(loaded.cards.find((c) => c.id === "c2")!.reps).toBe(0);
  });

  it("migrates the legacy blob into stores and deletes the blob only after verifying", async () => {
    // Seed the pre-v4 single-blob layout, with no meta present.
    await saveSettingToDB("anki_v3_collection", collectionWith([card("c1"), card("c2")]));

    const migrated = await getAnkiCollection();
    expect(migrated.cards).toHaveLength(2);

    // Verified migration drops the legacy blob and writes the meta marker.
    expect(await getSettingFromDB("anki_v3_collection", null)).toBeNull();
    expect(await getSettingFromDB("anki_v3_meta", null)).not.toBeNull();

    // A second load now reads purely from the stores and still matches.
    const reloaded = await getAnkiCollection();
    expect(reloaded.cards.map((c) => c.id).sort()).toEqual(["c1", "c2"]);
  });

  it("keeps two accounts on the same browser isolated", async () => {
    setUser("a@example.com");
    await saveAnkiCollection(collectionWith([card("cA")]));

    setUser("b@example.com");
    await saveAnkiCollection(collectionWith([card("cB")]));
    expect((await getAnkiCollection()).cards.map((c) => c.id)).toEqual(["cB"]);

    setUser("a@example.com");
    expect((await getAnkiCollection()).cards.map((c) => c.id)).toEqual(["cA"]);
  });
});

describe("delta sync (Phase 4)", () => {
  it("first push seeds full, then sends only changed cards", async () => {
    await saveAnkiCollection(collectionWith([card("c1"), card("c2")]));

    const seed = (await getAnkiSyncDelta())!;
    expect(seed.snapshot.full).toBe(true);
    expect(seed.cards.map((c) => c.id).sort()).toEqual(["c1", "c2"]);
    await commitAnkiSync(seed.snapshot);

    // After seeding, only a touched card is in the delta.
    await saveAnkiCard({ ...card("c1"), reps: 7 });
    const delta = (await getAnkiSyncDelta())!;
    expect(delta.snapshot.full).toBe(false);
    expect(delta.cards.map((c) => c.id)).toEqual(["c1"]);
    expect(delta.cards[0].reps).toBe(7);

    // Once committed, the dirty set is empty again.
    await commitAnkiSync(delta.snapshot);
    expect((await getAnkiSyncDelta())!.cards).toEqual([]);
  });

  it("tombstones a deleted card and drops it from the dirty set", async () => {
    await saveAnkiCollection(collectionWith([card("c1"), card("c2")]));
    await commitAnkiSync((await getAnkiSyncDelta())!.snapshot);

    await saveAnkiCard({ ...card("c1"), reps: 1 }); // c1 now dirty
    await markAnkiCardsDeleted(["c1"]);

    const delta = (await getAnkiSyncDelta())!;
    expect(delta.deletedCardIds).toContain("c1");
    expect(delta.snapshot.cardIds).not.toContain("c1"); // removed from dirty when tombstoned
  });

  it("applyAnkiRemote upserts pulled cards and applies tombstones incrementally", async () => {
    // Fresh device: apply a pull with two cards.
    await applyAnkiRemote({
      anki_v3_collection: { decks: [{ id: "d1", name: "Deck" }] } as any,
      anki_cards_list: [card("c1"), card("c2")],
      anki_revlogs_list: [],
      deleted_card_ids: [],
    });
    expect((await getAnkiCollection()).cards.map((c) => c.id).sort()).toEqual(["c1", "c2"]);

    // A later pull adds c3 and tombstones c1.
    await applyAnkiRemote({ anki_cards_list: [card("c3")], deleted_card_ids: ["c1"] });
    expect((await getAnkiCollection()).cards.map((c) => c.id).sort()).toEqual(["c2", "c3"]);
  });

  // Regression for #40: a long import lets reconcile pulls fire while the server is still empty.
  // An empty pull must NOT mark the client "seeded", or the next push takes the delta path and the
  // freshly-imported (but not individually-dirty) collection is never uploaded — the deck reaches
  // other devices with 0 cards.
  it("an empty pull after an import does not clobber the pending full seed", async () => {
    // The user imports a deck (resets seeded=false so the next push is a full seed)...
    await saveAnkiCollection(collectionWith([card("c1"), card("c2"), card("c3")]));

    // ...then a reconcile pull lands while the server is still empty. The OLD code marked the
    // client seeded here, so the next push became an empty delta and the deck never uploaded.
    await applyAnkiRemote({ anki_revlogs_list: [], deleted_card_ids: [] });

    const delta = (await getAnkiSyncDelta())!;
    expect(delta.snapshot.full).toBe(true); // still a full seed, not an empty delta
    expect(delta.cards.map((c) => c.id).sort()).toEqual(["c1", "c2", "c3"]);
  });

  it("a non-empty pull marks the client seeded so the next push is a delta", async () => {
    await applyAnkiRemote({
      anki_v3_collection: { decks: [{ id: "d1", name: "Deck" }] } as any,
      anki_cards_list: [card("c1")],
      anki_revlogs_list: [],
      deleted_card_ids: [],
    });
    const delta = (await getAnkiSyncDelta())!;
    expect(delta.snapshot.full).toBe(false);
  });
});

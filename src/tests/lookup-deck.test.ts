import { describe, it, expect } from "vitest";
import { State } from "ts-fsrs";
import {
  lookupCardId,
  createLookupCard,
  normalizeLookupCards,
  gradeLookupCard,
  isLookupCardDue,
  getDueLookupCards,
  type LookupCard,
} from "../utils/lookup-deck";

describe("lookupCardId", () => {
  it("is stable for the same word/kind/reading and distinct otherwise", () => {
    expect(lookupCardId("vocab", "学生", "がくせい")).toBe("lookup-vocab-学生-がくせい");
    expect(lookupCardId("kanji", "海", "カイ / うみ")).not.toBe(lookupCardId("vocab", "海", "カイ / うみ"));
  });
});

describe("createLookupCard", () => {
  it("creates a New card that is immediately due", () => {
    const card = createLookupCard({ kind: "vocab", word: "政府", reading: "せいふ", meanings: ["government"] });
    expect(card.state).toBe(State.New);
    expect(card.reps).toBe(0);
    expect(card.id).toBe("lookup-vocab-政府-せいふ");
    expect(isLookupCardDue(card)).toBe(true);
  });
});

describe("normalizeLookupCards", () => {
  it("drops invalid entries, de-dupes by id, and coerces types", () => {
    const raw = [
      { id: "a", kind: "vocab", word: "犬", reading: "いぬ", meanings: ["dog"] },
      { id: "a", kind: "vocab", word: "犬", reading: "いぬ", meanings: ["dup"] }, // dupe id
      { word: "missing id" }, // invalid
      null,
    ];
    const out = normalizeLookupCards(raw);
    expect(out).toHaveLength(1);
    expect(out[0].word).toBe("犬");
    expect(out[0].state).toBe(State.New);
  });

  it("returns [] for non-arrays", () => {
    expect(normalizeLookupCards(undefined)).toEqual([]);
    expect(normalizeLookupCards("nope")).toEqual([]);
  });
});

describe("gradeLookupCard", () => {
  it("advances FSRS state and pushes the due date into the future on Good", () => {
    const card = createLookupCard({ kind: "vocab", word: "本", reading: "ほん", meanings: ["book"] });
    const later = new Date(Date.now() + 1000);
    const { card: graded, log } = gradeLookupCard(card, 3, later);
    expect(graded.reps).toBe(1);
    expect(graded.state).not.toBe(State.New);
    expect(new Date(graded.due).getTime()).toBeGreaterThan(later.getTime());
    expect(log.cardId).toBe(card.id);
  });
});

describe("getDueLookupCards", () => {
  it("returns only due cards, earliest first", () => {
    const now = Date.now();
    const due1: LookupCard = { ...createLookupCard({ kind: "vocab", word: "1", reading: "", meanings: [] }), due: new Date(now - 5000).toISOString() };
    const due2: LookupCard = { ...createLookupCard({ kind: "vocab", word: "2", reading: "", meanings: [] }), due: new Date(now - 1000).toISOString() };
    const future: LookupCard = { ...createLookupCard({ kind: "vocab", word: "3", reading: "", meanings: [] }), due: new Date(now + 100000).toISOString() };
    const result = getDueLookupCards([future, due2, due1], now);
    expect(result.map((c) => c.word)).toEqual(["1", "2"]);
  });
});

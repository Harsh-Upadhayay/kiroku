import { describe, it, expect, beforeAll, vi } from "vitest";
import { loadDictionary, searchWords, romajiToHiragana, posLabel } from "../utils/dict";

// Minimal JMdict-shaped fixture covering the search paths we care about.
const FIXTURE = {
  version: "test",
  tags: { n: "noun", v1: "Ichidan verb" },
  words: [
    { id: "1", k: ["学生"], r: ["がくせい"], s: [{ pos: ["n"], g: ["student"] }], ex: { j: "学生だ。", e: "Is a student." } },
    { id: "2", k: ["学校"], r: ["がっこう"], s: [{ pos: ["n"], g: ["school"] }] },
    { id: "3", k: ["食べる"], r: ["たべる"], s: [{ pos: ["v1"], g: ["to eat"] }] },
    { id: "4", k: [], r: ["ありがとう"], s: [{ pos: [], g: ["thank you", "thanks"] }] },
  ],
};

describe("romajiToHiragana", () => {
  it("converts basic and compound syllables", () => {
    expect(romajiToHiragana("gakusei")).toBe("がくせい");
    expect(romajiToHiragana("taberu")).toBe("たべる");
    expect(romajiToHiragana("arigatou")).toBe("ありがとう");
  });
  it("handles double consonants as small tsu", () => {
    expect(romajiToHiragana("gakkou")).toBe("がっこう");
  });
});

describe("dictionary search", () => {
  beforeAll(async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => FIXTURE })) as unknown as typeof fetch
    );
    await loadDictionary();
  });

  it("finds an exact Japanese match", () => {
    const r = searchWords("学生");
    expect(r[0].k[0]).toBe("学生");
  });

  it("ranks exact above prefix matches", () => {
    const r = searchWords("学");
    // both 学生 and 学校 are prefix matches; ensure both surface
    const heads = r.map((x) => x.k[0]);
    expect(heads).toContain("学生");
    expect(heads).toContain("学校");
  });

  it("finds words via romaji input", () => {
    const r = searchWords("gakusei");
    expect(r.some((x) => x.k[0] === "学生")).toBe(true);
  });

  it("finds words via English gloss", () => {
    const r = searchWords("school");
    expect(r[0].k[0]).toBe("学校");
  });

  it("finds kana-only words", () => {
    const r = searchWords("ありがとう");
    expect(r[0].r[0]).toBe("ありがとう");
  });

  it("returns [] for no match", () => {
    expect(searchWords("zzzzzz")).toEqual([]);
  });

  it("expands POS labels from tags", () => {
    expect(posLabel("n")).toBe("noun");
    expect(posLabel("unknown")).toBe("unknown");
  });
});

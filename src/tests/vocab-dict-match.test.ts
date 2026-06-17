import { beforeAll, describe, expect, it, vi } from "vitest";
import { genkiRomajiVariants, enrichImportedRowsWithDictionary } from "../utils/vocab-dict-match";

const FIXTURE = {
  version: "test",
  tags: { n: "noun" },
  words: [
    { id: "school-a", k: ["孝行"], r: ["こうこう"], s: [{ pos: ["n"], g: ["filial piety"] }] },
    { id: "school-b", k: ["高校"], r: ["こうこう"], s: [{ pos: ["n"], g: ["high school"] }] },
    { id: "student", k: ["学生"], r: ["がくせい"], s: [{ pos: ["n"], g: ["student"] }] },
    { id: "college-student", k: ["大学生"], r: ["だいがくせい"], s: [{ pos: ["n"], g: ["college student"] }] },
    { id: "major-a", k: ["先行"], r: ["せんこう"], s: [{ pos: ["n"], g: ["going ahead"] }] },
    { id: "major-b", k: ["専攻"], r: ["せんこう"], s: [{ pos: ["n"], g: ["major subject"] }] },
    { id: "america", k: ["亜米利加"], r: ["アメリカ"], s: [{ pos: ["n"], g: ["U.S.A."] }] },
  ],
};

describe("Genki vocab dictionary matching", () => {
  beforeAll(async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => FIXTURE })) as unknown as typeof fetch
    );
  });

  it("generates lookup variants for Genki long-vowel spellings", () => {
    expect(genkiRomajiVariants("daigakusee")).toContain("daigakusei");
    expect(genkiRomajiVariants("kookoo")).toContain("koukou");
    expect(genkiRomajiVariants(". . . nensee")).toContain("nensei");
  });

  it("uses the dictionary card while preserving OCR fields on the sheet", async () => {
    const { rows: [row] } = await enrichImportedRowsWithDictionary([
      {
        id: "row-1",
        section: "School",
        word: "だいがくせい",
        furigana: "だいがくせい",
        romaji: "daigakusee",
        meaning: "college student",
      },
    ]);

    expect(row.word).toBe("大学生");
    expect(row.furigana).toBe("だいがくせい");
    expect(row.romaji).toBe("daigakusee");
    expect(row.meaning).toBe("college student");
    expect(row.ocrWord).toBe("だいがくせい");
    expect(row.dictMatch).toMatchObject({
      id: "college-student",
      word: "大学生",
      reading: "だいがくせい",
      meanings: ["college student"],
    });
  });

  it("uses OCR meaning to pick the correct homophone", async () => {
    const { rows } = await enrichImportedRowsWithDictionary([
      {
        id: "row-2",
        section: "School",
        word: "こうこう",
        furigana: "こうこう",
        romaji: "kookoo",
        meaning: "high school",
      },
      {
        id: "row-3",
        section: "School",
        word: "せんこう",
        furigana: "せんこう",
        romaji: "senkoo",
        meaning: "major",
      },
    ]);

    expect(rows[0].dictMatch?.word).toBe("高校");
    expect(rows[1].dictMatch?.word).toBe("専攻");
  });

  it("keeps katakana loanwords in their printed form instead of ateji", async () => {
    const { rows: [row] } = await enrichImportedRowsWithDictionary([
      {
        id: "row-4",
        section: "Others",
        word: "アメリカ",
        furigana: "あめりか",
        romaji: "Amerika",
        meaning: "U.S.A.",
      },
    ]);

    expect(row.word).toBe("アメリカ");
    expect(row.dictMatch?.word).toBe("アメリカ");
    expect(row.dictMatch?.reading).toBe("アメリカ");
  });
});

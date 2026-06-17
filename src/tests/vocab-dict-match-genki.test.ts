import { describe, expect, it, vi } from "vitest";
import dictData from "../../public/data/jmdict.json";
import genkiPage from "../../backend/internal/vocab/testdata/genki-lesson1-page40-expected.json";

describe("Genki page dictionary resolution", () => {
  it("resolves OCR rows to bundled dictionary entries without inventing phrase cards", async () => {
    vi.resetModules();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => dictData })) as unknown as typeof fetch
    );
    const { enrichImportedRowsWithDictionary } = await import("../utils/vocab-dict-match");
    const { rows } = await enrichImportedRowsWithDictionary(genkiPage.rows.map((row, index) => ({ ...row, id: `genki-${index}` })));

    const byRomaji = new Map(rows.map((row) => [row.romaji, row]));
    expect(byRomaji.get("daigakusee")?.dictMatch?.word).toBe("大学生");
    expect(byRomaji.get("kookoo")?.dictMatch?.word).toBe("高校");
    expect(byRomaji.get("senkoo")?.dictMatch?.word).toBe("専攻");
    expect(byRomaji.get("ichinensee")?.dictMatch?.word).toBe("一年生");
    expect(byRomaji.get("Amerika")?.dictMatch?.word).toBe("アメリカ");

    const phrase = byRomaji.get("niji han");
    expect(phrase?.dictMatch).toBeUndefined();
    expect(phrase?.word).toBe("にじはん");

    for (const row of rows) {
      expect(row.furigana).toBe(row.ocrFurigana);
      expect(row.romaji).toBe(row.ocrRomaji);
      expect(row.meaning).toBe(row.ocrMeaning);
    }
  });
});

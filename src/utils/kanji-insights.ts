import { KANJI_INSIGHTS, RADICAL_MEANINGS, type KanjiInsight } from "../content/n5/kanji-insights";

export interface KanjiPart {
  char: string;
  meaning: string;
  drillable: boolean;
}

export function getKanjiInsight(char: string): KanjiInsight | null {
  return KANJI_INSIGHTS[char] || null;
}

export function hasKanjiInsight(char: string): boolean {
  return Boolean(KANJI_INSIGHTS[char]);
}

export function componentMeaning(char: string): string {
  return KANJI_INSIGHTS[char]?.keyword || RADICAL_MEANINGS[char] || "";
}

export function getKanjiParts(char: string): KanjiPart[] {
  const insight = KANJI_INSIGHTS[char];
  if (!insight) return [];
  return insight.components.map((component) => ({
    char: component,
    meaning: componentMeaning(component),
    drillable: Boolean(KANJI_INSIGHTS[component]),
  }));
}

export function isKanjiChar(char: string): boolean {
  return /\p{Script=Han}/u.test(char);
}

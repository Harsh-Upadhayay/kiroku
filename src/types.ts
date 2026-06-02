export type KanaScript = "hiragana" | "katakana";

export interface KanaCharacter {
  char: string;
  romaji: string;
  row: string;
  script: KanaScript;
  groupId: string;
  strokes?: number;
}

export type HiraganaCharacter = KanaCharacter;

export interface SRSCard {
  char: string;
  romaji: string;
  row: string;
  script?: KanaScript;
  groupId?: string;
  box: number; // Leitner box: 1 to 5
  nextReview: number; // Timestamp in ms
  streak: number;
  updatedAt?: number;
}

export interface SpeedTestSession {
  id: string;
  timestamp: number;
  cpm: number;
  accuracy: number;
  correctCount: number;
  totalCount: number;
  durationSeconds: number;
}

export interface AIHelperResult {
  character: string;
  romaji: string;
  mnemonicText: string;
  associationIdea: string;
  strokeCount: number;
  tip: string;
  examples: Array<{
    word: string;
    reading: string;
    romaji: string;
    meaning: string;
  }>;
}

export const KANA_ROW_ORDER = [
  "Vowels",
  "K-row",
  "S-row",
  "T-row",
  "N-row",
  "H-row",
  "M-row",
  "Y-row",
  "R-row",
  "W-row",
  "Dakuten",
  "Handakuten",
] as const;

export const KANA_SCRIPTS: KanaScript[] = ["hiragana", "katakana"];

export function getKanaGroupId(script: KanaScript, row: string): string {
  return `${script}:${row.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

const rawKanaRows: Record<KanaScript, Array<{ row: string; chars: string[]; romaji: string[] }>> = {
  hiragana: [
    { row: "Vowels", chars: ["あ", "い", "う", "え", "お"], romaji: ["a", "i", "u", "e", "o"] },
    { row: "K-row", chars: ["か", "き", "く", "け", "こ"], romaji: ["ka", "ki", "ku", "ke", "ko"] },
    { row: "S-row", chars: ["さ", "し", "す", "せ", "そ"], romaji: ["sa", "shi", "su", "se", "so"] },
    { row: "T-row", chars: ["た", "ち", "つ", "て", "と"], romaji: ["ta", "chi", "tsu", "te", "to"] },
    { row: "N-row", chars: ["な", "に", "ぬ", "ね", "の"], romaji: ["na", "ni", "nu", "ne", "no"] },
    { row: "H-row", chars: ["は", "ひ", "ふ", "へ", "ほ"], romaji: ["ha", "hi", "fu", "he", "ho"] },
    { row: "M-row", chars: ["ま", "み", "む", "め", "も"], romaji: ["ma", "mi", "mu", "me", "mo"] },
    { row: "Y-row", chars: ["や", "ゆ", "よ"], romaji: ["ya", "yu", "yo"] },
    { row: "R-row", chars: ["ら", "り", "る", "れ", "ろ"], romaji: ["ra", "ri", "ru", "re", "ro"] },
    { row: "W-row", chars: ["わ", "を", "ん"], romaji: ["wa", "wo", "n"] },
    {
      row: "Dakuten",
      chars: ["が", "ぎ", "ぐ", "げ", "ご", "ざ", "じ", "ず", "ぜ", "ぞ", "だ", "ぢ", "づ", "で", "ど", "ば", "び", "ぶ", "べ", "ぼ"],
      romaji: ["ga", "gi", "gu", "ge", "go", "za", "ji", "zu", "ze", "zo", "da", "ji", "zu", "de", "do", "ba", "bi", "bu", "be", "bo"],
    },
    { row: "Handakuten", chars: ["ぱ", "ぴ", "ぷ", "ぺ", "ぽ"], romaji: ["pa", "pi", "pu", "pe", "po"] },
  ],
  katakana: [
    { row: "Vowels", chars: ["ア", "イ", "ウ", "エ", "オ"], romaji: ["a", "i", "u", "e", "o"] },
    { row: "K-row", chars: ["カ", "キ", "ク", "ケ", "コ"], romaji: ["ka", "ki", "ku", "ke", "ko"] },
    { row: "S-row", chars: ["サ", "シ", "ス", "セ", "ソ"], romaji: ["sa", "shi", "su", "se", "so"] },
    { row: "T-row", chars: ["タ", "チ", "ツ", "テ", "ト"], romaji: ["ta", "chi", "tsu", "te", "to"] },
    { row: "N-row", chars: ["ナ", "ニ", "ヌ", "ネ", "ノ"], romaji: ["na", "ni", "nu", "ne", "no"] },
    { row: "H-row", chars: ["ハ", "ヒ", "フ", "ヘ", "ホ"], romaji: ["ha", "hi", "fu", "he", "ho"] },
    { row: "M-row", chars: ["マ", "ミ", "ム", "メ", "モ"], romaji: ["ma", "mi", "mu", "me", "mo"] },
    { row: "Y-row", chars: ["ヤ", "ユ", "ヨ"], romaji: ["ya", "yu", "yo"] },
    { row: "R-row", chars: ["ラ", "リ", "ル", "レ", "ロ"], romaji: ["ra", "ri", "ru", "re", "ro"] },
    { row: "W-row", chars: ["ワ", "ヲ", "ン"], romaji: ["wa", "wo", "n"] },
    {
      row: "Dakuten",
      chars: ["ガ", "ギ", "グ", "ゲ", "ゴ", "ザ", "ジ", "ズ", "ゼ", "ゾ", "ダ", "ヂ", "ヅ", "デ", "ド", "バ", "ビ", "ブ", "ベ", "ボ"],
      romaji: ["ga", "gi", "gu", "ge", "go", "za", "ji", "zu", "ze", "zo", "da", "ji", "zu", "de", "do", "ba", "bi", "bu", "be", "bo"],
    },
    { row: "Handakuten", chars: ["パ", "ピ", "プ", "ペ", "ポ"], romaji: ["pa", "pi", "pu", "pe", "po"] },
  ],
};

function createKanaData(script: KanaScript): KanaCharacter[] {
  return rawKanaRows[script].flatMap((group) =>
    group.chars.map((char, index) => ({
      char,
      romaji: group.romaji[index],
      row: group.row,
      script,
      groupId: getKanaGroupId(script, group.row),
    }))
  );
}

export const HIRAGANA_DATA: HiraganaCharacter[] = createKanaData("hiragana");
export const KATAKANA_DATA: KanaCharacter[] = createKanaData("katakana");
export const KANA_DATA: KanaCharacter[] = [...HIRAGANA_DATA, ...KATAKANA_DATA];

export const KANA_GROUPS = KANA_SCRIPTS.flatMap((script) =>
  KANA_ROW_ORDER.map((row) => ({
    id: getKanaGroupId(script, row),
    script,
    row,
    label: `${script === "hiragana" ? "Hiragana" : "Katakana"} ${row}`,
    count: KANA_DATA.filter((item) => item.script === script && item.row === row).length,
  }))
);

export const DEFAULT_ACTIVE_GROUP_IDS = [getKanaGroupId("hiragana", "Vowels")];

export function inferKanaScript(char: string): KanaScript {
  return /[\u30A0-\u30FF]/.test(char) ? "katakana" : "hiragana";
}

export function getKanaByChar(char: string): KanaCharacter | undefined {
  return KANA_DATA.find((item) => item.char === char);
}

export function getKanaGroupIdForCard(card: Pick<SRSCard, "char" | "row" | "script" | "groupId">): string {
  if (card.groupId) return card.groupId;
  const source = getKanaByChar(card.char);
  if (source) return source.groupId;
  return getKanaGroupId(card.script || inferKanaScript(card.char), card.row);
}

export function getKanaGroupLabel(groupId: string): string {
  return KANA_GROUPS.find((group) => group.id === groupId)?.label || groupId;
}

export function getScriptLabel(script: KanaScript): string {
  return script === "hiragana" ? "Hiragana" : "Katakana";
}

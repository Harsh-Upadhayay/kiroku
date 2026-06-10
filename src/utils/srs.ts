import {
  DEFAULT_ACTIVE_GROUP_IDS,
  KANA_DATA,
  KANA_GROUPS,
  SRSCard,
  getKanaByChar,
  getKanaGroupIdForCard,
  getKanaGroupLabel,
} from "../types";
import { 
  saveAllCardsToDB,
  saveCardToDB,
  logReviewActionToDB,
  saveSettingToDB,
  clearKanaDataFromDB
} from "./db";

// SRS Box Intervals in milliseconds
export const SRS_INTERVALS: { [boxNum: number]: number } = {
  1: 15 * 1000,          // 15 seconds (immediate reinforcement)
  2: 90 * 1000,          // 90 seconds
  3: 5 * 60 * 1000,      // 5 minutes
  4: 1 * 60 * 60 * 1000, // 1 hour
  5: 12 * 60 * 60 * 1000 // 12 hours (mastered)
};

const STORAGE_KEYS = {
  SRS_CARDS: "hiragana_srs_cards_v1",
  SPEED_SESSIONS: "hiragana_speed_sessions_v1",
  SRS_STREAK: "hiragana_srs_streak_v1",
  SRS_HIGH_STREAK: "hiragana_srs_high_streak_v1",
  ACTIVE_ROWS: "hiragana_active_rows_v1",
  ACTIVE_SFX: "hiragana_active_sfx_v1"
};

const KNOWN_GROUP_IDS = new Set(KANA_GROUPS.map((group) => group.id));

function isSameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function normalizeActiveRows(rows: string[] | null | undefined): string[] {
  if (!Array.isArray(rows) || rows.length === 0) {
    return [...DEFAULT_ACTIVE_GROUP_IDS];
  }

  const normalized = rows.flatMap((row) => {
    if (KNOWN_GROUP_IDS.has(row)) return [row];

    const legacyHiraganaRow = KANA_GROUPS.find(
      (group) => group.script === "hiragana" && group.row === row
    );
    return legacyHiraganaRow ? [legacyHiraganaRow.id] : [];
  });

  const unique = Array.from(new Set(normalized));
  return unique.length > 0 ? unique : [...DEFAULT_ACTIVE_GROUP_IDS];
}

export function normalizeSRSCards(cards: SRSCard[] | null | undefined): SRSCard[] {
  const existingByChar = new Map((Array.isArray(cards) ? cards : []).map((card) => [card.char, card]));

  return KANA_DATA.map((kana) => {
    const existing = existingByChar.get(kana.char);
    const box = typeof existing?.box === "number" ? Math.min(5, Math.max(1, existing.box)) : 1;

    return {
      char: kana.char,
      romaji: kana.romaji,
      row: kana.row,
      script: kana.script,
      groupId: kana.groupId,
      box,
      nextReview: typeof existing?.nextReview === "number" ? existing.nextReview : Date.now(),
      streak: typeof existing?.streak === "number" ? existing.streak : 0,
    };
  });
}

export function isCardActive(card: SRSCard, activeRows: string[]): boolean {
  return normalizeActiveRows(activeRows).includes(getKanaGroupIdForCard(card));
}

export function getCardGroupLabel(card: SRSCard): string {
  return getKanaGroupLabel(getKanaGroupIdForCard(card));
}

export function getCardScriptLabel(card: SRSCard): string {
  const source = getKanaByChar(card.char);
  const script = source?.script || card.script || "hiragana";
  return script === "hiragana" ? "Hiragana" : "Katakana";
}

function getUserPrefix(): string {
  try {
    const raw = localStorage.getItem("current_logged_in_user_v1");
    if (!raw) return "";
    const user = JSON.parse(raw);
    if (user && user.email) {
      return "user_scoped_" + user.email.toLowerCase().replace(/[^a-z0-9]/g, "_") + "_";
    }
  } catch (e) {
    // ignore
  }
  return "";
}

function getPrefixedKey(key: string): string {
  return getUserPrefix() + key;
}

export function getStoredSRSCards(): SRSCard[] {
  try {
    const raw = localStorage.getItem(getPrefixedKey(STORAGE_KEYS.SRS_CARDS));
    if (!raw) {
      // Initialize with default state
      return initializeDefaultSRSCards();
    }
    const parsed = JSON.parse(raw) as SRSCard[];
    
    // Safety check in case format was broken
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return initializeDefaultSRSCards();
    }

    const normalized = normalizeSRSCards(parsed);
    if (JSON.stringify(normalized) !== raw) {
      saveSRSCards(normalized);
    }
    return normalized;
  } catch (e) {
    console.error("Failed to parse stored SRS cards, resetting to default.", e);
    return initializeDefaultSRSCards();
  }
}

export function saveSRSCards(cards: SRSCard[]): void {
  const normalized = normalizeSRSCards(cards);
  try {
    localStorage.setItem(getPrefixedKey(STORAGE_KEYS.SRS_CARDS), JSON.stringify(normalized));
    // Asynchronously synchronize with IndexedDB database
    saveAllCardsToDB(normalized).catch((e) => console.error("Failed to write cards to IndexedDB", e));
  } catch (e) {
    console.error("Failed to save SRS cards", e);
  }
}

export function initializeDefaultSRSCards(): SRSCard[] {
  const cards = KANA_DATA.map((item) => ({
    char: item.char,
    romaji: item.romaji,
    row: item.row,
    script: item.script,
    groupId: item.groupId,
    box: 1, // Start in box 1
    nextReview: Date.now(), // Due immediately
    streak: 0,
  }));
  saveSRSCards(cards);
  return cards;
}

export function updateSRSCard(
  cards: SRSCard[],
  char: string,
  isCorrect: boolean
): SRSCard[] {
  let previousBox = 1;
  let newBox = 1;

  const updated = normalizeSRSCards(cards).map((card) => {
    if (card.char !== char) return card;

    previousBox = card.box;
    let nextBox = card.box;
    let nextStreak = card.streak;

    if (isCorrect) {
      nextBox = Math.min(5, card.box + 1);
      nextStreak += 1;
    } else {
      nextBox = 1; // Drop back to Box 1 for immediate review!
      nextStreak = 0;
    }

    newBox = nextBox;
    const interval = SRS_INTERVALS[nextBox];
    const nextReview = Date.now() + interval;

    const updatedCard = {
      ...card,
      box: nextBox,
      streak: nextStreak,
      nextReview,
      updatedAt: Date.now(),
    };

    // Save single card to IndexedDB async
    saveCardToDB(updatedCard).catch((e) => console.error("Failed to write card review to IndexedDB", e));

    return updatedCard;
  });

  // Log the review action to IndexedDB for offline tracking
  logReviewActionToDB(char, isCorrect, previousBox, newBox).catch((e) =>
    console.error("Failed to log review action to IndexedDB", e)
  );

  saveSRSCards(updated);
  return updated;
}

export function getStoredActiveRows(): string[] {
  try {
    const raw = localStorage.getItem(getPrefixedKey(STORAGE_KEYS.ACTIVE_ROWS));
    if (!raw) {
      return [...DEFAULT_ACTIVE_GROUP_IDS]; // Start with only hiragana vowels active
    }
    const parsed = JSON.parse(raw);
    const normalized = normalizeActiveRows(parsed);
    if (!Array.isArray(parsed) || !isSameList(parsed, normalized)) {
      localStorage.setItem(getPrefixedKey(STORAGE_KEYS.ACTIVE_ROWS), JSON.stringify(normalized));
      saveSettingToDB("active_rows", normalized).catch((e) =>
        console.error("Failed to save normalized active rows to IndexedDB", e)
      );
    }
    return normalized;
  } catch {
    return [...DEFAULT_ACTIVE_GROUP_IDS];
  }
}

export function saveActiveRows(rows: string[]): void {
  const normalized = normalizeActiveRows(rows);
  try {
    localStorage.setItem(getPrefixedKey(STORAGE_KEYS.ACTIVE_ROWS), JSON.stringify(normalized));
    // Asynchronously synchronize active rows to IndexedDB
    saveSettingToDB("active_rows", normalized).catch((e) =>
      console.error("Failed to save active rows to IndexedDB", e)
    );
    saveSettingToDB("active_rows_info", { updatedAt: Date.now() }).catch((e) =>
      console.error("Failed to save active row metadata to IndexedDB", e)
    );
  } catch (e) {
    console.error("Failed to save active rows", e);
  }
}

export function getStoredStreak(): { current: number; highest: number } {
  try {
    const current = Number(localStorage.getItem(getPrefixedKey(STORAGE_KEYS.SRS_STREAK)) || "0");
    const highest = Number(localStorage.getItem(getPrefixedKey(STORAGE_KEYS.SRS_HIGH_STREAK)) || "0");
    return { current, highest };
  } catch {
    return { current: 0, highest: 0 };
  }
}

export function updateStoredStreak(correct: boolean): { current: number; highest: number } {
  const { current, highest } = getStoredStreak();
  let nextCurrent = current;
  if (correct) {
    nextCurrent += 1;
  } else {
    nextCurrent = 0;
  }
  const nextHighest = Math.max(highest, nextCurrent);

  try {
    localStorage.setItem(getPrefixedKey(STORAGE_KEYS.SRS_STREAK), String(nextCurrent));
    localStorage.setItem(getPrefixedKey(STORAGE_KEYS.SRS_HIGH_STREAK), String(nextHighest));
    
    // Sync streak setting to IndexedDB
    saveSettingToDB("streak_info", { current: nextCurrent, highest: nextHighest, updatedAt: Date.now() }).catch((e) =>
      console.error("Failed to save streak setting to IndexedDB", e)
    );
  } catch (e) {
    console.error("Failed to save streak statistics", e);
  }

  return { current: nextCurrent, highest: nextHighest };
}

export function resetAllData(): void {
  try {
    localStorage.removeItem(getPrefixedKey(STORAGE_KEYS.SRS_CARDS));
    localStorage.removeItem(getPrefixedKey(STORAGE_KEYS.SPEED_SESSIONS));
    localStorage.setItem(getPrefixedKey(STORAGE_KEYS.SRS_STREAK), "0");
    localStorage.setItem(getPrefixedKey(STORAGE_KEYS.SRS_HIGH_STREAK), "0");
    localStorage.setItem(getPrefixedKey(STORAGE_KEYS.ACTIVE_ROWS), JSON.stringify(DEFAULT_ACTIVE_GROUP_IDS));
    
    // Clear only kana study data; N5/Anki data must survive a kana reset
    clearKanaDataFromDB().catch((e) => console.error("Failed to clear kana data on reset", e));
  } catch (e) {
    console.error("Failed to reset storage content", e);
  }
}

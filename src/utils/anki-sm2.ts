export interface AnkiCard {
  id: string;
  deckId: string;
  front: string;
  back: string;
  noteId?: string;
  modelName?: string;
  fieldOrder?: string[];
  fields?: Record<string, string>;
  rawFields?: string[];
  mnemonic?: string;
  strokeInfo?: string;
  strokeCount?: number;
  tags?: string[];
  flag?: 0 | 1 | 2 | 3 | 4;
  suspended?: boolean;
  buriedUntil?: number;
  added?: number;
  updatedAt?: number;
  firstReviewed?: number;
  lastReviewed?: number;
  totalAnswerSeconds?: number;
  ease: number;      // default: 2.5
  interval: number;  // in days, default: 0
  reps: number;      // number of consecutive correct reviews
  lapses: number;    // number of times card was grade 1 (Again)
  nextReview: number;// Unix timestamp millisecond
  status: "new" | "learning" | "review";
}

export interface AnkiDeck {
  id: string;
  name: string;
  created: number;
  updatedAt?: number;
}

// SM-2 Schedule intervals / details calculated dynamically
export interface SM2Result {
  nextIntervalDays: number;
  newEase: number;
  nextReviewTime: number;
}

/**
 * Calculates next review variables according to the standard Anki/SM-2 spaced repetition algorithm
 * Quality grades:
 * 1 = Again: Forgotten, reset reps and lapse count
 * 2 = Hard: Remembered with severe difficulty, increase interval moderately, drop ease slightly
 * 3 = Good: Normal remember, standard interval factor
 * 4 = Easy: Effortless remember, higher scaling factor, increase ease
 */
export function calculateSM2(
  grade: 1 | 2 | 3 | 4,
  currentIntervalDays: number,
  currentEase: number,
  reps: number
): SM2Result {
  // Defensive coercion: ensure numeric inputs to avoid runtime errors
  const interval = typeof currentIntervalDays === "number" && isFinite(currentIntervalDays) ? currentIntervalDays : 0;
  const easeStart = typeof currentEase === "number" && isFinite(currentEase) ? currentEase : 2.5;

  let nextIntervalDays = 1;
  let newEase = easeStart;

  if (grade === 1) {
    // Again (Forgotten)
    nextIntervalDays = 0; // Means study again in <1 minute during current session
    newEase = Math.max(1.3, easeStart - 0.2);
  } else if (grade === 2) {
    // Hard
    newEase = Math.max(1.3, easeStart - 0.15);
    if (reps === 0) {
      nextIntervalDays = 1; // 1 day
    } else if (reps === 1) {
      nextIntervalDays = 3; // 3 days
    } else {
      nextIntervalDays = Math.ceil(interval * 1.2);
    }
  } else if (grade === 3) {
    // Good (Normal)
    // Ease stays unchanged
    if (reps === 0) {
      nextIntervalDays = 1;
    } else if (reps === 1) {
      nextIntervalDays = 4;
    } else {
      nextIntervalDays = Math.ceil(interval * easeStart);
    }
  } else {
    // Easy
    newEase = easeStart + 0.15;
    if (reps === 0) {
      nextIntervalDays = 4;
    } else if (reps === 1) {
      nextIntervalDays = 8;
    } else {
      nextIntervalDays = Math.ceil(interval * easeStart * 1.3); // Easy bonus 1.3
    }
  }

  // Safety cap on interval
  if (nextIntervalDays > 365) {
    nextIntervalDays = 365;
  }

  // Calculate next due timestamp from now
  let nextReviewTime = Date.now();
  if (nextIntervalDays === 0) {
    // Review again soon in 60 seconds (current session feedback loop)
    nextReviewTime = Date.now() + 60 * 1000;
  } else {
    nextReviewTime = Date.now() + nextIntervalDays * 24 * 60 * 60 * 1000;
  }

  return {
    nextIntervalDays,
    newEase: parseFloat(newEase.toFixed(2)),
    nextReviewTime,
  };
}

/**
 * Format dynamic button tags with human-friendly pending intervals
 */
export function formatIntervalLabel(days: number): string {
  if (days === 0) return "< 1m";
  if (days < 1) return "< 1d";
  if (days === 1) return "1d";
  if (days < 30) return `${days}d`;
  const months = parseFloat((days / 30).toFixed(1));
  return `${months}mo`;
}

export function stripHTML(html: string | undefined): string {
  if (html == null) return "";
  const s = String(html);
  if (!s) return "";
  return s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function sanitizeHTML(html: string | undefined): string {
  if (html == null) return "";
  const s = String(html);
  if (!s) return "";
  return s
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/\son\w+=(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s(href|src)=["']javascript:[^"']*["']/gi, "")
    .trim();
}

function isNumericText(value: string): boolean {
  return /^\s*\d+\s*$/.test(value);
}

function fieldValue(card: AnkiCard, matcher: RegExp): string {
  const entries = Object.entries(card.fields || {});
  const directMatches = entries.filter(([name, value]) => matcher.test(name) && stripHTML(value));
  const nonNumericDirect = directMatches.find(([, value]) => !isNumericText(stripHTML(value)));
  if (nonNumericDirect) return nonNumericDirect[1];
  if (directMatches.length) return directMatches[0][1];

  const contentMatches = entries.filter(([, value]) => matcher.test(stripHTML(value)));
  const nonNumericContent = contentMatches.find(([, value]) => !isNumericText(stripHTML(value)));
  if (nonNumericContent) return nonNumericContent[1];
  return contentMatches[0]?.[1] || "";
}

export function getCardMnemonic(card: AnkiCard): string {
  return (
    card.mnemonic ||
    fieldValue(card, /(mnemonic|story|koohii|remember|hint|primitive)/i) ||
    fieldValue(card, /(heisig|rtk)/i)
  );
}

export function getCardStrokeInfo(card: AnkiCard): string {
  return card.strokeInfo || fieldValue(card, /(stroke|diagram|writing|kanjivg|order)/i);
}

export function getCardAllText(card: AnkiCard): string {
  return [
    card.front,
    card.back,
    card.mnemonic,
    card.strokeInfo,
    ...(card.tags || []),
    ...Object.entries(card.fields || {}).flatMap(([name, value]) => [name, stripHTML(value)]),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function formatDueLabel(timestamp: number): string {
  const diff = timestamp - Date.now();
  if (diff <= 0) return "Due now";
  const minutes = Math.ceil(diff / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.ceil(minutes / 60);
  if (hours < 48) return `${hours}h`;
  const days = Math.ceil(hours / 24);
  if (days < 60) return `${days}d`;
  return `${Math.ceil(days / 30)}mo`;
}

export function isAnkiCardDue(card: AnkiCard, now = Date.now()): boolean {
  return !card.suspended && (!card.buriedUntil || card.buriedUntil <= now) && card.nextReview <= now;
}

export function getAnkiCardState(card: AnkiCard, now = Date.now()): "suspended" | "buried" | "new" | "learning" | "review" | "due" {
  if (card.suspended) return "suspended";
  if (card.buriedUntil && card.buriedUntil > now) return "buried";
  if (card.status === "new") return "new";
  if (card.nextReview <= now) return "due";
  return card.status;
}

/**
 * Parses raw text from exported files (.txt / .csv / pasted strings)
 * Detects delimiters automatically (tabs, semicolons, or commas)
 */
export function parseAnkiTextExport(rawText: string, deckId: string): AnkiCard[] {
  const lines = rawText.split(/\r?\n/);
  const cards: AnkiCard[] = [];

  // Iterate to find suitable delimiter
  let delimiter = "\t"; // Default Tab
  const firstFewLines = lines.slice(0, 5).filter(line => line.trim() && !line.startsWith("#") && !line.startsWith(";"));
  if (firstFewLines.length > 0) {
    const testLine = firstFewLines[0];
    if (testLine.includes("\t")) delimiter = "\t";
    else if (testLine.includes(";")) delimiter = ";";
    else if (testLine.includes(",")) delimiter = ",";
  }

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    // Skip empty lines or Anki export headers (indicated by #)
    if (!trimmed || trimmed.startsWith("#")) return;

    const parts = trimmed.split(delimiter);
    if (parts.length >= 2) {
      const front = parts[0].replace(/^["']|["']$/g, "").trim();
      const back = parts[1].replace(/^["']|["']$/g, "").trim();

      cards.push({
        id: `anki-card-${deckId}-${index}-${Math.floor(Math.random() * 100000)}`,
        deckId,
        front,
        back,
        fields: { Front: front, Back: back },
        fieldOrder: ["Front", "Back"],
        rawFields: [front, back],
        added: Date.now(),
        updatedAt: Date.now(),
        flag: 0,
        suspended: false,
        ease: 2.5,
        interval: 0,
        reps: 0,
        lapses: 0,
        nextReview: Date.now(),
        status: "new",
      });
    }
  });

  return cards;
}

/**
 * Starter Premium Japanese Anki Decks for instant trials
 */
export const STARTER_ANKI_DECKS = [
  {
    name: "JLPT N5 Core Vocabulary",
    id: "deck-starter-vocab",
    cards: [
      { f: "水 (みず)", b: "Water (mizu) - Essential noun for staying hydrated" },
      { f: "猫 (ねこ)", b: "Cat (neko) - Soft domestic feline" },
      { f: "犬 (いぬ)", b: "Dog (inu) - Friendly canine companion" },
      { f: "日本語 (にほんご)", b: "Japanese language (nihongo)" },
      { f: "先生 (せんせい)", b: "Teacher / Instructor (sensei)" },
      { f: "美味しい (おいしい)", b: "Delicious / Tasty (oishii)" },
      { f: "ありがとう", b: "Thank you (arigatou) - Polite gratitude" },
      { f: "お元気ですか (おげんきですか)", b: "How are you? (O-genki desu ka)" },
      { f: "駅 (えき)", b: "Train station (eki) - Public transit hub" },
      { f: "友達 (ともだち)", b: "Friend (tomodachi) - Companion" }
    ]
  },
  {
    name: "Survival Japanese for Travelers",
    id: "deck-starter-travel",
    cards: [
      { f: "すみません", b: "Excuse me / Sorry (sumimasen) - Crucial for catching attention" },
      { f: "これ を ください", b: "Please give me this one (kore wo kudasai) - Ordering food/items" },
      { f: "トイレ は どこ です か?", b: "Where is the restroom? (toire wa doko desu ka?)" },
      { f: "英語 が 話せます か?", b: "Can you speak English? (eigo ga hanasemasu ka?)" },
      { f: "いくら です か?", b: "How much is it? (ikura desu ka?) - Key for shopping" },
      { f: "助けて ください (たすけて)", b: "Please help me! (tasukete kudasai) - Emergency query" }
    ]
  },
  {
    name: "Essential Japanese Kanji Essentials",
    id: "deck-starter-kanji",
    cards: [
      { f: "一 / 二 / 三", b: "One (ichi) / Two (ni) / Three (san)" },
      { f: "日 (ひ / にち)", b: "Day / Sun / Japan source" },
      { f: "本 (ほん)", b: "Book / Origin" },
      { f: "人 (ひと / じん)", b: "Person / Human (hito)" },
      { f: "月 (つき / げつ)", b: "Moon / Month (tsuki)" },
      { f: "水 (みず / すい)", b: "Water (mizu)" },
      { f: "火 (ひ / か)", b: "Fire (hi)" },
      { f: "木 (き / もく)", b: "Tree / Wood (ki)" },
      { f: "金 (かね / きん)", b: "Money / Gold (kane)" },
      { f: "土 (つち / ど)", b: "Earth / Soil (tsuchi)" }
    ]
  }
];

export function loadStarterDeck(deckId: string): { deck: AnkiDeck; cards: AnkiCard[] } {
  const source = STARTER_ANKI_DECKS.find(d => d.id === deckId);
  if (!source) throw new Error("Starter deck not found");

  const deck: AnkiDeck = {
    id: source.id,
    name: source.name,
    created: Date.now(),
    updatedAt: Date.now(),
  };

  const cards: AnkiCard[] = source.cards.map((c, index) => ({
    id: `anki-card-${deck.id}-${index}`,
    deckId: deck.id,
    front: c.f,
    back: c.b,
    fields: { Front: c.f, Back: c.b },
    fieldOrder: ["Front", "Back"],
    rawFields: [c.f, c.b],
    added: Date.now(),
    updatedAt: Date.now(),
    flag: 0,
    suspended: false,
    ease: 2.5,
    interval: 0,
    reps: 0,
    lapses: 0,
    nextReview: Date.now(),
    status: "new",
  }));

  return { deck, cards };
}

/**
 * Fetch all custom Anki Decks from IndexedDB settings store
 */
export async function getAnkiDecks(): Promise<AnkiDeck[]> {
  try {
    const { getSettingFromDB } = await import("./db");
    return await getSettingFromDB<AnkiDeck[]>("anki_decks", []);
  } catch (e) {
    console.error("Failed to load anki decks from DB", e);
    return [];
  }
}

/**
 * Save custom Anki Decks to IndexedDB settings store
 */
export async function saveAnkiDecks(decks: AnkiDeck[]): Promise<void> {
  try {
    const { saveSettingToDB } = await import("./db");
    await saveSettingToDB("anki_decks", decks);
  } catch (e) {
    console.error("Failed to save anki decks to DB", e);
  }
}

/**
 * Fetch all custom Anki Cards from IndexedDB settings store
 */
export async function getAnkiCards(): Promise<AnkiCard[]> {
  try {
    const { getSettingFromDB } = await import("./db");
    return await getSettingFromDB<AnkiCard[]>("anki_cards", []);
  } catch (e) {
    console.error("Failed to load anki cards from DB", e);
    return [];
  }
}

/**
 * Save custom Anki Cards to IndexedDB settings store
 */
export async function saveAnkiCards(cards: AnkiCard[]): Promise<void> {
  try {
    const { saveSettingToDB } = await import("./db");
    await saveSettingToDB("anki_cards", cards);
  } catch (e) {
    console.error("Failed to save anki cards to DB", e);
  }
}

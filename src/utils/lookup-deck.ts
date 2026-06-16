// "My Lookup" deck — a dedicated FSRS-scheduled deck for words/kanji the user
// adds from the dictionary search. Unlike N5 cards (which resolve content from
// the fixed course via contentId), lookup cards embed their own content, so any
// arbitrary word/kanji can become a card with no external content resolver.
//
// Scheduling mirrors src/utils/n5-course.ts (ts-fsrs). Persistence goes through
// saveSettingToDB, which marks the sync state dirty automatically.

import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  State,
  type Card as FSRSCard,
  type FSRSParameters,
  type Grade,
} from "ts-fsrs";
import { getSettingFromDB, saveSettingToDB } from "./db";

export type LookupCardKind = "vocab" | "kanji";
/** 1=Again 2=Hard 3=Good 4=Easy (maps to ts-fsrs Rating). */
export type LookupGrade = 1 | 2 | 3 | 4;

export interface LookupCard {
  id: string;
  kind: LookupCardKind;
  // --- embedded content (shown on the review card) ---
  word: string; // surface form (kanji/kana word, or a single kanji)
  reading: string; // kana reading
  meanings: string[]; // english glosses
  example?: { j: string; e: string };
  // --- bookkeeping ---
  createdAt: number;
  updatedAt: number;
  // --- FSRS scheduling state ---
  due: string; // ISO
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: State;
  last_review?: string;
}

export interface LookupReviewLog {
  id: string;
  cardId: string;
  rating: number;
  reviewedAt: number;
  interval: number;
}

const CARDS_KEY = "lookup_deck_cards_v1";

const DEFAULT_PARAMETERS: FSRSParameters = generatorParameters({
  request_retention: 0.9,
  maximum_interval: 36500,
  enable_fuzz: true,
  enable_short_term: true,
});

/** Stable id so re-adding the same word/kanji dedupes instead of duplicating. */
export function lookupCardId(kind: LookupCardKind, word: string, reading: string): string {
  return `lookup-${kind}-${word}-${reading}`;
}

export interface NewLookupInput {
  kind: LookupCardKind;
  word: string;
  reading: string;
  meanings: string[];
  example?: { j: string; e: string };
}

export function createLookupCard(input: NewLookupInput, now = Date.now()): LookupCard {
  const empty = createEmptyCard(new Date(now));
  return {
    id: lookupCardId(input.kind, input.word, input.reading),
    kind: input.kind,
    word: input.word,
    reading: input.reading,
    meanings: input.meanings,
    example: input.example,
    createdAt: now,
    updatedAt: now,
    // Due immediately: the user explicitly chose to study this, so surface it in
    // the very next review session rather than seeding it a day out.
    due: empty.due.toISOString(),
    stability: empty.stability,
    difficulty: empty.difficulty,
    elapsed_days: 0,
    scheduled_days: 0,
    learning_steps: empty.learning_steps,
    reps: 0,
    lapses: 0,
    state: State.New,
  };
}

function normalizeCard(card: Partial<LookupCard>): LookupCard | null {
  if (!card || !card.id || !card.word) return null;
  return {
    id: String(card.id),
    kind: card.kind === "kanji" ? "kanji" : "vocab",
    word: String(card.word),
    reading: String(card.reading || ""),
    meanings: Array.isArray(card.meanings) ? card.meanings.map(String) : [],
    example: card.example && card.example.j ? { j: String(card.example.j), e: String(card.example.e || "") } : undefined,
    createdAt: Number(card.createdAt || Date.now()),
    updatedAt: Number(card.updatedAt || card.createdAt || Date.now()),
    due: card.due ? String(card.due) : new Date().toISOString(),
    stability: Number(card.stability || 0),
    difficulty: Number(card.difficulty || 0),
    elapsed_days: Number(card.elapsed_days || 0),
    scheduled_days: Number(card.scheduled_days || 0),
    learning_steps: Number(card.learning_steps || 0),
    reps: Number(card.reps || 0),
    lapses: Number(card.lapses || 0),
    state: typeof card.state === "number" ? (card.state as State) : State.New,
    last_review: card.last_review ? String(card.last_review) : undefined,
  };
}

export function normalizeLookupCards(cards: unknown): LookupCard[] {
  if (!Array.isArray(cards)) return [];
  const out: LookupCard[] = [];
  const seen = new Set<string>();
  for (const raw of cards) {
    const card = normalizeCard(raw as Partial<LookupCard>);
    if (card && !seen.has(card.id)) {
      seen.add(card.id);
      out.push(card);
    }
  }
  return out;
}

export async function getLookupCards(): Promise<LookupCard[]> {
  return normalizeLookupCards(await getSettingFromDB<LookupCard[]>(CARDS_KEY, []));
}

export async function saveLookupCards(cards: LookupCard[]): Promise<void> {
  await saveSettingToDB(CARDS_KEY, normalizeLookupCards(cards));
}

/**
 * Add a word/kanji to the lookup deck. De-dupes by stable id; returns whether a
 * new card was added and the resulting deck. Persists + marks sync dirty.
 */
export async function addLookupCard(
  input: NewLookupInput
): Promise<{ added: boolean; card: LookupCard; cards: LookupCard[] }> {
  const cards = await getLookupCards();
  const id = lookupCardId(input.kind, input.word, input.reading);
  const existing = cards.find((c) => c.id === id);
  if (existing) {
    return { added: false, card: existing, cards };
  }
  const card = createLookupCard(input);
  const next = [...cards, card];
  await saveLookupCards(next);
  return { added: true, card, cards: next };
}

export async function removeLookupCard(id: string): Promise<LookupCard[]> {
  const cards = await getLookupCards();
  const next = cards.filter((c) => c.id !== id);
  if (next.length !== cards.length) await saveLookupCards(next);
  return next;
}

export async function hasLookupCard(kind: LookupCardKind, word: string, reading: string): Promise<boolean> {
  const cards = await getLookupCards();
  const id = lookupCardId(kind, word, reading);
  return cards.some((c) => c.id === id);
}

function cardToFSRS(card: LookupCard): FSRSCard {
  return {
    due: new Date(card.due),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    learning_steps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    last_review: card.last_review ? new Date(card.last_review) : undefined,
  };
}

/** Apply an FSRS grade, returning the rescheduled card + a lightweight log. */
export function gradeLookupCard(
  card: LookupCard,
  grade: LookupGrade,
  now = new Date()
): { card: LookupCard; log: LookupReviewLog } {
  const scheduler = fsrs(DEFAULT_PARAMETERS);
  const result = scheduler.next(cardToFSRS(card), now, grade as Grade);
  const next = result.card;
  const updated: LookupCard = {
    ...card,
    due: next.due.toISOString(),
    stability: next.stability,
    difficulty: next.difficulty,
    elapsed_days: next.elapsed_days,
    scheduled_days: next.scheduled_days,
    learning_steps: next.learning_steps,
    reps: next.reps,
    lapses: next.lapses,
    state: next.state,
    last_review: next.last_review?.toISOString(),
    updatedAt: now.getTime(),
  };
  return {
    card: updated,
    log: {
      id: `lookup-fsrs-${card.id}-${now.getTime()}-${grade}`,
      cardId: card.id,
      rating: result.log.rating,
      reviewedAt: now.getTime(),
      interval: result.log.scheduled_days,
    },
  };
}

export function isLookupCardDue(card: LookupCard, now = Date.now()): boolean {
  return new Date(card.due).getTime() <= now;
}

/** Due-now cards, earliest due first. */
export function getDueLookupCards(cards: LookupCard[], now = Date.now()): LookupCard[] {
  return cards
    .filter((c) => isLookupCardDue(c, now))
    .sort((a, b) => new Date(a.due).getTime() - new Date(b.due).getTime());
}

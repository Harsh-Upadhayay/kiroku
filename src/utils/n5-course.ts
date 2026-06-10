import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  Rating,
  State,
  type Card as FSRSCard,
  type FSRSParameters,
  type Grade,
} from "ts-fsrs";
import type { N5CourseData, N5KanjiEntry, N5VocabEntry } from "../content/n5/parser";
import { getSettingFromDB, saveSettingToDB } from "./db";

export type N5Stage = "review" | "grammar" | "vocab" | "kanji" | "produce" | "done";
export type N5CardKind = "vocab" | "kanji";
export type N5Grade = 1 | 2 | 3 | 4;

export const N5_STAGE_ORDER: N5Stage[] = ["review", "grammar", "vocab", "kanji", "produce", "done"];

export interface N5DayProgress {
  day: number;
  stage: N5Stage;
  grammarIndex: number;
  vocabIndex: number;
  kanjiIndex: number;
  stagesCompleted: Partial<Record<N5Stage, boolean>>;
  reviewDeferred?: boolean;
  deferredVocabIds?: string[];
  deferredKanjiIds?: string[];
  updatedAt: number;
}

export interface N5ProductionAnswer {
  promptId: string;
  text: string;
  updatedAt: number;
  clientId: string;
}

export interface N5CheckpointReport {
  checkpointId: string;
  status: "ready" | "not-ready";
  checkedItems: string[];
  note?: string;
  updatedAt: number;
  clientId: string;
}

export interface N5DueTrendPoint {
  date: string;
  dueCount: number;
  updatedAt: number;
}

export interface N5CourseProgress {
  contentVersion: string;
  contentHash: string;
  unlockedDay: number;
  completedDays: number[];
  dayStates: Record<string, N5DayProgress>;
  learnedVocabIds: string[];
  learnedKanjiIds: string[];
  productionAnswers: Record<string, Record<string, N5ProductionAnswer>>;
  checkpointReports: Record<string, N5CheckpointReport>;
  dueCountTrend: N5DueTrendPoint[];
  streak: {
    current: number;
    highest: number;
    lastCompletedDate?: string;
    updatedAt: number;
  };
  currentDay: number;
  updatedAt: number;
  clientId: string;
}

export interface N5SRSCard {
  id: string;
  kind: N5CardKind;
  contentId: string;
  day: number;
  createdAt: number;
  updatedAt: number;
  firstDueSeededAt: number;
  due: string;
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

export interface N5ReviewLog {
  id: string;
  cardId: string;
  kind: N5CardKind;
  rating: Rating;
  state: State;
  reviewedAt: number;
  answerSeconds: number;
  interval: number;
  stability: number;
  difficulty: number;
}

const PROGRESS_KEY = "n5_course_progress";
const CARDS_KEY = "n5_srs_cards";
const LOGS_KEY = "n5_review_logs";
const CLIENT_ID_KEY = "kiroku_n5_client_id_v1";
const MAX_REVIEW_LOGS = 500;

const DEFAULT_PARAMETERS: FSRSParameters = generatorParameters({
  request_retention: 0.9,
  maximum_interval: 36500,
  enable_fuzz: true,
  enable_short_term: true,
});

export async function getN5CourseProgress(course: N5CourseData): Promise<N5CourseProgress> {
  const stored = await getSettingFromDB<Partial<N5CourseProgress> | null>(PROGRESS_KEY, null);
  return normalizeN5Progress(stored, course);
}

export async function saveN5CourseProgress(progress: N5CourseProgress): Promise<void> {
  await saveSettingToDB(PROGRESS_KEY, normalizeN5Progress(progress));
  // Notify listeners (e.g. the app header day counter) that progress changed.
  try {
    window.dispatchEvent(new CustomEvent("kiroku:n5-progress-saved"));
  } catch { /* non-browser context */ }
}

export async function getN5SRSCards(): Promise<N5SRSCard[]> {
  return normalizeN5Cards(await getSettingFromDB<N5SRSCard[]>(CARDS_KEY, []));
}

export async function saveN5SRSCards(cards: N5SRSCard[]): Promise<void> {
  await saveSettingToDB(CARDS_KEY, normalizeN5Cards(cards));
}

export async function getN5ReviewLogs(): Promise<N5ReviewLog[]> {
  return await getSettingFromDB<N5ReviewLog[]>(LOGS_KEY, []);
}

export async function saveN5ReviewLogs(logs: N5ReviewLog[]): Promise<void> {
  await saveSettingToDB(LOGS_KEY, logs.slice(0, MAX_REVIEW_LOGS));
}

export function normalizeN5Progress(input?: Partial<N5CourseProgress> | null, course?: N5CourseData): N5CourseProgress {
  const now = Date.now();
  const clientId = typeof input?.clientId === "string" && input.clientId ? input.clientId : getN5ClientId();
  const fallback: N5CourseProgress = {
    contentVersion: course?.contentVersion || input?.contentVersion || "n5-course-v1",
    contentHash: course?.contentHash || input?.contentHash || "",
    unlockedDay: 1,
    completedDays: [],
    dayStates: {},
    learnedVocabIds: [],
    learnedKanjiIds: [],
    productionAnswers: {},
    checkpointReports: {},
    dueCountTrend: [],
    streak: { current: 0, highest: 0, updatedAt: 0 },
    currentDay: 1,
    updatedAt: now,
    clientId,
  };

  const normalized: N5CourseProgress = {
    ...fallback,
    ...input,
    contentVersion: course?.contentVersion || input?.contentVersion || fallback.contentVersion,
    contentHash: course?.contentHash || input?.contentHash || fallback.contentHash,
    unlockedDay: clampDay(input?.unlockedDay ?? fallback.unlockedDay),
    completedDays: uniqueNumbers(input?.completedDays || []),
    dayStates: normalizeDayStates(input?.dayStates || {}),
    learnedVocabIds: uniqueStrings(input?.learnedVocabIds || []),
    learnedKanjiIds: uniqueStrings(input?.learnedKanjiIds || []),
    productionAnswers: normalizeProductionAnswers(input?.productionAnswers || {}, clientId),
    checkpointReports: normalizeCheckpointReports(input?.checkpointReports || {}, clientId),
    dueCountTrend: normalizeDueTrend(input?.dueCountTrend || []),
    streak: {
      current: Number(input?.streak?.current || 0),
      highest: Number(input?.streak?.highest || 0),
      lastCompletedDate: input?.streak?.lastCompletedDate,
      updatedAt: Number(input?.streak?.updatedAt || 0),
    },
    currentDay: clampDay(input?.currentDay ?? input?.unlockedDay ?? 1),
    updatedAt: Number(input?.updatedAt || now),
    clientId,
  };

  normalized.unlockedDay = Math.max(normalized.unlockedDay, Math.min(30, normalized.completedDays.length + 1));
  normalized.currentDay = Math.min(normalized.currentDay, normalized.unlockedDay);
  return normalized;
}

export function normalizeN5Cards(cards: N5SRSCard[] | null | undefined): N5SRSCard[] {
  if (!Array.isArray(cards)) return [];
  return cards
    .filter((card) => card && typeof card.id === "string" && (card.kind === "vocab" || card.kind === "kanji"))
    .map((card) => ({
      ...card,
      contentId: String(card.contentId || card.id),
      day: Number(card.day || 1),
      createdAt: Number(card.createdAt || Date.now()),
      updatedAt: Number(card.updatedAt || Date.now()),
      firstDueSeededAt: Number(card.firstDueSeededAt || card.createdAt || Date.now()),
      due: String(card.due || new Date().toISOString()),
      stability: Number(card.stability || 0),
      difficulty: Number(card.difficulty || 0),
      elapsed_days: Number(card.elapsed_days || 0),
      scheduled_days: Number(card.scheduled_days || 0),
      learning_steps: Number(card.learning_steps || 0),
      reps: Number(card.reps || 0),
      lapses: Number(card.lapses || 0),
      state: typeof card.state === "number" ? card.state : State.New,
      last_review: card.last_review,
    }));
}

export function effectiveVocabQueue(day: { vocab: N5VocabEntry[] }, state: N5DayProgress): N5VocabEntry[] {
  const deferred = new Set(state.deferredVocabIds || []);
  if (deferred.size === 0) return day.vocab;
  const normal = day.vocab.filter((entry) => !deferred.has(entry.id));
  const deferredItems = (state.deferredVocabIds || []).map((id) => day.vocab.find((entry) => entry.id === id)).filter(Boolean) as N5VocabEntry[];
  return [...normal, ...deferredItems];
}

export function effectiveKanjiQueue(day: { kanji: N5KanjiEntry[] }, state: N5DayProgress): N5KanjiEntry[] {
  const deferred = new Set(state.deferredKanjiIds || []);
  if (deferred.size === 0) return day.kanji;
  const normal = day.kanji.filter((entry) => !deferred.has(entry.kanji));
  const deferredItems = (state.deferredKanjiIds || []).map((id) => day.kanji.find((entry) => entry.kanji === id)).filter(Boolean) as N5KanjiEntry[];
  return [...normal, ...deferredItems];
}

export function deferVocabItem(progress: N5CourseProgress, day: number, entryId: string): N5CourseProgress {
  const state = getN5DayState(progress, day);
  const existing = state.deferredVocabIds || [];
  // Remove from existing deferred list then re-append to put it at the end.
  const updated = [...existing.filter((id) => id !== entryId), entryId];
  return updateN5DayState(progress, day, { deferredVocabIds: updated });
}

export function deferKanjiItem(progress: N5CourseProgress, day: number, kanjiChar: string): N5CourseProgress {
  const state = getN5DayState(progress, day);
  const existing = state.deferredKanjiIds || [];
  const updated = [...existing.filter((id) => id !== kanjiChar), kanjiChar];
  return updateN5DayState(progress, day, { deferredKanjiIds: updated });
}

export function advanceVocabPure(
  progress: N5CourseProgress,
  cards: N5SRSCard[],
  day: number,
  dayPlan: { vocab: N5VocabEntry[] },
  entry: N5VocabEntry,
): { progress: N5CourseProgress; cards: N5SRSCard[] } {
  const withLearned = markN5VocabLearned(progress, cards, day, entry);
  const state = getN5DayState(withLearned.progress, day);
  const queue = effectiveVocabQueue(dayPlan, state);
  const nextIndex = state.vocabIndex + 1;
  const nextProgress = nextIndex >= queue.length
    ? completeN5Stage(withLearned.progress, day, "vocab")
    : updateN5DayState(withLearned.progress, day, { vocabIndex: nextIndex });
  return { progress: nextProgress, cards: withLearned.cards };
}

export function advanceKanjiPure(
  progress: N5CourseProgress,
  cards: N5SRSCard[],
  day: number,
  dayPlan: { kanji: N5KanjiEntry[] },
  entry: N5KanjiEntry,
): { progress: N5CourseProgress; cards: N5SRSCard[] } {
  const withLearned = markN5KanjiLearned(progress, cards, day, entry);
  const state = getN5DayState(withLearned.progress, day);
  const queue = effectiveKanjiQueue(dayPlan, state);
  const nextIndex = state.kanjiIndex + 1;
  const nextProgress = nextIndex >= queue.length
    ? completeN5Stage(withLearned.progress, day, "kanji")
    : updateN5DayState(withLearned.progress, day, { kanjiIndex: nextIndex });
  return { progress: nextProgress, cards: withLearned.cards };
}

export function cardIdForVocab(entry: Pick<N5VocabEntry, "id">): string {
  return `n5:vocab:${entry.id}`;
}

export function cardIdForKanji(entry: Pick<N5KanjiEntry, "kanji">): string {
  return `n5:kanji:${entry.kanji}`;
}

export function isN5CardDue(card: N5SRSCard, now = Date.now()): boolean {
  return new Date(card.due).getTime() <= now;
}

export function dueN5Cards(cards: N5SRSCard[], now = Date.now()): N5SRSCard[] {
  return normalizeN5Cards(cards)
    .filter((card) => isN5CardDue(card, now))
    .sort((a, b) => new Date(a.due).getTime() - new Date(b.due).getTime());
}

/**
 * Queue for a cumulative review session over everything learned so far.
 * Ordering: cards that are due come first (most at risk of being forgotten),
 * then everything else by ascending FSRS retrievability — i.e. the material
 * you are most likely to have forgotten is shown before fresh, solid cards.
 * Reviewing a not-yet-due card is a legal FSRS "early review".
 */
export function buildCumulativeReviewQueue(cards: N5SRSCard[], now = new Date()): N5SRSCard[] {
  const scheduler = fsrs(DEFAULT_PARAMETERS);
  const nowMs = now.getTime();
  return normalizeN5Cards(cards)
    .map((card) => {
      const due = new Date(card.due).getTime() <= nowMs;
      let retrievability = 1;
      try {
        const r = scheduler.get_retrievability(n5CardToFSRS(card), now, false);
        retrievability = typeof r === "number" && Number.isFinite(r) ? r : 0.25;
      } catch {
        retrievability = 0.25; // brand-new card with no review history yet
      }
      return { card, due, retrievability };
    })
    .sort((a, b) => {
      if (a.due !== b.due) return a.due ? -1 : 1;
      return a.retrievability - b.retrievability;
    })
    .map((item) => item.card);
}

export function markN5VocabLearned(
  progress: N5CourseProgress,
  cards: N5SRSCard[],
  day: number,
  entry: N5VocabEntry
): { progress: N5CourseProgress; cards: N5SRSCard[] } {
  const cardId = cardIdForVocab(entry);
  return markN5ItemLearned(progress, cards, day, "vocab", entry.id, cardId);
}

export function markN5KanjiLearned(
  progress: N5CourseProgress,
  cards: N5SRSCard[],
  day: number,
  entry: N5KanjiEntry
): { progress: N5CourseProgress; cards: N5SRSCard[] } {
  const cardId = cardIdForKanji(entry);
  return markN5ItemLearned(progress, cards, day, "kanji", entry.kanji, cardId);
}

export function gradeN5Card(
  card: N5SRSCard,
  grade: N5Grade,
  now = new Date(),
  answerSeconds = 0
): { card: N5SRSCard; log: N5ReviewLog } {
  const scheduler = fsrs(DEFAULT_PARAMETERS);
  const result = scheduler.next(n5CardToFSRS(card), now, grade as Grade);
  const next = result.card;
  const log = result.log;
  const updated: N5SRSCard = {
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
      id: `n5-fsrs-${card.id}-${now.getTime()}-${grade}`,
      cardId: card.id,
      kind: card.kind,
      rating: log.rating,
      state: log.state,
      reviewedAt: now.getTime(),
      answerSeconds,
      interval: log.scheduled_days,
      stability: log.stability,
      difficulty: log.difficulty,
    },
  };
}

export function updateN5DayState(
  progress: N5CourseProgress,
  day: number,
  patch: Partial<N5DayProgress>
): N5CourseProgress {
  const current = getN5DayState(progress, day);
  const updatedAt = Date.now();
  return {
    ...progress,
    currentDay: day,
    dayStates: {
      ...progress.dayStates,
      [String(day)]: {
        ...current,
        ...patch,
        day,
        updatedAt,
      },
    },
    updatedAt,
  };
}

export function getN5DayState(progress: N5CourseProgress, day: number): N5DayProgress {
  const existing = progress.dayStates[String(day)];
  if (existing) return existing;
  return {
    day,
    stage: "review",
    grammarIndex: 0,
    vocabIndex: 0,
    kanjiIndex: 0,
    stagesCompleted: {},
    updatedAt: Date.now(),
  };
}

export function completeN5Stage(progress: N5CourseProgress, day: number, stage: N5Stage): N5CourseProgress {
  const state = getN5DayState(progress, day);
  const updatedCompleted = { ...state.stagesCompleted, [stage]: true };
  const currentIndex = N5_STAGE_ORDER.indexOf(stage);
  // Advance to the first incomplete stage after the current one, or next in order as fallback.
  let nextStage: N5Stage = N5_STAGE_ORDER[Math.min(N5_STAGE_ORDER.length - 1, currentIndex + 1)];
  for (let i = currentIndex + 1; i < N5_STAGE_ORDER.length; i++) {
    if (!updatedCompleted[N5_STAGE_ORDER[i]]) {
      nextStage = N5_STAGE_ORDER[i];
      break;
    }
  }
  return updateN5DayState(progress, day, {
    stage: nextStage,
    stagesCompleted: updatedCompleted,
  });
}

export function updateN5ProductionAnswer(
  progress: N5CourseProgress,
  day: number,
  promptId: string,
  text: string
): N5CourseProgress {
  const updatedAt = Date.now();
  return {
    ...progress,
    productionAnswers: {
      ...progress.productionAnswers,
      [String(day)]: {
        ...(progress.productionAnswers[String(day)] || {}),
        [promptId]: {
          promptId,
          text,
          updatedAt,
          clientId: progress.clientId,
        },
      },
    },
    updatedAt,
  };
}

export function recordN5DueTrend(progress: N5CourseProgress, dueCount: number): N5CourseProgress {
  const today = localDateKey();
  const updatedAt = Date.now();
  const byDate = new Map(progress.dueCountTrend.map((point) => [point.date, point]));
  byDate.set(today, { date: today, dueCount, updatedAt });
  const dueCountTrend = Array.from(byDate.values())
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-10);
  return { ...progress, dueCountTrend, updatedAt };
}

export function completeN5Day(progress: N5CourseProgress, day: number): N5CourseProgress {
  const today = localDateKey();
  const completedDays = uniqueNumbers([...progress.completedDays, day]);
  const unlockedDay = Math.min(30, Math.max(progress.unlockedDay, day + 1));
  const streakCurrent = progress.streak.lastCompletedDate === today
    ? progress.streak.current
    : progress.streak.lastCompletedDate === previousLocalDateKey(today)
      ? progress.streak.current + 1
      : 1;
  const updatedAt = Date.now();
  return {
    ...progress,
    completedDays,
    unlockedDay,
    currentDay: unlockedDay,
    streak: {
      current: streakCurrent,
      highest: Math.max(progress.streak.highest, streakCurrent),
      lastCompletedDate: today,
      updatedAt,
    },
    updatedAt,
    dayStates: {
      ...progress.dayStates,
      [String(day)]: {
        ...getN5DayState(progress, day),
        stage: "done",
        stagesCompleted: {
          ...getN5DayState(progress, day).stagesCompleted,
          review: true,
          grammar: true,
          vocab: true,
          kanji: true,
          produce: true,
          done: true,
        },
        updatedAt,
      },
    },
  };
}

export function saveN5CheckpointReport(
  progress: N5CourseProgress,
  checkpointId: string,
  status: "ready" | "not-ready",
  checkedItems: string[],
  note = ""
): N5CourseProgress {
  const updatedAt = Date.now();
  return {
    ...progress,
    checkpointReports: {
      ...progress.checkpointReports,
      [checkpointId]: {
        checkpointId,
        status,
        checkedItems,
        note,
        updatedAt,
        clientId: progress.clientId,
      },
    },
    updatedAt,
  };
}

export function formatN5Due(value: string | number): string {
  const timestamp = typeof value === "number" ? value : new Date(value).getTime();
  const diff = timestamp - Date.now();
  if (diff <= 0) return "now";
  const minutes = Math.ceil(diff / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.ceil(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.ceil(hours / 24)}d`;
}

function markN5ItemLearned(
  progress: N5CourseProgress,
  cards: N5SRSCard[],
  day: number,
  kind: N5CardKind,
  contentId: string,
  cardId: string
): { progress: N5CourseProgress; cards: N5SRSCard[] } {
  const existingCards = normalizeN5Cards(cards);
  const hasCard = existingCards.some((card) => card.id === cardId);
  const nextCards = hasCard ? existingCards : [...existingCards, createInitialN5Card(cardId, kind, contentId, day)];
  const now = Date.now();
  const learnedKey = kind === "vocab" ? "learnedVocabIds" : "learnedKanjiIds";
  return {
    cards: nextCards,
    progress: {
      ...progress,
      [learnedKey]: uniqueStrings([...(progress[learnedKey] as string[]), contentId]),
      updatedAt: now,
    },
  };
}

function createInitialN5Card(id: string, kind: N5CardKind, contentId: string, day: number): N5SRSCard {
  const now = Date.now();
  const empty = createEmptyCard(new Date(now));
  const due = new Date(now + firstDueDelayMs(id));
  return {
    id,
    kind,
    contentId,
    day,
    createdAt: now,
    updatedAt: now,
    firstDueSeededAt: now,
    due: due.toISOString(),
    stability: empty.stability,
    difficulty: empty.difficulty,
    elapsed_days: 0,
    scheduled_days: 1,
    learning_steps: empty.learning_steps,
    reps: 0,
    lapses: 0,
    state: State.New,
  };
}

function n5CardToFSRS(card: N5SRSCard): FSRSCard {
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

function firstDueDelayMs(id: string): number {
  const twentyHours = 20 * 60 * 60 * 1000;
  const twentyFourHours = 24 * 60 * 60 * 1000;
  return twentyHours + (stableHashNumber(id) % twentyFourHours);
}

function stableHashNumber(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function getN5ClientId(): string {
  try {
    const existing = localStorage.getItem(CLIENT_ID_KEY);
    if (existing) return existing;
    const generated = crypto.randomUUID ? crypto.randomUUID() : `n5-client-${Date.now()}-${Math.random()}`;
    localStorage.setItem(CLIENT_ID_KEY, generated);
    return generated;
  } catch {
    return `n5-client-${Date.now()}`;
  }
}

function normalizeDayStates(input: Record<string, N5DayProgress>): Record<string, N5DayProgress> {
  return Object.fromEntries(Object.entries(input || {}).map(([key, state]) => {
    const day = clampDay(Number(state?.day || key || 1));
    return [String(day), {
      day,
      stage: N5_STAGE_ORDER.includes(state?.stage) ? state.stage : "review",
      grammarIndex: Math.max(0, Number(state?.grammarIndex || 0)),
      vocabIndex: Math.max(0, Number(state?.vocabIndex || 0)),
      kanjiIndex: Math.max(0, Number(state?.kanjiIndex || 0)),
      stagesCompleted: state?.stagesCompleted || {},
      reviewDeferred: Boolean(state?.reviewDeferred),
      deferredVocabIds: uniqueStrings(state?.deferredVocabIds || []),
      deferredKanjiIds: uniqueStrings(state?.deferredKanjiIds || []),
      updatedAt: Number(state?.updatedAt || 0),
    }];
  }));
}

function normalizeProductionAnswers(input: N5CourseProgress["productionAnswers"], clientId: string): N5CourseProgress["productionAnswers"] {
  return Object.fromEntries(Object.entries(input || {}).map(([day, answers]) => [
    day,
    Object.fromEntries(Object.entries(answers || {}).map(([promptId, answer]) => [
      promptId,
      {
        promptId: answer?.promptId || promptId,
        text: String(answer?.text || ""),
        updatedAt: Number(answer?.updatedAt || 0),
        clientId: answer?.clientId || clientId,
      },
    ])),
  ]));
}

function normalizeCheckpointReports(input: Record<string, N5CheckpointReport>, clientId: string): Record<string, N5CheckpointReport> {
  return Object.fromEntries(Object.entries(input || {}).map(([id, report]) => [
    id,
    {
      checkpointId: report?.checkpointId || id,
      status: report?.status === "not-ready" ? "not-ready" : "ready",
      checkedItems: uniqueStrings(report?.checkedItems || []),
      note: report?.note || "",
      updatedAt: Number(report?.updatedAt || 0),
      clientId: report?.clientId || clientId,
    },
  ]));
}

function normalizeDueTrend(input: N5DueTrendPoint[]): N5DueTrendPoint[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((point) => point && typeof point.date === "string")
    .map((point) => ({ date: point.date, dueCount: Number(point.dueCount || 0), updatedAt: Number(point.updatedAt || 0) }))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-10);
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set((Array.isArray(values) ? values : []).map(String).filter(Boolean)));
}

function uniqueNumbers(values: number[]): number[] {
  return Array.from(new Set((Array.isArray(values) ? values : []).map(Number).filter((value) => Number.isFinite(value))))
    .sort((a, b) => a - b);
}

function clampDay(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(30, Math.max(1, Math.round(value)));
}

function localDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function previousLocalDateKey(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() - 1);
  return localDateKey(date);
}

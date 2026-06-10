import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  ChevronLeft,
  Flame,
  GraduationCap,
  Lock,
  Map,
  Mic2,
  Play,
  Wifi,
  WifiOff,
} from "lucide-react";
import { motion } from "motion/react";
import { n5Course } from "../content/n5/raw";
import type { N5DayPlan, N5GrammarPoint, N5KanjiEntry, N5VocabEntry } from "../content/n5/parser";
import {
  N5_STAGE_ORDER,
  cardIdForKanji,
  cardIdForVocab,
  completeN5Day,
  completeN5Stage,
  dueN5Cards,
  formatN5Due,
  getN5CourseProgress,
  getN5DayState,
  getN5ReviewLogs,
  getN5SRSCards,
  gradeN5Card,
  markN5KanjiLearned,
  markN5VocabLearned,
  recordN5DueTrend,
  saveN5CheckpointReport,
  saveN5CourseProgress,
  saveN5ReviewLogs,
  saveN5SRSCards,
  updateN5DayState,
  updateN5ProductionAnswer,
  type N5CourseProgress,
  type N5DayProgress,
  type N5Grade,
  type N5ProductionAnswer,
  type N5ReviewLog,
  type N5SRSCard,
  type N5Stage,
} from "../utils/n5-course";
import { hasSyncDirtyState, syncEvents } from "../utils/sync";
import { sound } from "../utils/audio";

type ViewMode = "home" | "lesson" | "map";

const gradeLabels: Record<N5Grade, string> = {
  1: "Again",
  2: "Hard",
  3: "Good",
  4: "Easy",
};

export const N5CoursePage: React.FC = () => {
  const [progress, setProgress] = useState<N5CourseProgress | null>(null);
  const [cards, setCards] = useState<N5SRSCard[]>([]);
  const [logs, setLogs] = useState<N5ReviewLog[]>([]);
  const [mode, setMode] = useState<ViewMode>("home");
  const [lessonDay, setLessonDay] = useState<number | null>(null);
  const [readOnly, setReadOnly] = useState(false);
  const [revisitState, setRevisitState] = useState<N5DayProgress | null>(null);
  const [isBackShown, setIsBackShown] = useState(false);
  const [reviewStartedAt, setReviewStartedAt] = useState(Date.now());
  const [syncDirty, setSyncDirty] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isLoading, setIsLoading] = useState(true);

  const dueCards = useMemo(() => dueN5Cards(cards), [cards]);
  const currentDayNumber = progress ? Math.min(progress.currentDay || progress.unlockedDay, progress.unlockedDay) : 1;
  const focusDay = n5Course.days[currentDayNumber - 1] || n5Course.days[0];
  const activeDayNumber = lessonDay || currentDayNumber;
  const activeDay = n5Course.days[activeDayNumber - 1] || focusDay;
  const activeState = progress
    ? readOnly
      ? revisitState || defaultRevisitState(activeDayNumber)
      : getN5DayState(progress, activeDayNumber)
    : defaultRevisitState(activeDayNumber);

  useEffect(() => {
    reload();
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    const unsubscribe = syncEvents.subscribe(reload);
    const interval = window.setInterval(() => setSyncDirty(hasSyncDirtyState()), 2500);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.clearInterval(interval);
      unsubscribe();
    };
  }, []);

  async function reload() {
    setIsLoading(true);
    const [loadedProgress, loadedCards, loadedLogs] = await Promise.all([
      getN5CourseProgress(n5Course),
      getN5SRSCards(),
      getN5ReviewLogs(),
    ]);
    const trended = recordN5DueTrend(loadedProgress, dueN5Cards(loadedCards).length);
    setProgress(trended);
    setCards(loadedCards);
    setLogs(loadedLogs);
    setSyncDirty(hasSyncDirtyState());
    setIsLoading(false);
    if (JSON.stringify(trended.dueCountTrend) !== JSON.stringify(loadedProgress.dueCountTrend)) {
      await saveN5CourseProgress(trended);
    }
  }

  async function persistProgress(next: N5CourseProgress) {
    setProgress(next);
    await saveN5CourseProgress(next);
    setSyncDirty(true);
  }

  async function persistCards(next: N5SRSCard[]) {
    setCards(next);
    await saveN5SRSCards(next);
    setSyncDirty(true);
  }

  async function persistLogs(next: N5ReviewLog[]) {
    setLogs(next);
    await saveN5ReviewLogs(next);
    setSyncDirty(true);
  }

  function startLesson(day: number, revisit = false) {
    sound.playTick();
    setLessonDay(day);
    setReadOnly(revisit);
    setRevisitState(defaultRevisitState(day));
    setMode("lesson");
    setIsBackShown(false);
    setReviewStartedAt(Date.now());
  }

  async function updateActiveState(patch: Partial<N5DayProgress>) {
    if (!progress) return;
    if (readOnly) {
      setRevisitState({ ...activeState, ...patch, updatedAt: Date.now() });
      return;
    }
    await persistProgress(updateN5DayState(progress, activeDayNumber, patch));
  }

  async function completeStage(stage: N5Stage) {
    if (!progress) return;
    sound.playCorrect();
    if (readOnly) {
      const nextStage = N5_STAGE_ORDER[Math.min(N5_STAGE_ORDER.length - 1, N5_STAGE_ORDER.indexOf(stage) + 1)];
      setRevisitState({ ...activeState, stage: nextStage, stagesCompleted: { ...activeState.stagesCompleted, [stage]: true }, updatedAt: Date.now() });
      return;
    }
    await persistProgress(completeN5Stage(progress, activeDayNumber, stage));
  }

  async function gradeCurrentCard(grade: N5Grade) {
    const card = dueCards[0];
    if (!card) return;
    const answerSeconds = Math.max(1, Math.round((Date.now() - reviewStartedAt) / 1000));
    const { card: updatedCard, log } = gradeN5Card(card, grade, new Date(), answerSeconds);
    const nextCards = cards.map((item) => item.id === card.id ? updatedCard : item);
    const nextLogs = [log, ...logs];
    await persistCards(nextCards);
    await persistLogs(nextLogs);
    if (progress) await persistProgress(recordN5DueTrend(progress, dueN5Cards(nextCards).length));
    setIsBackShown(false);
    setReviewStartedAt(Date.now());
    if (grade === 1) sound.playIncorrect();
    else sound.playCorrect();
  }

  async function markVocabLearned(entry: N5VocabEntry) {
    if (!progress || readOnly) return;
    const next = markN5VocabLearned(progress, cards, activeDayNumber, entry);
    await persistCards(next.cards);
    await persistProgress(next.progress);
    await advanceVocab();
  }

  async function markKanjiLearned(entry: N5KanjiEntry) {
    if (!progress || readOnly) return;
    const next = markN5KanjiLearned(progress, cards, activeDayNumber, entry);
    await persistCards(next.cards);
    await persistProgress(next.progress);
    await advanceKanji();
  }

  async function advanceVocab() {
    const nextIndex = activeState.vocabIndex + 1;
    if (nextIndex >= activeDay.vocab.length) await completeStage("vocab");
    else await updateActiveState({ vocabIndex: nextIndex });
  }

  async function advanceKanji() {
    const nextIndex = activeState.kanjiIndex + 1;
    if (nextIndex >= activeDay.kanji.length) await completeStage("kanji");
    else await updateActiveState({ kanjiIndex: nextIndex });
  }

  async function updateProduction(promptId: string, text: string) {
    if (!progress || readOnly) return;
    await persistProgress(updateN5ProductionAnswer(progress, activeDayNumber, promptId, text));
  }

  async function completeDay() {
    if (!progress || dueCards.length > 0 || readOnly) return;
    await persistProgress(completeN5Day(progress, activeDayNumber));
    setMode("home");
    setLessonDay(null);
    setReadOnly(false);
    sound.playCorrect();
  }

  if (isLoading || !progress) {
    return (
      <div className="bg-white border-2 border-zinc-900 rounded-[28px] p-6 shadow-[5px_5px_0px_0px_rgba(0,0,0,1)]">
        <div className="text-xs font-black uppercase tracking-widest text-zinc-500">Loading N5 course...</div>
      </div>
    );
  }

  if (mode === "map") {
    return (
      <CourseMap
        progress={progress}
        onBack={() => setMode("home")}
        onOpenDay={(day, revisit) => startLesson(day, revisit)}
      />
    );
  }

  if (mode === "lesson") {
    return (
      <LessonRunner
        day={activeDay}
        progress={progress}
        state={activeState}
        cards={cards}
        dueCards={dueCards}
        readOnly={readOnly}
        isBackShown={isBackShown}
        setIsBackShown={setIsBackShown}
        syncState={syncLabel(isOnline, syncDirty)}
        onBackHome={() => {
          setMode("home");
          setLessonDay(null);
          setReadOnly(false);
        }}
        onUpdateState={updateActiveState}
        onCompleteStage={completeStage}
        onGrade={gradeCurrentCard}
        onMarkVocabLearned={markVocabLearned}
        onMarkKanjiLearned={markKanjiLearned}
        onAdvanceVocab={advanceVocab}
        onAdvanceKanji={advanceKanji}
        onUpdateProduction={updateProduction}
        onCompleteDay={completeDay}
        onSaveCheckpoint={async (checkpointId, status, checkedItems) => {
          await persistProgress(saveN5CheckpointReport(progress, checkpointId, status, checkedItems));
        }}
      />
    );
  }

  return (
    <CourseHome
      progress={progress}
      focusDay={focusDay}
      dueCount={dueCards.length}
      syncState={syncLabel(isOnline, syncDirty)}
      onStart={() => startLesson(currentDayNumber)}
      onReview={() => startLesson(currentDayNumber)}
      onMap={() => setMode("map")}
    />
  );
};

const CourseHome: React.FC<{
  progress: N5CourseProgress;
  focusDay: N5DayPlan;
  dueCount: number;
  syncState: string;
  onStart: () => void;
  onReview: () => void;
  onMap: () => void;
}> = ({ progress, focusDay, dueCount, syncState, onStart, onReview, onMap }) => (
  <div className="space-y-4">
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
      <section className="lg:col-span-8 bg-white border-2 border-zinc-900 rounded-[28px] p-5 sm:p-6 shadow-[5px_5px_0px_0px_rgba(0,0,0,1)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <span className="text-[10px] font-black uppercase tracking-widest text-indigo-600">Today's focus</span>
            <h2 className="text-2xl sm:text-4xl font-black text-zinc-950 mt-2">Day {focusDay.day} · {focusDay.title}</h2>
            <p className="mt-3 text-sm font-bold text-zinc-600 max-w-2xl">{focusDay.grammarText || focusDay.vocabText || "Review and consolidate today's N5 material."}</p>
          </div>
          <GraduationCap className="h-9 w-9 text-indigo-600 shrink-0" />
        </div>
        <button onClick={onStart} className="mt-6 w-full sm:w-auto px-5 py-3 rounded-2xl border-2 border-zinc-900 bg-indigo-600 text-white text-sm font-black uppercase flex items-center justify-center gap-2 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
          <Play className="h-4 w-4" /> Start
        </button>
      </section>

      <section className="lg:col-span-4 space-y-3">
        <div className="bg-white border-2 border-zinc-900 rounded-[22px] p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <span className="text-[9px] font-black uppercase tracking-widest text-zinc-400">N5 Reviews</span>
              <p className="text-xl font-black text-zinc-950 mt-1">{dueCount > 0 ? `${dueCount} reviews due` : "All caught up"}</p>
            </div>
            <BookOpen className="h-6 w-6 text-indigo-600" />
          </div>
          {dueCount > 0 ? (
            <button onClick={onReview} className="mt-3 w-full px-3 py-2 rounded-xl border-2 border-zinc-900 bg-zinc-900 text-white text-xs font-black uppercase">Review now</button>
          ) : (
            <p className="mt-3 text-xs font-bold text-zinc-500">New material is ready when you are.</p>
          )}
        </div>
        <div className="bg-white border-2 border-zinc-900 rounded-[22px] p-4">
          <div className="flex items-center justify-between">
            <MetricInline icon={<Flame className="h-5 w-5 text-amber-500" />} label="Streak" value={`${progress.streak.current} days`} />
            <SyncPill label={syncState} />
          </div>
          <DaySegments progress={progress} />
        </div>
      </section>
    </div>

    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
      <section className="lg:col-span-8 bg-white border-2 border-zinc-900 rounded-[22px] p-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <span className="text-[9px] font-black uppercase tracking-widest text-zinc-400">Review load trend</span>
            <p className="text-xs font-bold text-zinc-500 mt-1">Reviews grow as you learn more. This is normal.</p>
          </div>
          <Sparkline points={progress.dueCountTrend} />
        </div>
      </section>
      <section className="lg:col-span-4 bg-white border-2 border-zinc-900 rounded-[22px] p-4 flex items-center justify-between gap-3">
        <div>
          <span className="text-[9px] font-black uppercase tracking-widest text-zinc-400">Overview</span>
          <p className="text-xs font-bold text-zinc-600 mt-1">Open the map when you want the big picture.</p>
        </div>
        <button onClick={onMap} className="px-3 py-2 rounded-xl border-2 border-zinc-900 bg-white text-xs font-black uppercase flex items-center gap-1.5">
          <Map className="h-4 w-4" /> Map
        </button>
      </section>
    </div>
  </div>
);

const LessonRunner: React.FC<{
  day: N5DayPlan;
  progress: N5CourseProgress;
  state: N5DayProgress;
  cards: N5SRSCard[];
  dueCards: N5SRSCard[];
  readOnly: boolean;
  isBackShown: boolean;
  setIsBackShown: (value: boolean) => void;
  syncState: string;
  onBackHome: () => void;
  onUpdateState: (patch: Partial<N5DayProgress>) => Promise<void>;
  onCompleteStage: (stage: N5Stage) => Promise<void>;
  onGrade: (grade: N5Grade) => Promise<void>;
  onMarkVocabLearned: (entry: N5VocabEntry) => Promise<void>;
  onMarkKanjiLearned: (entry: N5KanjiEntry) => Promise<void>;
  onAdvanceVocab: () => Promise<void>;
  onAdvanceKanji: () => Promise<void>;
  onUpdateProduction: (promptId: string, text: string) => Promise<void>;
  onCompleteDay: () => Promise<void>;
  onSaveCheckpoint: (checkpointId: string, status: "ready" | "not-ready", checkedItems: string[]) => Promise<void>;
}> = (props) => {
  const stage = props.state.stage;
  const checkpoint = n5Course.checkpoints.find((item) => item.afterDay === props.day.day);
  return (
    <div className="bg-white border-2 border-zinc-900 rounded-[28px] p-4 sm:p-5 shadow-[5px_5px_0px_0px_rgba(0,0,0,1)] min-h-[620px] flex flex-col">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b-2 border-zinc-100 pb-4">
        <button onClick={props.onBackHome} className="text-xs font-black uppercase text-zinc-500 hover:text-zinc-950 flex items-center gap-1">
          <ChevronLeft className="h-4 w-4" /> Home
        </button>
        <StageRail current={stage} />
        <SyncPill label={props.syncState} />
      </div>
      <div className="pt-5 flex-1">
        <motion.div key={`${props.day.day}-${stage}-${props.state.grammarIndex}-${props.state.vocabIndex}-${props.state.kanjiIndex}`} initial={{ opacity: 0, x: 18 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.18 }}>
          {stage === "review" && <ReviewStage {...props} />}
          {stage === "grammar" && <GrammarStage {...props} />}
          {stage === "vocab" && <VocabStage {...props} />}
          {stage === "kanji" && <KanjiStage {...props} />}
          {stage === "produce" && <ProduceStage {...props} />}
          {stage === "done" && <DoneStage {...props} checkpoint={checkpoint} />}
        </motion.div>
      </div>
    </div>
  );
};

const ReviewStage: React.FC<React.ComponentProps<typeof LessonRunner>> = ({ dueCards, readOnly, state, isBackShown, setIsBackShown, onGrade, onCompleteStage, onUpdateState }) => {
  if (readOnly) {
    return <StageShell eyebrow="Review" title="Read-only revisit" subtitle="Reviews are skipped while revisiting completed material." primaryLabel="Continue" onPrimary={() => onCompleteStage("review")} />;
  }
  const card = dueCards[0];
  const content = card ? reviewContent(card) : null;
  if (!card || !content) {
    const returnToDone = Boolean(state.stagesCompleted.produce);
    return <StageShell eyebrow="Review" title="All caught up" subtitle="No N5 vocab or kanji reviews are due right now." primaryLabel="Continue" onPrimary={() => returnToDone ? onUpdateState({ stage: "done", stagesCompleted: { ...state.stagesCompleted, review: true } }) : onCompleteStage("review")} />;
  }
  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <StageHeading eyebrow="Review" title="Clearing today's reviews" subtitle={`${dueCards.length} due. Reviews come first, and you can defer if today needs to start with new material.`} />
      <div className="border-2 border-zinc-900 rounded-[24px] min-h-[320px] p-5 flex flex-col justify-between">
        <div className="flex justify-between text-[10px] font-black uppercase text-zinc-400">
          <span>{card.kind === "vocab" ? "Vocab in context" : "Kanji recall"}</span>
          <span>Due {formatN5Due(card.due)}</span>
        </div>
        <div className="text-center my-8">
          {!isBackShown ? content.front : content.back}
        </div>
        {!isBackShown ? (
          <button onClick={() => setIsBackShown(true)} className="w-full py-3 rounded-2xl border-2 border-zinc-900 bg-zinc-900 text-white text-xs font-black uppercase">Show Answer</button>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {([1, 2, 3, 4] as N5Grade[]).map((grade) => (
              <button key={grade} onClick={() => onGrade(grade)} className={`py-3 rounded-2xl border-2 border-zinc-900 text-xs font-black uppercase ${grade === 1 ? "bg-red-300" : grade === 2 ? "bg-amber-300" : grade === 3 ? "bg-indigo-200" : "bg-emerald-300"}`}>
                {gradeLabels[grade]}
              </button>
            ))}
          </div>
        )}
      </div>
      <button onClick={() => onUpdateState({ stage: "grammar", reviewDeferred: true })} className="mx-auto block text-[11px] font-black uppercase text-zinc-400 hover:text-zinc-900">Defer reviews and start lesson</button>
    </div>
  );
};

const GrammarStage: React.FC<React.ComponentProps<typeof LessonRunner>> = ({ day, state, onUpdateState, onCompleteStage }) => {
  const item = day.grammar[state.grammarIndex];
  if (!item) return <StageShell eyebrow="Grammar" title="No grammar listed" subtitle={day.grammarText || "Continue to the next stage."} primaryLabel="Continue" onPrimary={() => onCompleteStage("grammar")} />;
  const isLast = state.grammarIndex >= day.grammar.length - 1;
  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <StageHeading eyebrow="Grammar" title={item.title} subtitle={`${state.grammarIndex + 1} of ${day.grammar.length}`} />
      <div className="space-y-4">
        <InfoBlock label="Structure" text={item.structure} large />
        <InfoBlock label="Explanation" text={item.explanation} />
        <div className="grid gap-2">
          {item.examples.map((example) => <ExampleRow key={example.raw} example={example} />)}
        </div>
        <div className="bg-amber-50 border-2 border-amber-300 rounded-2xl p-4 text-sm font-bold text-amber-950 flex gap-3">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <div><span className="block text-[10px] font-black uppercase tracking-widest mb-1">Common mistake</span>{item.commonMistake}</div>
        </div>
      </div>
      <PrimaryBar primaryLabel={isLast ? "Finish Grammar" : "Next Grammar"} onPrimary={() => isLast ? onCompleteStage("grammar") : onUpdateState({ grammarIndex: state.grammarIndex + 1 })} />
    </div>
  );
};

const VocabStage: React.FC<React.ComponentProps<typeof LessonRunner>> = ({ day, state, cards, readOnly, onMarkVocabLearned, onAdvanceVocab, onCompleteStage }) => {
  const item = day.vocab[state.vocabIndex];
  if (!item) return <StageShell eyebrow="Vocab" title="No vocab listed" subtitle={day.vocabText || "Continue to kanji."} primaryLabel="Continue" onPrimary={() => onCompleteStage("vocab")} />;
  const learned = cards.some((card) => card.id === cardIdForVocab(item));
  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <StageHeading eyebrow="Vocab" title={`${state.vocabIndex + 1} of ${day.vocab.length} words`} subtitle={day.vocabText} />
      <div className="border-2 border-zinc-900 rounded-[24px] p-5 text-center space-y-4">
        <button onClick={() => speakJapanese(item.example || item.word)} className="ml-auto flex items-center gap-1 text-[10px] font-black uppercase text-zinc-500 hover:text-zinc-950">
          <Mic2 className="h-4 w-4" /> Speak
        </button>
        <div className="text-5xl sm:text-7xl font-black text-zinc-950">{item.word}</div>
        <div className="text-lg font-black text-indigo-700">{item.reading}{item.romaji ? ` · ${item.romaji}` : ""}</div>
        <div className="text-sm font-bold uppercase tracking-wide text-zinc-500">{item.type} · {item.meaning}</div>
        <div className="bg-indigo-50 border-2 border-indigo-200 rounded-2xl p-4 text-xl font-black text-zinc-950">{item.example || item.raw}</div>
      </div>
      <div className="flex flex-col sm:flex-row gap-2">
        <button onClick={() => readOnly ? onAdvanceVocab() : onMarkVocabLearned(item)} className="flex-1 py-3 rounded-2xl border-2 border-zinc-900 bg-indigo-600 text-white text-xs font-black uppercase">
          {readOnly ? "Next" : learned ? "Continue" : "Learned"}
        </button>
        {!readOnly ? <button className="px-4 py-3 rounded-2xl border-2 border-zinc-300 bg-white text-zinc-500 text-xs font-black uppercase">I need more time</button> : null}
      </div>
    </div>
  );
};

const KanjiStage: React.FC<React.ComponentProps<typeof LessonRunner>> = ({ day, state, cards, readOnly, onMarkKanjiLearned, onAdvanceKanji, onCompleteStage }) => {
  const item = day.kanji[state.kanjiIndex];
  if (!item) return (
    <StageShell
      eyebrow="Kanji"
      title="Kanji review"
      subtitle={day.kanjiText || "No new kanji listed for this day."}
      detail={day.unresolvedKanjiChars.length ? `From the day plan only: ${day.unresolvedKanjiChars.join(" ")}` : undefined}
      primaryLabel="Continue"
      onPrimary={() => onCompleteStage("kanji")}
    />
  );
  const learned = cards.some((card) => card.id === cardIdForKanji(item));
  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <StageHeading eyebrow="Kanji" title={`${state.kanjiIndex + 1} of ${day.kanji.length} kanji`} subtitle={day.kanjiText} />
      {day.unresolvedKanjiChars.length ? <p className="text-xs font-bold text-zinc-500">From the day plan only: {day.unresolvedKanjiChars.join(" ")}</p> : null}
      <div className="border-2 border-zinc-900 rounded-[24px] p-5 grid gap-4 md:grid-cols-[180px_1fr] items-center">
        <div className="text-center">
          <div className="text-8xl font-black text-zinc-950 leading-none">{item.kanji}</div>
          <div className="mt-3 text-sm font-black text-indigo-700">{item.readings}</div>
          <div className="mt-1 text-xs font-bold uppercase text-zinc-500">{item.meaning}</div>
        </div>
        <div className="space-y-3">
          <div className="bg-emerald-50 border-2 border-emerald-200 rounded-2xl p-4">
            <span className="block text-[10px] font-black uppercase tracking-widest text-emerald-700 mb-2">Mnemonic</span>
            <p className="text-lg font-black text-zinc-950">{item.mnemonic}</p>
          </div>
          <InfoBlock label="Components" text={item.components} />
          <InfoBlock label="Example word" text={item.example || item.raw} />
        </div>
      </div>
      <div className="flex flex-col sm:flex-row gap-2">
        <button onClick={() => readOnly ? onAdvanceKanji() : onMarkKanjiLearned(item)} className="flex-1 py-3 rounded-2xl border-2 border-zinc-900 bg-indigo-600 text-white text-xs font-black uppercase">
          {readOnly ? "Next" : learned ? "Continue" : "Learned"}
        </button>
        {!readOnly ? <button className="px-4 py-3 rounded-2xl border-2 border-zinc-300 bg-white text-zinc-500 text-xs font-black uppercase">I need more time</button> : null}
      </div>
    </div>
  );
};

const ProduceStage: React.FC<React.ComponentProps<typeof LessonRunner>> = ({ day, progress, readOnly, onUpdateProduction, onCompleteStage }) => {
  const tasks = productionTasks(day);
  const answers: Record<string, N5ProductionAnswer> = progress.productionAnswers[String(day.day)] || {};
  const hasText = Object.values(answers).some((answer) => answer.text.trim());
  const complete = tasks.length === 0 || tasks.every((task) => (answers[task.id]?.text || "").trim().length > 0);
  const [showExamples, setShowExamples] = useState(false);
  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <StageHeading eyebrow="Produce" title="Write your own Japanese" subtitle={day.produceText || "Record the self-practice work for this day."} />
      <div className="space-y-3">
        {tasks.map((task) => (
          <label key={task.id} className="block">
            <span className="block text-sm font-black text-zinc-900 mb-2">{task.text}</span>
            <textarea
              disabled={readOnly}
              value={answers[task.id]?.text || ""}
              onChange={(event) => onUpdateProduction(task.id, event.target.value)}
              rows={5}
              className="w-full rounded-2xl border-2 border-zinc-900 p-3 text-base font-bold disabled:bg-zinc-100"
            />
          </label>
        ))}
      </div>
      {hasText ? (
        <button onClick={() => setShowExamples((value) => !value)} className="text-xs font-black uppercase text-indigo-700 hover:text-indigo-950">
          {showExamples ? "Hide source examples" : "Show source examples"}
        </button>
      ) : null}
      {showExamples ? <SourceExamples day={day} /> : null}
      <PrimaryBar primaryLabel="Submit Practice" disabled={!complete || readOnly} onPrimary={() => onCompleteStage("produce")} />
    </div>
  );
};

const DoneStage: React.FC<React.ComponentProps<typeof LessonRunner> & { checkpoint?: (typeof n5Course.checkpoints)[number] }> = ({ day, progress, dueCards, checkpoint, onCompleteDay, onSaveCheckpoint, onBackHome, onUpdateState, readOnly }) => {
  const report = checkpoint ? progress.checkpointReports[checkpoint.id] : null;
  const [checked, setChecked] = useState<string[]>(report?.checkedItems || []);
  if (readOnly) return <StageShell eyebrow="Revisit" title={`Day ${day.day}`} subtitle="Read-only review complete." primaryLabel="Return Home" onPrimary={onBackHome} />;
  if (dueCards.length > 0) {
    return <StageShell eyebrow="Done" title="Reviews remain" subtitle={`${dueCards.length} N5 reviews are due. You can study new material, but this day completes after reviews are cleared.`} primaryLabel="Back to Reviews" onPrimary={() => onUpdateState({ stage: "review" })} />;
  }
  if (checkpoint && !report) {
    return (
      <div className="max-w-3xl mx-auto space-y-4">
        <StageHeading eyebrow="Milestone" title={checkpoint.title} subtitle="Self-check the criteria before moving on." />
        <div className="space-y-2">
          {checkpoint.criteria.map((item) => (
            <label key={item} className="flex gap-3 items-start bg-zinc-50 border-2 border-zinc-200 rounded-2xl p-3">
              <input type="checkbox" checked={checked.includes(item)} onChange={(event) => setChecked((current) => event.target.checked ? [...current, item] : current.filter((value) => value !== item))} className="mt-1 h-4 w-4" />
              <span className="text-sm font-bold text-zinc-800">{item}</span>
            </label>
          ))}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <button onClick={() => onSaveCheckpoint(checkpoint.id, "ready", checked)} className="py-3 rounded-2xl border-2 border-zinc-900 bg-emerald-300 text-xs font-black uppercase">Ready</button>
          <button onClick={() => onSaveCheckpoint(checkpoint.id, "not-ready", checked)} className="py-3 rounded-2xl border-2 border-zinc-900 bg-white text-xs font-black uppercase">Revisit days {Math.max(1, checkpoint.afterDay - 3)}-{checkpoint.afterDay}</button>
        </div>
      </div>
    );
  }
  return (
    <div className="max-w-3xl mx-auto text-center space-y-5">
      <div className="mx-auto w-20 h-20 rounded-full border-2 border-zinc-900 bg-emerald-300 flex items-center justify-center shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
        <CheckCircle2 className="h-10 w-10" />
      </div>
      <div>
        <span className="text-[10px] font-black uppercase tracking-widest text-emerald-700">Day complete</span>
        <h2 className="text-3xl font-black text-zinc-950 mt-2">Day {day.day} complete</h2>
        <p className="mt-2 text-sm font-bold text-zinc-500">Next unlock: Day {Math.min(30, day.day + 1)}</p>
      </div>
      <button onClick={onCompleteDay} className="w-full sm:w-auto px-5 py-3 rounded-2xl border-2 border-zinc-900 bg-indigo-600 text-white text-xs font-black uppercase shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
        Return Home
      </button>
    </div>
  );
};

const CourseMap: React.FC<{ progress: N5CourseProgress; onBack: () => void; onOpenDay: (day: number, revisit: boolean) => void }> = ({ progress, onBack, onOpenDay }) => (
  <div className="bg-white border-2 border-zinc-900 rounded-[28px] p-4 sm:p-5 shadow-[5px_5px_0px_0px_rgba(0,0,0,1)] space-y-4">
    <button onClick={onBack} className="text-xs font-black uppercase text-zinc-500 hover:text-zinc-950 flex items-center gap-1"><ChevronLeft className="h-4 w-4" /> Course Home</button>
    <div>
      <h2 className="text-2xl font-black text-zinc-950">30-day map</h2>
      <p className="text-sm font-bold text-zinc-500 mt-1">Completed days reopen as read-only material review.</p>
    </div>
    <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-10 gap-2">
      {n5Course.days.map((day) => {
        const completed = progress.completedDays.includes(day.day);
        const current = day.day === progress.unlockedDay && !completed;
        const locked = day.day > progress.unlockedDay;
        return (
          <button
            key={day.day}
            disabled={locked}
            onClick={() => onOpenDay(day.day, completed)}
            className={`aspect-square rounded-2xl border-2 p-2 text-left flex flex-col justify-between ${completed ? "bg-emerald-200 border-zinc-900" : current ? "bg-indigo-600 text-white border-zinc-900" : locked ? "bg-zinc-100 text-zinc-400 border-zinc-200" : "bg-white border-zinc-300"}`}
          >
            <span className="text-lg font-black">{day.day}</span>
            <span className="text-[9px] font-black uppercase">{locked ? <Lock className="h-4 w-4" /> : completed ? "Done" : "Current"}</span>
          </button>
        );
      })}
    </div>
  </div>
);

function reviewContent(card: N5SRSCard): { front: React.ReactNode; back: React.ReactNode } | null {
  if (card.kind === "vocab") {
    const entry = n5Course.vocab[card.contentId];
    if (!entry) return null;
    return {
      front: <div><div className="text-2xl sm:text-4xl font-black text-zinc-950">{maskWord(entry.example, entry.word) || entry.example || entry.raw}</div><div className="mt-4 text-xs font-black uppercase text-zinc-400">Recall the target word and meaning</div></div>,
      back: <div><div className="text-5xl font-black text-zinc-950">{entry.word}</div><div className="mt-2 text-lg font-black text-indigo-700">{entry.reading}{entry.romaji ? ` · ${entry.romaji}` : ""}</div><div className="mt-2 text-sm font-bold text-zinc-600">{entry.meaning}</div><div className="mt-4 text-xl font-black text-zinc-900">{entry.example || entry.raw}</div></div>,
    };
  }
  const entry = n5Course.kanji[card.contentId];
  if (!entry) return null;
  return {
    front: <div><div className="text-7xl font-black text-zinc-950">{entry.kanji}</div><div className="mt-4 text-xs font-black uppercase text-zinc-400">Recall readings and meaning</div></div>,
    back: <div><div className="text-6xl font-black text-zinc-950">{entry.kanji}</div><div className="mt-2 text-lg font-black text-indigo-700">{entry.readings}</div><div className="mt-2 text-sm font-bold text-zinc-600">{entry.meaning}</div><div className="mt-4 text-base font-black text-zinc-900">{entry.mnemonic}</div></div>,
  };
}

function maskWord(example: string, word: string): string {
  if (!example || !word) return "";
  return example.includes(word) ? example.replace(word, "____") : example;
}

function productionTasks(day: N5DayPlan): Array<{ id: string; text: string }> {
  const source = day.produceTasks.length ? day.produceTasks : day.extraLines.map((line) => `${line.label}: ${line.text}`);
  return source.length ? source.map((text, index) => ({ id: `produce-${index}`, text })) : [{ id: "produce-0", text: day.raw.split("\n")[0] || `Day ${day.day} reflection` }];
}

function defaultRevisitState(day: number): N5DayProgress {
  return { day, stage: "review", grammarIndex: 0, vocabIndex: 0, kanjiIndex: 0, stagesCompleted: {}, updatedAt: Date.now() };
}

function syncLabel(isOnline: boolean, dirty: boolean): string {
  if (!isOnline) return "offline-saved";
  return dirty ? "syncing" : "synced";
}

function speakJapanese(text: string): void {
  if (!text || !("speechSynthesis" in window)) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "ja-JP";
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

const StageShell: React.FC<{ eyebrow: string; title: string; subtitle: string; detail?: string; primaryLabel: string; onPrimary: () => void }> = ({ eyebrow, title, subtitle, detail, primaryLabel, onPrimary }) => (
  <div className="max-w-2xl mx-auto text-center space-y-5">
    <StageHeading eyebrow={eyebrow} title={title} subtitle={subtitle} />
    {detail ? <p className="text-xs font-bold text-zinc-500">{detail}</p> : null}
    <button onClick={onPrimary} className="w-full sm:w-auto px-5 py-3 rounded-2xl border-2 border-zinc-900 bg-indigo-600 text-white text-xs font-black uppercase">{primaryLabel}</button>
  </div>
);

const StageHeading: React.FC<{ eyebrow: string; title: string; subtitle?: string }> = ({ eyebrow, title, subtitle }) => (
  <div>
    <span className="text-[10px] font-black uppercase tracking-widest text-indigo-600">{eyebrow}</span>
    <h2 className="text-2xl sm:text-3xl font-black text-zinc-950 mt-1">{title}</h2>
    {subtitle ? <p className="mt-2 text-sm font-bold text-zinc-500">{subtitle}</p> : null}
  </div>
);

const PrimaryBar: React.FC<{ primaryLabel: string; disabled?: boolean; onPrimary: () => void }> = ({ primaryLabel, disabled, onPrimary }) => (
  <button disabled={disabled} onClick={onPrimary} className="w-full py-3 rounded-2xl border-2 border-zinc-900 bg-indigo-600 text-white text-xs font-black uppercase disabled:opacity-50">
    {primaryLabel}
  </button>
);

const InfoBlock: React.FC<{ label: string; text: string; large?: boolean }> = ({ label, text, large }) => (
  <div className="bg-zinc-50 border-2 border-zinc-200 rounded-2xl p-4">
    <span className="block text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-1">{label}</span>
    <p className={`${large ? "text-xl" : "text-sm"} font-bold text-zinc-900 whitespace-pre-wrap`}>{text || "See source line."}</p>
  </div>
);

const ExampleRow: React.FC<{ example: N5GrammarPoint["examples"][number] }> = ({ example }) => (
  <div className="bg-white border-2 border-zinc-200 rounded-2xl p-3">
    <div className="text-lg font-black text-zinc-950">{example.japanese}</div>
    <div className="text-sm font-bold text-zinc-500 mt-1">{example.translation}</div>
  </div>
);

const SourceExamples: React.FC<{ day: N5DayPlan }> = ({ day }) => (
  <div className="bg-zinc-50 border-2 border-zinc-200 rounded-2xl p-4 space-y-2">
    <span className="block text-[10px] font-black uppercase tracking-widest text-zinc-400">Verbatim source examples</span>
    {day.grammar.flatMap((item) => item.examples).slice(0, 5).map((example) => <ExampleRow key={example.raw} example={example} />)}
    {day.vocab.slice(0, 5).map((entry) => <div key={entry.id} className="text-sm font-bold text-zinc-700">{entry.example || entry.raw}</div>)}
  </div>
);

const StageRail: React.FC<{ current: N5Stage }> = ({ current }) => (
  <div className="flex items-center gap-1 overflow-x-auto">
    {N5_STAGE_ORDER.map((stage) => {
      const active = stage === current;
      return <span key={stage} className={`px-2 py-1 rounded-full border text-[9px] font-black uppercase ${active ? "bg-zinc-900 text-white border-zinc-900" : "bg-white text-zinc-400 border-zinc-200"}`}>{stage}</span>;
    })}
  </div>
);

const SyncPill: React.FC<{ label: string }> = ({ label }) => (
  <span className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-zinc-50 px-2 py-1 text-[9px] font-black uppercase text-zinc-500">
    {label === "offline-saved" ? <WifiOff className="h-3 w-3" /> : <Wifi className="h-3 w-3" />} {label}
  </span>
);

const MetricInline: React.FC<{ icon: React.ReactNode; label: string; value: string }> = ({ icon, label, value }) => (
  <div className="flex items-center gap-2">
    {icon}
    <div><span className="block text-[9px] font-black uppercase text-zinc-400">{label}</span><span className="block text-sm font-black text-zinc-950">{value}</span></div>
  </div>
);

const DaySegments: React.FC<{ progress: N5CourseProgress }> = ({ progress }) => (
  <div className="mt-4 grid grid-cols-10 gap-1">
    {Array.from({ length: 30 }, (_, index) => index + 1).map((day) => (
      <div key={day} className={`h-2 rounded-full ${progress.completedDays.includes(day) ? "bg-emerald-500" : day === progress.unlockedDay ? "bg-indigo-600" : "bg-zinc-200"}`} />
    ))}
  </div>
);

const Sparkline: React.FC<{ points: N5CourseProgress["dueCountTrend"] }> = ({ points }) => {
  const values = points.length ? points.map((point) => point.dueCount) : [0];
  const max = Math.max(1, ...values);
  const coords = values.map((value, index) => `${(index / Math.max(1, values.length - 1)) * 120},${36 - (value / max) * 30}`).join(" ");
  return (
    <svg viewBox="0 0 120 40" className="w-full sm:w-40 h-12" role="img" aria-label="Review load trend">
      <polyline fill="none" stroke="#4f46e5" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" points={coords} />
      <line x1="0" y1="38" x2="120" y2="38" stroke="#e4e4e7" strokeWidth="2" />
    </svg>
  );
};

export default N5CoursePage;

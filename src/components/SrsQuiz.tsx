import React, { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import {
  AlertTriangle,
  Award,
  BookOpen,
  Check,
  Compass,
  RotateCcw,
  RotateCw,
  StopCircle,
  Volume2,
  X,
} from "lucide-react";
import { SRSCard } from "../types";
import {
  getCardGroupLabel,
  getStoredStreak,
  isCardActive,
  updateSRSCard,
  updateStoredStreak,
} from "../utils/srs";
import { sound } from "../utils/audio";

interface SrsQuizProps {
  cards: SRSCard[];
  activeRows: string[];
  onCardsUpdate: (updatedCards: SRSCard[]) => void;
}

export const SrsQuiz: React.FC<SrsQuizProps> = ({ cards, activeRows, onCardsUpdate }) => {
  const [sessionActive, setSessionActive] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [practiceMode, setPracticeMode] = useState<"typing" | "flashcard">("typing");
  const [queue, setQueue] = useState<SRSCard[]>([]);
  const [index, setIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [typedAnswer, setTypedAnswer] = useState("");
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [feedback, setFeedback] = useState<"correct" | "incorrect" | null>(null);
  const [correct, setCorrect] = useState(0);
  const [incorrect, setIncorrect] = useState(0);
  const [streak, setStreak] = useState({ current: 0, highest: 0 });

  useEffect(() => {
    setStreak(getStoredStreak());
  }, []);

  const activePool = useMemo(
    () => cards.filter((card) => isCardActive(card, activeRows)),
    [cards, activeRows]
  );
  const dueCards = useMemo(
    () => activePool.filter((card) => card.nextReview <= Date.now()),
    [activePool]
  );
  const masteredCount = activePool.filter((card) => card.box === 5).length;
  const learningCount = activePool.length - masteredCount;
  const currentCard = queue[index];

  const shuffle = <T,>(items: T[]): T[] => {
    const next = [...items];
    for (let i = next.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [next[i], next[j]] = [next[j], next[i]];
    }
    return next;
  };

  const resetInteraction = () => {
    setIsFlipped(false);
    setTypedAnswer("");
    setFeedback(null);
  };

  const startPracticeSession = (studyAhead = false) => {
    if (activePool.length === 0) return;
    const initialDue = dueCards.length > 0 && !studyAhead ? dueCards : activePool;
    const filler = activePool.filter((card) => !initialDue.some((due) => due.char === card.char));
    const nextQueue = shuffle([...initialDue, ...shuffle(filler).slice(0, Math.max(0, 12 - initialDue.length))]);
    setQueue(nextQueue);
    setIndex(0);
    setCorrect(0);
    setIncorrect(0);
    resetInteraction();
    setIsTransitioning(false);
    setSessionActive(true);
    setShowReport(false);
  };

  const processReview = (isCorrect: boolean) => {
    if (!currentCard || isTransitioning) return;
    setIsTransitioning(true);
    setFeedback(isCorrect ? "correct" : "incorrect");

    if (isCorrect) {
      sound.playCharacter(currentCard.char);
      sound.playCorrect();
      setCorrect((value) => value + 1);
    } else {
      sound.playIncorrect();
      setIncorrect((value) => value + 1);
    }

    const updated = updateSRSCard(cards, currentCard.char, isCorrect);
    onCardsUpdate(updated);
    setStreak(updateStoredStreak(isCorrect));

    let nextQueue = [...queue];
    if (!isCorrect) {
      nextQueue.splice(Math.min(nextQueue.length, index + 3), 0, currentCard);
    }
    if (index + 4 >= nextQueue.length) {
      nextQueue = [...nextQueue, ...shuffle(activePool).slice(0, 10)];
    }
    setQueue(nextQueue);

    window.setTimeout(() => {
      setIndex((value) => value + 1);
      resetInteraction();
      setIsTransitioning(false);
    }, isCorrect ? 900 : 1300);
  };

  const submitTyping = (event: React.FormEvent) => {
    event.preventDefault();
    if (!currentCard || isTransitioning || !typedAnswer.trim()) return;
    processReview(typedAnswer.trim().toLowerCase() === currentCard.romaji.toLowerCase());
  };

  const stopSession = () => {
    sound.playTick();
    setSessionActive(false);
    setShowReport(true);
  };

  useEffect(() => {
    if (!sessionActive || !currentCard || practiceMode !== "flashcard") return;
    function handleKey(event: KeyboardEvent) {
      const tag = (event.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if ((event.key === " " || event.key === "Enter") && !isFlipped) {
        event.preventDefault();
        setIsFlipped(true);
      } else if (isFlipped && event.key === "1") {
        processReview(false);
      } else if (isFlipped && event.key === "2") {
        processReview(true);
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [sessionActive, currentCard, practiceMode, isFlipped]);

  const totalAttempts = correct + incorrect;
  const accuracy = totalAttempts > 0 ? Math.round((correct / totalAttempts) * 100) : 0;

  return (
    <div className="w-full max-w-2xl mx-auto space-y-6" id="srs-quiz-view">
      {!sessionActive && !showReport && (
        <div className="space-y-6">
          <div className="grid grid-cols-12 gap-4">
            <MetricCard label="Global Streak" value={streak.current} sublabel="Days active" tone="amber" />
            <MetricCard label="Record High" value={streak.highest} sublabel="Best history" tone="dark" />
            <MetricCard label="Due Reviews" value={dueCards.length} sublabel="Kana cards" tone="plain" />
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-between bg-white border-2 border-zinc-900 p-2.5 rounded-3xl gap-3 shadow-[3px_3px_0px_0px_rgba(0,0,0,0.95)]">
            <span className="text-[11px] font-black text-zinc-500 uppercase tracking-widest pl-3">
              Kana Practice Mode
            </span>
            <div className="flex gap-2 w-full sm:w-auto">
              <ModeButton active={practiceMode === "typing"} onClick={() => setPracticeMode("typing")}>Type Answers</ModeButton>
              <ModeButton active={practiceMode === "flashcard"} onClick={() => setPracticeMode("flashcard")}>Flashcard Reveal</ModeButton>
            </div>
          </div>

          <div className="bg-white border-2 border-zinc-900 rounded-[32px] p-4 sm:p-6 text-center shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]">
            <div className="w-16 h-16 bg-indigo-50 rounded-2xl flex items-center justify-center mx-auto mb-4 border-2 border-zinc-900 text-indigo-600 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
              <Compass className="h-8 w-8 text-zinc-950" />
            </div>
            <h3 className="text-xl font-black text-zinc-900 uppercase">Kana SRS Study Desk</h3>
            <p className="text-xs text-zinc-400 font-bold uppercase tracking-wide mt-1.5 max-w-md mx-auto leading-relaxed">
              Reviews selected hiragana and katakana groups only. Imported Anki decks now live in the Anki Decks tab.
            </p>

            <div className="my-5 border-t border-dashed border-zinc-200 pt-5 text-left grid grid-cols-2 gap-4">
              <SmallStat label="Active Groups" value={`${activeRows.length} selected`} />
              <SmallStat label="Mastery" value={`${masteredCount} mastered / ${learningCount} learning`} />
            </div>

            {activeRows.length === 0 || activePool.length === 0 ? (
              <div className="bg-amber-50 border-2 border-amber-300 rounded-2xl p-4 text-xs font-bold text-amber-900 flex items-start gap-2 text-left">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>Select active kana groups in Glossary & Setups before practicing.</span>
              </div>
            ) : dueCards.length === 0 ? (
              <div className="space-y-4">
                <div className="bg-emerald-50 border-2 border-emerald-300 rounded-2xl p-4 text-xs font-bold text-emerald-900 text-center">
                  <Check className="h-4 w-4 inline mr-1.5 text-emerald-600 stroke-[4]" />
                  You are caught up for this kana set.
                </div>
                <button onClick={() => startPracticeSession(true)} className="w-full py-4 px-6 bg-zinc-900 hover:bg-zinc-800 text-white font-black uppercase tracking-wider rounded-2xl border-2 border-zinc-950 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] flex items-center justify-center gap-2">
                  <Compass className="h-5 w-5" /> Study Ahead
                </button>
              </div>
            ) : (
              <button onClick={() => startPracticeSession()} className="w-full py-4 px-6 bg-indigo-600 hover:bg-indigo-700 text-white font-black uppercase tracking-wider rounded-2xl border-2 border-zinc-900 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] flex items-center justify-center gap-2">
                <BookOpen className="h-5 w-5" /> Launch Kana Review ({dueCards.length})
              </button>
            )}
          </div>
        </div>
      )}

      {sessionActive && currentCard && (
        <div className="space-y-6">
          <div className="flex flex-col min-[480px]:flex-row min-[480px]:items-center justify-between gap-3 bg-zinc-900 text-white p-4 border-2 border-zinc-900 rounded-3xl shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
            <div className="text-xs uppercase tracking-wide font-bold">
              Session Score: <strong className="text-emerald-400">{correct} Correct</strong> / <strong className="text-red-400">{incorrect} Missed</strong>
            </div>
            <button onClick={stopSession} className="py-1.5 px-3 bg-red-500 hover:bg-red-600 text-white border-2 border-zinc-950 font-black text-[10px] uppercase tracking-wider rounded-xl flex items-center gap-1.5">
              <StopCircle className="h-3.5 w-3.5" /> Stop Practice
            </button>
          </div>

          <motion.button
            type="button"
            key={`${index}-${isFlipped ? "back" : "front"}`}
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full min-h-[360px] bg-white border-2 border-zinc-900 rounded-[32px] p-5 sm:p-7 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] flex flex-col justify-between items-center relative overflow-hidden text-left"
            onClick={() => practiceMode === "flashcard" && setIsFlipped((value) => !value)}
          >
            <div className="w-full flex flex-col min-[420px]:flex-row justify-between gap-2 text-xs text-zinc-400 font-black uppercase tracking-widest">
              <span>{getCardGroupLabel(currentCard)}</span>
              <span className="px-2.5 py-1 bg-zinc-100 border border-zinc-300 rounded-lg text-zinc-800">Box {currentCard.box} / 5</span>
            </div>

            <div className="text-center my-auto flex flex-col items-center justify-center px-4">
              <span className="text-[64px] sm:text-[84px] font-extrabold text-zinc-900 select-none leading-tight block">
                {isFlipped ? currentCard.romaji : currentCard.char}
              </span>
              {practiceMode === "flashcard" && !isFlipped && (
                <span className="text-[10px] font-extrabold text-zinc-400 uppercase tracking-widest flex items-center gap-1.5 mt-4 bg-zinc-50 border border-zinc-200 py-1 px-2.5 rounded-lg select-none">
                  <RotateCw className="h-3 w-3" /> Click card to flip
                </span>
              )}
            </div>

            <div className="w-full flex flex-col sm:flex-row items-center justify-between gap-3 mt-4 border-t border-zinc-150 pt-4">
              <button type="button" onClick={(event) => { event.stopPropagation(); sound.playCharacter(currentCard.char); }} className="w-full sm:w-auto py-2 px-3.5 bg-zinc-100 hover:bg-zinc-200 text-zinc-900 text-xs font-black uppercase tracking-wider rounded-xl border border-zinc-300 flex items-center justify-center gap-1.5">
                <Volume2 className="h-3.5 w-3.5" /> Hear Pronunciation
              </button>
              <span className="text-[10px] font-extrabold text-zinc-400 uppercase tracking-widest font-mono text-center">
                Completed reviews: {index}
              </span>
            </div>

            {feedback && (
              <div className={`absolute inset-0 border-4 pointer-events-none rounded-[30px] ${feedback === "correct" ? "border-emerald-500 bg-emerald-50/5" : "border-red-500 bg-red-50/5"}`} />
            )}
          </motion.button>

          {practiceMode === "typing" ? (
            <form onSubmit={submitTyping} className="flex flex-col min-[480px]:flex-row gap-3">
              <input
                type="text"
                value={typedAnswer}
                onChange={(event) => setTypedAnswer(event.target.value)}
                autoFocus
                placeholder="Type Hepburn pronunciation, e.g. ka, tsu..."
                disabled={isTransitioning}
                className="flex-1 bg-white border-2 border-zinc-900 rounded-2xl px-5 py-4 text-sm font-black shadow-[4px_4px_0px_0px_rgba(0,0,0,0.95)] placeholder:text-zinc-300 text-zinc-900 min-w-0"
              />
              <button disabled={isTransitioning || !typedAnswer.trim()} className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-zinc-100 text-white disabled:text-zinc-400 font-black uppercase tracking-wider px-6 py-4 rounded-2xl text-xs border-2 border-zinc-900 shadow-[4px_4px_0px_0px_rgba(0,0,0,0.95)] flex items-center justify-center gap-1.5">
                Confirm <Check className="h-4 w-4" />
              </button>
            </form>
          ) : !isFlipped ? (
            <button onClick={() => setIsFlipped(true)} className="w-full bg-zinc-900 hover:bg-zinc-800 text-white py-4 px-5 font-black uppercase tracking-wider rounded-2xl text-xs border-2 border-zinc-900 shadow-[4px_4px_0px_0px_rgba(0,0,0,0.95)] flex items-center justify-center gap-2">
              <RotateCw className="h-4 w-4" /> Reveal Romaji
            </button>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <button disabled={isTransitioning} onClick={() => processReview(false)} className="py-4 px-5 rounded-2xl border-2 border-zinc-900 bg-red-400 hover:bg-red-500 text-zinc-950 font-black uppercase tracking-wider text-xs shadow-[4px_4px_0px_0px_rgba(0,0,0,0.95)] flex items-center justify-center gap-1.5 disabled:opacity-50">
                <X className="h-4 w-4" /> Forgotten <span className="opacity-50 font-normal normal-case">(1)</span>
              </button>
              <button disabled={isTransitioning} onClick={() => processReview(true)} className="py-4 px-5 rounded-2xl border-2 border-zinc-900 bg-emerald-400 hover:bg-emerald-500 text-zinc-950 font-black uppercase tracking-wider text-xs shadow-[4px_4px_0px_0px_rgba(0,0,0,0.95)] flex items-center justify-center gap-1.5 disabled:opacity-50">
                <Check className="h-4 w-4" /> Correct <span className="opacity-50 font-normal normal-case">(2)</span>
              </button>
            </div>
          )}
        </div>
      )}

      {showReport && (
        <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className="space-y-6">
          <div className="text-center space-y-2">
            <div className="w-16 h-16 bg-zinc-900 text-white rounded-3xl border-2 border-zinc-950 flex items-center justify-center mx-auto shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
              <Award className="h-8 w-8 text-amber-400 fill-amber-400" />
            </div>
            <h3 className="text-2xl font-black text-zinc-900 uppercase">Kana Practice Scorecard</h3>
            <p className="text-xs text-zinc-400 font-bold uppercase tracking-wider">Review analysis for current practice run</p>
          </div>

          <div className="grid grid-cols-12 gap-4">
            <MetricCard label="Success Rating" value={`${accuracy}%`} sublabel={`Based on ${totalAttempts} attempts`} tone="plain" wide />
            <MetricCard label="Correct / Missed" value={`${correct} / ${incorrect}`} sublabel="Session answers" tone="dark" wide />
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <button onClick={() => startPracticeSession()} className="flex-1 py-4 px-5 bg-indigo-600 hover:bg-indigo-700 text-white font-black uppercase tracking-wider rounded-2xl text-xs border-2 border-zinc-900 shadow-[4px_4px_0px_0px_rgba(0,0,0,0.95)] flex items-center justify-center gap-1.5">
              <RotateCcw className="h-4 w-4" /> Practice Again
            </button>
            <button onClick={() => { setShowReport(false); setSessionActive(false); }} className="flex-1 py-4 px-5 bg-white hover:bg-zinc-100 text-zinc-800 font-black uppercase tracking-wider rounded-2xl text-xs border-2 border-zinc-900 shadow-[4px_4px_0px_0px_rgba(0,0,0,0.95)]">
              Back to Study Desk
            </button>
          </div>
        </motion.div>
      )}
    </div>
  );
};

const ModeButton: React.FC<{ active: boolean; onClick: () => void; children: React.ReactNode }> = ({ active, onClick, children }) => (
  <button
    onClick={() => {
      sound.playTick();
      onClick();
    }}
    className={`flex-1 sm:flex-none px-4 py-2.5 text-xs font-black uppercase tracking-wider rounded-2xl transition-all ${active ? "bg-zinc-900 text-white border-2 border-zinc-900" : "text-zinc-600 hover:bg-zinc-100 border-2 border-transparent"}`}
  >
    {children}
  </button>
);

const SmallStat: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="p-3.5 bg-zinc-50 border-2 border-zinc-900 rounded-2xl">
    <span className="text-[9px] font-black uppercase text-zinc-400 block tracking-widest leading-none">{label}</span>
    <span className="text-sm font-black text-zinc-900 mt-2 block uppercase">{value}</span>
  </div>
);

const MetricCard: React.FC<{ label: string; value: React.ReactNode; sublabel: string; tone: "amber" | "dark" | "plain"; wide?: boolean }> = ({
  label,
  value,
  sublabel,
  tone,
  wide,
}) => {
  const toneClass = tone === "amber"
    ? "bg-gradient-to-br from-amber-400 to-orange-400 text-zinc-950"
    : tone === "dark"
      ? "bg-zinc-900 text-white"
      : "bg-white text-zinc-900";
  return (
    <div className={`${wide ? "col-span-12 sm:col-span-6" : "col-span-12 min-[420px]:col-span-4"} ${toneClass} rounded-3xl border-2 border-zinc-900 p-5 flex flex-col justify-between shadow-[4px_4px_0px_0px_rgba(0,0,0,0.95)]`}>
      <span className="text-[10px] font-black uppercase tracking-wider opacity-70 block leading-none">{label}</span>
      <span className="text-3xl sm:text-4xl font-extrabold block leading-none tracking-tight mt-4">{value}</span>
      <span className="text-[9px] sm:text-[10px] font-extrabold uppercase tracking-wide block leading-none mt-2 opacity-70">{sublabel}</span>
    </div>
  );
};

export default SrsQuiz;

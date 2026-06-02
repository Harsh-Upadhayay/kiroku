import React, { useState, useEffect } from "react";
import { SRSCard } from "../types";
import {
  getCardGroupLabel,
  getStoredStreak,
  isCardActive,
  updateSRSCard,
  updateStoredStreak,
} from "../utils/srs";
import { sound } from "../utils/audio";
import { 
  AnkiDeck, 
  AnkiCard, 
  getAnkiDecks, 
  getAnkiCards, 
  saveAnkiCards, 
  calculateSM2, 
  formatIntervalLabel,
  getCardMnemonic,
  getCardStrokeInfo,
  isAnkiCardDue,
  sanitizeHTML
} from "../utils/anki-sm2";
import { 
  BookOpen, 
  Check, 
  X, 
  RotateCw, 
  BookOpenCheck, 
  Zap, 
  ArrowRight, 
  Compass, 
  StopCircle, 
  Award, 
  Trophy, 
  TrendingUp, 
  BarChart2, 
  RotateCcw,
  Activity,
  AlertTriangle,
  Volume2
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface SrsQuizProps {
  cards: SRSCard[];
  activeRows: string[];
  onCardsUpdate: (updatedCards: SRSCard[]) => void;
}

export const SrsQuiz: React.FC<SrsQuizProps> = ({
  cards,
  activeRows,
  onCardsUpdate,
}) => {
  // Session active flow control
  const [sessionActive, setSessionActive] = useState<boolean>(false);
  const [showReport, setShowReport] = useState<boolean>(false);

  // Practice Style model: "typing" (Type Romaji) vs "flashcard" (Reveal card & Rate)
  const [practiceMode, setPracticeMode] = useState<"flashcard" | "typing">("typing");
  
  // Continuous queue states
  const [activeCards, setActiveCards] = useState<SRSCard[]>([]);
  const [currentItemIndex, setCurrentItemIndex] = useState<number>(0);
  
  // Card interaction state
  const [isFlipped, setIsFlipped] = useState<boolean>(false);
  const [userTypedAnswer, setUserTypedAnswer] = useState<string>("");
  const [hasSubmittedTyping, setHasSubmittedTyping] = useState<boolean>(false);
  const [isTypingCorrect, setIsTypingCorrect] = useState<boolean | null>(null);
  const [sessionFeedback, setSessionFeedback] = useState<"correct" | "incorrect" | null>(null);
  const [isReviewTransitioning, setIsReviewTransitioning] = useState<boolean>(false);

  // Running scorecard state
  const [sessionCorrect, setSessionCorrect] = useState<number>(0);
  const [sessionIncorrect, setSessionIncorrect] = useState<number>(0);

  // Active general streaks
  const [localStreak, setLocalStreak] = useState<{ current: number; highest: number }>({ current: 0, highest: 0 });

  // Custom Anki Decks State variables
  const [ankiDecks, setAnkiDecks] = useState<AnkiDeck[]>([]);
  const [allAnkiCards, setAllAnkiCards] = useState<AnkiCard[]>([]);
  const [selectedDeckId, setSelectedDeckId] = useState<string>("default");

  const [activeAnkiQueue, setActiveAnkiQueue] = useState<AnkiCard[]>([]);
  const [currentAnkiIndex, setCurrentAnkiIndex] = useState<number>(0);
  const [cardShownAt, setCardShownAt] = useState<number>(Date.now());

  // Auto-reload custom decks
  const reloadAnkiData = async () => {
    try {
      const listDecks = await getAnkiDecks();
      const listCards = await getAnkiCards();
      setAnkiDecks(listDecks);
      setAllAnkiCards(listCards);
    } catch (e) {
      console.error("Failed to load Anki decks inside SrsQuiz", e);
    }
  };

  useEffect(() => {
    reloadAnkiData();
  }, [cards, sessionActive]);

  // Load streak from disk on spawn
  useEffect(() => {
    setLocalStreak(getStoredStreak());
  }, []);

  // Utility to randomize array queue securely
  const shuffleArray = <T,>(array: T[]): T[] => {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };

  const resetInteractionState = () => {
    setIsFlipped(false);
    setUserTypedAnswer("");
    setHasSubmittedTyping(false);
    setIsTypingCorrect(null);
    setSessionFeedback(null);
  };

  // Dynamic values based on active deck selection
  const isDefaultDeck = selectedDeckId === "default";
  const currentAnkiCard = activeAnkiQueue[currentAnkiIndex];
  const currentCard = isDefaultDeck ? activeCards[currentItemIndex] : (currentAnkiCard as any);
  const currentAnkiMnemonic = !isDefaultDeck && currentAnkiCard ? getCardMnemonic(currentAnkiCard) : "";
  const currentAnkiStroke = !isDefaultDeck && currentAnkiCard ? getCardStrokeInfo(currentAnkiCard) : "";

  let displayDueCount = 0;
  let displayMasteredCount = 0;
  let displayLearningCount = 0;
  let displayTotalActive = 0;

  if (isDefaultDeck) {
    const filteredActiveGroupCards = cards.filter((c) => isCardActive(c, activeRows));
    displayDueCount = filteredActiveGroupCards.filter((c) => c.nextReview <= Date.now()).length;
    displayMasteredCount = filteredActiveGroupCards.filter((c) => c.box === 5).length;
    displayLearningCount = filteredActiveGroupCards.filter((c) => c.box < 5).length;
    displayTotalActive = filteredActiveGroupCards.length;
  } else {
    const deckCards = allAnkiCards.filter(c => c.deckId === selectedDeckId && !c.suspended);
    displayDueCount = deckCards.filter(c => isAnkiCardDue(c)).length;
    displayMasteredCount = deckCards.filter(c => c.reps >= 4).length; // studied / graduated
    displayLearningCount = deckCards.filter(c => c.reps < 4).length;
    displayTotalActive = deckCards.length;
  }

  // Initialize and spawn an endless practicing workspace
  const startPracticeSession = (studyAhead: boolean = false) => {
    if (selectedDeckId === "default") {
      const activePool = cards.filter((card) => isCardActive(card, activeRows));
      if (activePool.length === 0) return;

      // Filter due cards
      const now = Date.now();
      let dueList = activePool.filter((card) => card.nextReview <= now);

      // If queue is sparse or empty, build a mixed starting set for adaptive support
      let initQueue = [...dueList];
      if (initQueue.length < 12 || studyAhead) {
        const nonDue = activePool.filter((card) => !dueList.some((d) => d.char === card.char));
        const filler = shuffleArray(nonDue).slice(0, 15 - initQueue.length);
        initQueue = [...initQueue, ...filler];
      }

      const compiledQueue = shuffleArray(initQueue);

      setActiveCards(compiledQueue);
      setCurrentItemIndex(0);
      setSessionCorrect(0);
      setSessionIncorrect(0);
      setSessionFeedback(null);
      setIsReviewTransitioning(false);
      resetInteractionState();
      
      setSessionActive(true);
      setShowReport(false);
    } else {
      // Active Custom Anki Deck Practice Session
      const pool = allAnkiCards.filter((card) => card.deckId === selectedDeckId && !card.suspended && (!card.buriedUntil || card.buriedUntil <= Date.now()));
      if (pool.length === 0) return;

      const now = Date.now();
      let dueList = pool.filter((card) => card.nextReview <= now);

      if (dueList.length === 0 || studyAhead) {
        // Study ahead: include all cards, starting with learning/new cards or shuffled
        dueList = shuffleArray(pool);
      } else {
        dueList = shuffleArray(dueList);
      }

      // Reinforcement check: if small queue, pad with others
      if (dueList.length < 10 && pool.length > dueList.length) {
        const fillers = shuffleArray(pool.filter(c => !dueList.some(d => d.id === c.id))).slice(0, 10 - dueList.length);
        dueList = [...dueList, ...fillers];
      }

      setActiveAnkiQueue(dueList);
      setCurrentAnkiIndex(0);
      setSessionCorrect(0);
      setSessionIncorrect(0);
      setSessionFeedback(null);
      setIsReviewTransitioning(false);
      resetInteractionState();
      setCardShownAt(Date.now());

      setSessionActive(true);
      setShowReport(false);
    }
  };

  // Handle Leitner reviews with paced confirmation & speech output
  const processCardReview = (isCorrect: boolean) => {
    if (!currentCard || isReviewTransitioning) return;

    setIsReviewTransitioning(true);
    setSessionFeedback(isCorrect ? "correct" : "incorrect");

    // Audio & pronunciation vocalizations
    if (isCorrect) {
      sound.playCharacter(currentCard.char);
      sound.playCorrect();
      setSessionCorrect((prev) => prev + 1);
    } else {
      sound.playIncorrect();
      setSessionIncorrect((prev) => prev + 1);
    }

    // Save and sync database states physically
    const updated = updateSRSCard(cards, currentCard.char, isCorrect);
    const nextStreak = updateStoredStreak(isCorrect);
    setLocalStreak(nextStreak);
    onCardsUpdate(updated);

    // Create a mutable copy of the session cards
    let updatedCards = [...activeCards];

    if (!isCorrect) {
      // Dynamic reinforcement spacing: insert error letters 3 cards out in current queue
      const targetOffset = currentItemIndex + 3;
      const destination = Math.min(updatedCards.length, targetOffset);
      updatedCards.splice(destination, 0, currentCard);
    }

    // Endless self-feeding queue logic: if running small, append shuffled active items to prevent completion
    if (currentItemIndex + 4 >= updatedCards.length) {
      const activePool = cards.filter((card) => isCardActive(card, activeRows));
      const recyclePool = shuffleArray(activePool).slice(0, 10);
      updatedCards = [...updatedCards, ...recyclePool];
    }

    setActiveCards(updatedCards);

    // Slower pacing feedback duration to ensure checking correct spellings or listening to vocal cues
    const delayDuration = isCorrect ? 1300 : 1800;

    setTimeout(() => {
      setCurrentItemIndex((prev) => prev + 1);
      resetInteractionState();
      setIsReviewTransitioning(false);
    }, delayDuration);
  };

  // Process Spaced Repetition Anki level scheduling
  const handleAnkiGrade = async (grade: 1 | 2 | 3 | 4) => {
    if (!currentAnkiCard || isReviewTransitioning) return;

    setIsReviewTransitioning(true);
    const isCorrect = grade > 1;
    setSessionFeedback(isCorrect ? "correct" : "incorrect");

    if (isCorrect) {
      sound.playCharacter(currentAnkiCard.front);
      sound.playCorrect();
      setSessionCorrect((prev) => prev + 1);
    } else {
      sound.playIncorrect();
      setSessionIncorrect((prev) => prev + 1);
    }

    // Run SM-2 algorithm calculations
    const calculus = calculateSM2(
      grade,
      currentAnkiCard.interval,
      currentAnkiCard.ease,
      currentAnkiCard.reps
    );

    const answerSeconds = Math.min(60, Math.max(1, Math.round((Date.now() - cardShownAt) / 1000)));
    const updatedCard: AnkiCard = {
      ...currentAnkiCard,
      ease: calculus.newEase,
      interval: calculus.nextIntervalDays,
      reps: grade === 1 ? 0 : currentAnkiCard.reps + 1,
      lapses: grade === 1 ? currentAnkiCard.lapses + 1 : currentAnkiCard.lapses,
      nextReview: calculus.nextReviewTime,
      status: grade === 1 ? "learning" : calculus.nextIntervalDays > 21 ? "review" : "learning",
      firstReviewed: currentAnkiCard.firstReviewed || Date.now(),
      lastReviewed: Date.now(),
      totalAnswerSeconds: (currentAnkiCard.totalAnswerSeconds || 0) + answerSeconds,
      updatedAt: Date.now(),
    };

    // Save state persistently in IndexedDB
    const nextList = allAnkiCards.map((c) => (c.id === currentAnkiCard.id ? updatedCard : c));
    setAllAnkiCards(nextList);
    await saveAnkiCards(nextList);

    // Dynamic queue adjustments for incorrect answers (Reinforce inside immediate study queue)
    let nextQueue = [...activeAnkiQueue];
    if (grade === 1) {
      const targetOffset = currentAnkiIndex + 3;
      const destination = Math.min(nextQueue.length, targetOffset);
      nextQueue.splice(destination, 0, currentAnkiCard); // review again very soon
    }

    // Self feeding recycle loop when running low
    if (currentAnkiIndex + 4 >= nextQueue.length) {
        const pool = allAnkiCards.filter((c) => c.deckId === selectedDeckId && !c.suspended && (!c.buriedUntil || c.buriedUntil <= Date.now()));
      if (pool.length > 0) {
        const recycle = shuffleArray(pool).slice(0, 10);
        nextQueue = [...nextQueue, ...recycle];
      }
    }

    setActiveAnkiQueue(nextQueue);

    const duration = isCorrect ? 1300 : 1800;
    setTimeout(() => {
      setCurrentAnkiIndex((prev) => prev + 1);
      resetInteractionState();
      setCardShownAt(Date.now());
      setIsReviewTransitioning(false);
    }, duration);
  };

  // Submit and test written answers
  const handleTypingSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isReviewTransitioning) return;

    const answer = userTypedAnswer.trim().toLowerCase();
    if (isDefaultDeck) {
      if (!currentCard || hasSubmittedTyping) return;
      const cardRomaji = String(currentCard.romaji || "").toLowerCase();
      const isCorrect = answer === cardRomaji;

      setHasSubmittedTyping(true);
      setIsTypingCorrect(isCorrect);
      processCardReview(isCorrect);
    } else {
      if (!currentAnkiCard || hasSubmittedTyping) return;
      const lowerBack = String(currentAnkiCard.back || "").toLowerCase();
      const isCorrect =
        answer === lowerBack ||
        lowerBack.startsWith(answer) ||
        (answer.length >= 2 && lowerBack.includes(answer));

      setHasSubmittedTyping(true);
      setIsTypingCorrect(isCorrect);
      handleAnkiGrade(isCorrect ? 3 : 1);
    }
  };

  // Exit practice and display report scorecard
  const stopSessionAndShowProgress = () => {
    sound.playTick();
    setSessionActive(false);
    setShowReport(true);
  };

  // Compute accuracy rating safely
  const totalAttempts = sessionCorrect + sessionIncorrect;
  const accuracyPercentage = totalAttempts > 0 ? Math.round((sessionCorrect / totalAttempts) * 100) : 0;

  const RichField: React.FC<{ html?: string; className?: string }> = ({ html, className }) => (
    <div
      className={`prose prose-sm max-w-none text-zinc-700 [&_img]:max-w-full [&_img]:rounded-xl [&_img]:border [&_img]:border-zinc-200 ${className || ""}`}
      dangerouslySetInnerHTML={{ __html: sanitizeHTML(html || "") }}
    />
  );

  return (
    <div className="w-full max-w-2xl mx-auto space-y-6" id="srs-quiz-view">
      
      {/* DECK SELECTOR (Always visible outside active session) */}
      {!sessionActive && !showReport && (
        <div className="bg-white border-2 border-zinc-900 p-4 sm:p-5 rounded-[28px] shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <span className="text-[10px] font-black uppercase tracking-wider text-zinc-400 block mb-0.5">Spaced Repetition Source</span>
            <span className="font-extrabold text-sm text-zinc-900 uppercase">Selected Study Deck:</span>
          </div>
          <select
            value={selectedDeckId}
            onChange={(e) => {
              sound.playTick();
              setSelectedDeckId(e.target.value);
            }}
            className="w-full sm:w-auto bg-white text-zinc-900 text-xs font-black uppercase tracking-wider py-2.5 px-4 rounded-xl border-2 border-zinc-900 cursor-pointer min-w-[220px]"
          >
            <option value="default">Built-in Kana Deck</option>
            {ankiDecks.map(d => {
              const deckCards = allAnkiCards.filter(c => c.deckId === d.id);
              const due = deckCards.filter(c => c.nextReview <= Date.now()).length;
              return (
                <option key={d.id} value={d.id}>
                  📚 {d.name} ({due} Due / {deckCards.length} Cards)
                </option>
              );
            })}
          </select>
        </div>
      )}

      {/* 1. SETUP / OVERVIEW DASHBOARD */}
      {!sessionActive && !showReport && (
        <div className="space-y-6">
          {/* Bento Stats Matrices */}
          <div className="grid grid-cols-12 gap-4">
            {/* Streak Bento block (High contrast bright orange) */}
            <div className="col-span-12 min-[420px]:col-span-4 bg-gradient-to-br from-amber-400 to-orange-400 text-zinc-950 rounded-3xl border-2 border-zinc-900 p-4 sm:p-5 flex flex-col justify-between shadow-[4px_4px_0px_0px_rgba(0,0,0,0.95)]">
              <span className="text-[10px] font-black uppercase tracking-wider text-zinc-900/70 block leading-none">Global Streak</span>
              <div className="mt-4">
                <span className="text-3xl sm:text-4xl font-extrabold block leading-none tracking-tight">{localStreak.current}</span>
                <span className="text-[9px] sm:text-[10px] font-extrabold uppercase tracking-wide block leading-none mt-1 opacity-70">Days active</span>
              </div>
            </div>

            {/* Record High Bento block */}
            <div className="col-span-12 min-[420px]:col-span-4 bg-zinc-900 text-white rounded-3xl border-2 border-zinc-900 p-4 sm:p-5 flex flex-col justify-between shadow-[4px_4px_0px_0px_rgba(0,0,0,0.95)]">
              <span className="text-[10px] font-black uppercase tracking-wider text-zinc-400 block leading-none">Record High</span>
              <div className="mt-4">
                <span className="text-3xl sm:text-4xl font-extrabold text-indigo-400 block leading-none tracking-tight">{localStreak.highest}</span>
                <span className="text-[9px] sm:text-[10px] font-extrabold uppercase tracking-wide text-zinc-400 block leading-none mt-1">Best History</span>
              </div>
            </div>

            {/* General pending block */}
            <div className="col-span-12 min-[420px]:col-span-4 bg-white text-zinc-900 rounded-3xl border-2 border-zinc-900 p-4 sm:p-5 flex flex-col justify-between shadow-[4px_4px_0px_0px_rgba(0,0,0,0.95)]">
              <span className="text-[10px] font-black uppercase tracking-wider text-zinc-400 block leading-none">Due Reviews</span>
              <div className="mt-4">
                <span className="text-3xl sm:text-4xl font-extrabold block leading-none tracking-tight">{displayDueCount}</span>
                <span className="text-[9px] sm:text-[10px] font-extrabold uppercase tracking-wide text-emerald-650 block leading-none mt-1">Scheduled Cards</span>
              </div>
            </div>
          </div>

          {/* Mode Style Selector Block */}
          <div className="flex flex-col sm:flex-row items-center justify-between bg-white border-2 border-zinc-900 p-2.5 rounded-3xl gap-3 shadow-[3px_3px_0px_0px_rgba(0,0,0,0.95)]">
            <span className="text-[11px] font-black text-zinc-500 uppercase tracking-widest pl-3">
              Practice Calibration
            </span>
            <div className="flex gap-2 w-full sm:w-auto">
              <button
                onClick={() => {
                  sound.playTick();
                  setPracticeMode("typing");
                }}
                className={`flex-1 sm:flex-none px-4 py-2.5 text-xs font-black uppercase tracking-wider rounded-2xl transition-all cursor-pointer ${
                  practiceMode === "typing"
                    ? "bg-zinc-900 text-white border-2 border-zinc-900"
                    : "text-zinc-650 text-zinc-600 hover:bg-zinc-100 border-2 border-transparent"
                }`}
              >
                Type Answers
              </button>
              <button
                onClick={() => {
                  sound.playTick();
                  setPracticeMode("flashcard");
                }}
                className={`flex-1 sm:flex-none px-4 py-2.5 text-xs font-black uppercase tracking-wider rounded-2xl transition-all cursor-pointer ${
                  practiceMode === "flashcard"
                    ? "bg-zinc-900 text-white border-2 border-zinc-900"
                    : "text-zinc-650 text-zinc-600 hover:bg-zinc-100 border-2 border-transparent"
                }`}
              >
                Flashcard Reveal
              </button>
            </div>
          </div>

          {/* Setup Panel Frame */}
          <div className="bg-white border-2 border-zinc-900 rounded-[28px] sm:rounded-[32px] p-4 sm:p-6 text-center shadow-[5px_5px_0px_0px_rgba(0,0,0,1)] sm:shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]">
            <div className="w-16 h-16 bg-indigo-50 rounded-2xl flex items-center justify-center mx-auto mb-4 border-2 border-zinc-900 text-indigo-600 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
              <Compass className="h-8 w-8 text-zinc-950" />
            </div>
            
            <h3 className="text-xl font-black text-zinc-900 uppercase">
              {isDefaultDeck ? "Adaptive Study Desk" : "Anki SM-2 Study Desk"}
            </h3>
            <p className="text-xs text-zinc-400 font-bold uppercase tracking-wide mt-1.5 max-w-md mx-auto leading-relaxed">
              {isDefaultDeck 
                ? "Launches an endless study workflow from your selected hiragana and katakana groups."
                : `Active Deck: "${ankiDecks.find(d => d.id === selectedDeckId)?.name || 'Anki Deck'}" loaded dynamically with all four review grades.`}
            </p>

            <div className="my-5 border-t border-dashed border-zinc-200 pt-5 text-left grid grid-cols-2 gap-4">
              <div className="p-3.5 bg-zinc-50 border-2 border-zinc-900 rounded-2xl">
                <span className="text-[9px] font-black uppercase text-zinc-400 block tracking-widest leading-none">
                  {isDefaultDeck ? "Active Series List" : "Total Deck Cards"}
                </span>
                <span className="text-sm font-black text-zinc-900 mt-2 block uppercase">
                  {isDefaultDeck ? `${activeRows.length} Series checked` : `${displayTotalActive} Cards`}
                </span>
              </div>
              <div className="p-3.5 bg-zinc-50 border-2 border-zinc-900 rounded-2xl">
                <span className="text-[9px] font-black uppercase text-zinc-400 block tracking-widest leading-none">
                  Graduation Levels
                </span>
                <span className="text-sm font-black text-emerald-600 mt-2 block uppercase">
                  {displayMasteredCount} Mastered / {displayLearningCount} Learning
                </span>
              </div>
            </div>

            {isDefaultDeck && activeRows.length === 0 ? (
              <div className="bg-amber-50 border-2 border-amber-300 rounded-2xl p-4 text-xs font-bold text-amber-900 flex items-start gap-2 text-left mb-4">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>No character series are active. Please select active rows in the Glossary sheet tab before practicing!</span>
              </div>
            ) : displayTotalActive === 0 ? (
              <div className="bg-amber-50 border-2 border-amber-300 rounded-2xl p-4 text-xs font-bold text-amber-900 text-center mb-4">
                <AlertTriangle className="h-4 w-4 inline mr-1.5 shrink-0" />
                <span>This deck is currently empty. Go to variables in the Syllabary Glossary setup page to paste notes or install presets!</span>
              </div>
            ) : displayDueCount === 0 && !isDefaultDeck ? (
              <div className="space-y-4">
                <div className="bg-emerald-50 border-2 border-emerald-300 rounded-2xl p-4 text-xs font-bold text-emerald-900 text-center">
                  <Check className="h-4 w-4 inline mr-1.5 text-emerald-600 font-extrabold stroke-[4]" />
                  <span>Congratulations! You are completely caught up with this deck for now. No sessions are due!</span>
                </div>
                <button
                  onClick={() => {
                    sound.playTick();
                    startPracticeSession(true); // study ahead!
                  }}
                  className="w-full py-4 px-6 bg-zinc-900 hover:bg-zinc-800 text-white font-black uppercase tracking-wider rounded-2xl border-2 border-zinc-950 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] transition-transform active:translate-y-0.5 cursor-pointer flex items-center justify-center gap-2"
                >
                  <Compass className="h-5 w-5" />
                  Study Ahead / Custom Review
                </button>
              </div>
            ) : (
              <button
                onClick={() => {
                  sound.playTick();
                  startPracticeSession();
                }}
                className="w-full py-4 px-6 bg-indigo-600 hover:bg-indigo-700 text-white font-black uppercase tracking-wider rounded-2xl border-2 border-zinc-900 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] transition-transform active:translate-y-0.5 cursor-pointer flex items-center justify-center gap-2"
              >
                <Compass className="h-5 w-5" />
                Launch Practice Session ({displayDueCount} Card{displayDueCount !== 1 ? 's':''})
              </button>
            )}
          </div>
        </div>
      )}

      {/* 2. ENDLESS PRACTICE WORKSPACE */}
      {sessionActive && currentCard && (
        <div className="space-y-6">
          {/* Running progress and stop header bar */}
          <div className="flex flex-col min-[480px]:flex-row min-[480px]:items-center justify-between gap-3 bg-zinc-900 text-white p-3.5 sm:p-4 border-2 border-zinc-900 rounded-3xl shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
            <div className="flex items-center gap-3 min-w-0">
              <span className="h-3 w-3 rounded-full bg-emerald-400 animate-pulse border border-zinc-950 shrink-0" />
              <div className="text-xs uppercase tracking-wide font-bold min-w-0">
                Session Score: <strong className="text-emerald-400">{sessionCorrect} Correct</strong> / <strong className="text-red-400">{sessionIncorrect} Missed</strong>
              </div>
            </div>

            <button
              onClick={stopSessionAndShowProgress}
              className="py-1.5 px-3 bg-red-500 hover:bg-red-650 text-white border-2 border-zinc-950 font-black text-[10px] uppercase tracking-wider rounded-xl transition-all cursor-pointer flex items-center gap-1.5"
            >
              <StopCircle className="h-3.5 w-3.5" /> Stop Practice
            </button>
          </div>

          {/* Flashcard Representation Container */}
          <div className="relative">
            <AnimatePresence mode="wait">
              <motion.div
                key={(isDefaultDeck ? currentItemIndex : currentAnkiIndex) + "-" + (isFlipped ? "flipped" : "front")}
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={{ duration: 0.15 }}
                className="w-full min-h-[320px] sm:min-h-[400px] bg-white border-2 border-zinc-900 rounded-[28px] sm:rounded-[32px] p-4 sm:p-7 shadow-[5px_5px_0px_0px_rgba(0,0,0,1)] sm:shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] flex flex-col justify-between items-center relative overflow-hidden cursor-pointer"
                onClick={() => {
                  if (practiceMode === "flashcard") {
                    sound.playTick();
                    setIsFlipped(!isFlipped);
                  }
                }}
              >
                {/* Visual Header */}
                <div className="w-full flex flex-col min-[420px]:flex-row min-[420px]:justify-between min-[420px]:items-center gap-2 text-xs text-zinc-400 font-black uppercase tracking-widest">
                  <span className="truncate max-w-full">
                    {isDefaultDeck 
                      ? `Group: ${getCardGroupLabel(currentCard)}` 
                      : `Anki: ${ankiDecks.find(d => d.id === selectedDeckId)?.name || "custom"}`
                    }
                  </span>
                  <span className="px-2.5 py-1 bg-zinc-150 border border-zinc-300 rounded-lg text-zinc-800 font-bold">
                    {isDefaultDeck ? `Box ${currentCard.box} / 5` : `Ease: ${currentCard.ease}x`}
                  </span>
                </div>

                {/* Main symbol rendering */}
                <div className="text-center w-full my-auto flex flex-col items-center justify-center px-4">
                  {!isFlipped ? (
                    <div className="flex flex-col items-center">
                      <span className="text-[52px] sm:text-[76px] font-extrabold text-zinc-900 select-none leading-tight block">
                        {isDefaultDeck ? currentCard.char : currentCard.front}
                      </span>
                      {practiceMode === "flashcard" && (
                        <span className="text-[10px] font-extrabold text-zinc-400 uppercase tracking-widest flex items-center gap-1.5 mt-4 bg-zinc-50 border border-zinc-200 py-1 px-2.5 rounded-lg select-none">
                          <RotateCw className="h-3 w-3" /> Click card to flip
                        </span>
                      )}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center w-full">
                      <span className="text-[32px] sm:text-[44px] font-extrabold text-indigo-600 tracking-tight leading-normal block">
                        {isDefaultDeck ? currentCard.romaji : currentCard.back}
                      </span>
                      <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mt-4 bg-indigo-50 border border-indigo-150 px-2.5 py-1 rounded-md">
                        {isDefaultDeck ? "Phonetic Romaji Key" : "Graded Answer Key"}
                      </span>

                      {!isDefaultDeck && (currentAnkiMnemonic || currentAnkiStroke || currentAnkiCard.strokeCount) && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full mt-5 text-left">
                          {currentAnkiMnemonic && (
                            <div className="rounded-2xl border-2 border-emerald-300 bg-emerald-50 p-3">
                              <span className="text-[9px] font-black uppercase tracking-widest text-emerald-700 block mb-1">
                                Mnemonic / Story
                              </span>
                              <RichField html={currentAnkiMnemonic} />
                            </div>
                          )}
                          {(currentAnkiStroke || currentAnkiCard.strokeCount) && (
                            <div className="rounded-2xl border-2 border-indigo-300 bg-indigo-50 p-3">
                              <span className="text-[9px] font-black uppercase tracking-widest text-indigo-700 block mb-1">
                                Stroke Info
                              </span>
                              {currentAnkiCard.strokeCount ? (
                                <span className="inline-block mb-2 text-[9px] font-black uppercase bg-white border border-indigo-200 rounded-lg px-2 py-1 text-indigo-900">
                                  {currentAnkiCard.strokeCount} strokes
                                </span>
                              ) : null}
                              <RichField html={currentAnkiStroke} />
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Footer and helper triggers */}
                <div className="w-full flex flex-col sm:flex-row items-center justify-between gap-3 mt-4 border-t border-zinc-150 pt-4">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      sound.playCharacter(isDefaultDeck ? currentCard.char : currentCard.front);
                    }}
                    className="w-full sm:w-auto py-2 px-3.5 bg-zinc-100 hover:bg-zinc-200 text-zinc-900 text-xs font-black uppercase tracking-wider rounded-xl border border-zinc-300 transition-colors cursor-pointer flex items-center justify-center gap-1.5 shadow-sm active:translate-y-0.5"
                  >
                    <Volume2 className="h-3.5 w-3.5 text-zinc-650" /> Hear Pronunciation
                  </button>

                  <span className="text-[10px] font-extrabold text-zinc-400 uppercase tracking-widest font-mono text-center">
                    Completed reviews: {isDefaultDeck ? currentItemIndex : currentAnkiIndex}
                  </span>
                </div>

                {/* Correct/Incorrect overlay filters */}
                {sessionFeedback && (
                  <div
                    className={`absolute inset-0 border-4 pointer-events-none rounded-[30px] z-20 ${
                      sessionFeedback === "correct" 
                        ? "border-emerald-500 bg-emerald-50/5" 
                        : "border-red-500 bg-red-50/5"
                    }`}
                  />
                )}
              </motion.div>
            </AnimatePresence>
          </div>

          {/* PRACTICE METHOD CONTROLLER ELEMENTS */}
          
          {/* 1. Typing Mode form */}
          {practiceMode === "typing" && (
            <form onSubmit={handleTypingSubmit} className="flex flex-col min-[480px]:flex-row gap-3">
              <input
                type="text"
                value={userTypedAnswer}
                onChange={(e) => setUserTypedAnswer(e.target.value)}
                autoFocus
                placeholder={isDefaultDeck ? "Type Hepburn pronunciation (e.g. ka, tsu)..." : "Type answer translation..."}
                disabled={hasSubmittedTyping || isReviewTransitioning}
                className="flex-1 bg-white border-2 border-zinc-900 rounded-2xl px-5 py-4 text-sm font-black focus:outline-none focus:ring-0 shadow-[4px_4px_0px_0px_rgba(0,0,0,0.95)] placeholder:text-zinc-300 text-zinc-900 min-w-0"
              />
              <button
                type="submit"
                disabled={hasSubmittedTyping || isReviewTransitioning || !userTypedAnswer}
                className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-zinc-100 text-white disabled:text-zinc-450 font-black uppercase tracking-wider px-6 py-4 rounded-2xl text-xs border-2 border-zinc-900 shadow-[4px_4px_0px_0px_rgba(0,0,0,0.95)] transition-all flex items-center justify-center gap-1.5 shrink-0 cursor-pointer"
              >
                Confirm
                <Check className="h-4 w-4" />
              </button>
            </form>
          )}

          {/* 2. Flashcard Flip & self rate buttons */}
          {practiceMode === "flashcard" && (
            <div className="flex flex-col gap-2">
              {!isFlipped ? (
                <button
                  type="button"
                  onClick={() => {
                    sound.playTick();
                    setIsFlipped(true);
                  }}
                  className="w-full bg-zinc-900 hover:bg-zinc-800 text-white py-4 px-5 font-black uppercase tracking-wider rounded-2xl text-xs border-2 border-zinc-900 shadow-[4px_4px_0px_0px_rgba(0,0,0,0.95)] transition-transform active:translate-y-0.5 text-center flex items-center justify-center gap-2 cursor-pointer"
                >
                  <RotateCw className="h-4 w-4" />
                  Reveal Card Back
                </button>
              ) : isDefaultDeck ? (
                /* Default Simple Deck Rating (Forgotten vs advance) */
                <div className="grid grid-cols-2 gap-3">
                  <button
                    disabled={isReviewTransitioning}
                    onClick={() => processCardReview(false)}
                    className="py-4 px-5 rounded-2xl border-2 border-zinc-900 bg-red-400 hover:bg-red-500 text-zinc-950 font-black uppercase tracking-wider text-xs shadow-[4px_4px_0px_0px_rgba(0,0,0,0.95)] transition-transform active:translate-y-0.5 cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-50"
                  >
                    <X className="h-4 w-4" />
                    Forgotten (Reset)
                  </button>
                  <button
                    disabled={isReviewTransitioning}
                    onClick={() => processCardReview(true)}
                    className="py-4 px-5 rounded-2xl border-2 border-zinc-900 bg-emerald-400 hover:bg-emerald-500 text-zinc-950 font-black uppercase tracking-wider text-xs shadow-[4px_4px_0px_0px_rgba(0,0,0,0.95)] transition-transform active:translate-y-0.5 cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-50"
                  >
                    <Check className="h-4 w-4" />
                    Correct (Advance)
                  </button>
                </div>
              ) : (
                /* Active Custom Anki Deck: Genuine 4-button SM-2 review options! */
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  <button
                    disabled={isReviewTransitioning}
                    onClick={() => handleAnkiGrade(1)}// AGAIN
                    className="py-3 px-2 rounded-2xl border-2 border-zinc-900 bg-red-400 hover:bg-red-500 text-zinc-950 flex flex-col items-center justify-center shadow-[3px_3px_0px_0px_rgba(0,0,0,0.95)] transition-transform active:translate-y-0.5 cursor-pointer disabled:opacity-50"
                  >
                    <span className="font-black uppercase tracking-wider text-[11px]">Again</span>
                    <span className="text-[9px] font-mono tracking-wide font-black mt-0.5 text-red-950/70 border border-red-500/20 px-1.5 rounded-md bg-red-500/10">
                      {formatIntervalLabel(calculateSM2(1, currentCard.interval, currentCard.ease, currentCard.reps).nextIntervalDays)}
                    </span>
                  </button>

                  <button
                    disabled={isReviewTransitioning}
                    onClick={() => handleAnkiGrade(2)}// HARD
                    className="py-3 px-2 rounded-2xl border-2 border-zinc-900 bg-amber-400 hover:bg-amber-500 text-zinc-950 flex flex-col items-center justify-center shadow-[3px_3px_0px_0px_rgba(0,0,0,0.95)] transition-transform active:translate-y-0.5 cursor-pointer disabled:opacity-50"
                  >
                    <span className="font-black uppercase tracking-wider text-[11px]">Hard</span>
                    <span className="text-[9px] font-mono tracking-wide font-black mt-0.5 text-amber-950/75 border border-amber-500/20 px-1.5 rounded-md bg-amber-500/15">
                      {formatIntervalLabel(calculateSM2(2, currentCard.interval, currentCard.ease, currentCard.reps).nextIntervalDays)}
                    </span>
                  </button>

                  <button
                    disabled={isReviewTransitioning}
                    onClick={() => handleAnkiGrade(3)}// GOOD
                    className="py-3 px-2 rounded-2xl border-2 border-zinc-900 bg-indigo-200 hover:bg-indigo-300 text-zinc-950 flex flex-col items-center justify-center shadow-[3px_3px_0px_0px_rgba(0,0,0,0.95)] transition-transform active:translate-y-0.5 cursor-pointer disabled:opacity-50"
                  >
                    <span className="font-black uppercase tracking-wider text-[11px]">Good</span>
                    <span className="text-[9px] font-mono tracking-wide font-black mt-0.5 text-indigo-950/70 border border-indigo-500/20 px-1.5 rounded-md bg-indigo-500/15">
                      {formatIntervalLabel(calculateSM2(3, currentCard.interval, currentCard.ease, currentCard.reps).nextIntervalDays)}
                    </span>
                  </button>

                  <button
                    disabled={isReviewTransitioning}
                    onClick={() => handleAnkiGrade(4)}// EASY
                    className="py-3 px-2 rounded-2xl border-2 border-zinc-900 bg-emerald-400 hover:bg-emerald-500 text-zinc-950 flex flex-col items-center justify-center shadow-[3px_3px_0px_0px_rgba(0,0,0,0.95)] transition-transform active:translate-y-0.5 cursor-pointer disabled:opacity-50"
                  >
                    <span className="font-black uppercase tracking-wider text-[11px]">Easy</span>
                    <span className="text-[9px] font-mono tracking-wide font-black mt-0.5 text-emerald-950/70 border border-emerald-500/20 px-1.5 rounded-md bg-emerald-500/15">
                      {formatIntervalLabel(calculateSM2(4, currentCard.interval, currentCard.ease, currentCard.reps).nextIntervalDays)}
                    </span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 3. PERFORMANCE SUMMARY REPORT */}
      {showReport && (
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          className="space-y-6"
        >
          {/* Card Title Header Centering */}
          <div className="text-center space-y-2">
            <div className="w-16 h-16 bg-zinc-900 text-white rounded-3xl border-2 border-zinc-950 flex items-center justify-center mx-auto shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
              <Award className="h-8 w-8 text-amber-400 fill-amber-400" />
            </div>
            <h3 className="text-2xl font-black text-zinc-900 uppercase">Practice Scorecard</h3>
            <p className="text-xs text-zinc-400 font-bold uppercase tracking-wider font-sans">Review analysis for current practice run</p>
          </div>

          {/* Report Bento Score grids */}
          <div className="grid grid-cols-12 gap-4">
            {/* Accuracy Rate Card */}
            <div className="col-span-12 sm:col-span-6 bg-indigo-50 border-2 border-zinc-900 p-5 rounded-3xl flex flex-col justify-between shadow-[4px_4px_0px_0px_rgba(0,0,0,0.95)]">
              <div>
                <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400 block mb-1">Success Rating</span>
                <span className="text-4xl font-extrabold text-indigo-600 block tracking-tight font-mono leading-none">{accuracyPercentage}%</span>
              </div>
              <span className="text-[10px] font-bold text-indigo-900/60 uppercase tracking-wider mt-4 block leading-none font-sans">
                Based on {totalAttempts} key attempts
              </span>
            </div>

            {/* Answer Scoreboard Counts */}
            <div className="col-span-12 sm:col-span-6 bg-white border-2 border-zinc-900 p-5 rounded-3xl flex flex-col justify-between shadow-[4px_4px_0px_0px_rgba(0,0,0,0.95)]">
              <div className="flex justify-between items-center pb-2.5 border-b border-dashed border-zinc-200">
                <span className="text-[10px] font-extrabold uppercase text-zinc-400 font-sans">Total Correct:</span>
                <span className="text-lg font-black font-mono text-emerald-600">+{sessionCorrect}</span>
              </div>
              <div className="flex justify-between items-center pt-2.5 font-sans">
                <span className="text-[10px] font-extrabold uppercase text-zinc-400">Mistakes:</span>
                <span className="text-lg font-black font-mono text-red-600">-{sessionIncorrect}</span>
              </div>
            </div>
          </div>

          {/* Mastered and Remaining Words stats */}
          <div className="bg-zinc-900 text-white rounded-3xl p-5 border-2 border-zinc-900 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] grid grid-cols-2 gap-4 divide-x divide-zinc-700">
            <div className="text-center pr-2">
              <span className="text-[10px] font-black uppercase text-zinc-400 block tracking-widest leading-none font-sans">Studied / Graduated</span>
              <span className="text-3xl font-black text-emerald-400 mt-3 block font-mono">{displayMasteredCount}</span>
              <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-widest mt-1 block font-sans">
                {isDefaultDeck ? "Level Box 5 cards" : "Reps \u2265 4 Graduated"}
              </span>
            </div>
            <div className="text-center pl-2">
              <span className="text-[10px] font-black uppercase text-zinc-400 block tracking-widest leading-none font-sans">Remaining</span>
              <span className="text-3xl font-black text-[#818cf8] mt-3 block font-mono">{displayLearningCount}</span>
              <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-widest mt-1 block font-sans">
                {isDefaultDeck ? "Boxes 1 to 4 remaining" : "Reps < 4 Learning"}
              </span>
            </div>
          </div>

          {/* Final controls inside reports context */}
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={() => {
                sound.playTick();
                startPracticeSession();
              }}
              className="flex-1 py-4 px-5 bg-indigo-600 hover:bg-indigo-700 text-white font-black uppercase tracking-wider rounded-2xl text-xs border-2 border-zinc-900 shadow-[4px_4px_0px_0px_rgba(0,0,0,0.95)] transition-transform active:translate-y-0.5 cursor-pointer flex items-center justify-center gap-1.5"
            >
              <RotateCcw className="h-4 w-4" /> Practice Again
            </button>
            <button
              onClick={() => {
                sound.playTick();
                setShowReport(false);
                setSessionActive(false);
              }}
              className="flex-1 py-4 px-5 bg-white hover:bg-zinc-100 text-zinc-800 font-black uppercase tracking-wider rounded-2xl text-xs border-2 border-zinc-900 shadow-[4px_4px_0px_0px_rgba(0,0,0,0.95)] transition-transform active:translate-y-0.5 cursor-pointer"
            >
              Back to Study Desk
            </button>
          </div>
        </motion.div>
      )}

    </div>
  );
};

export default SrsQuiz;

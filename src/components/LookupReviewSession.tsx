import React, { useMemo, useState } from "react";
import { RotateCcw, Volume2 } from "lucide-react";
import { motion } from "motion/react";
import { sound } from "../utils/audio";
import { KanjiText, WordKanjiStrip } from "./KanjiBreakdown";
import {
  getDueLookupCards,
  gradeLookupCard,
  type LookupCard,
  type LookupGrade,
} from "../utils/lookup-deck";

const GRADES: { grade: LookupGrade; label: string; cls: string }[] = [
  { grade: 1, label: "Again", cls: "bg-rose-500 hover:bg-rose-400" },
  { grade: 2, label: "Hard", cls: "bg-amber-500 hover:bg-amber-400" },
  { grade: 3, label: "Good", cls: "bg-emerald-500 hover:bg-emerald-400" },
  { grade: 4, label: "Easy", cls: "bg-sky-500 hover:bg-sky-400" },
];

export const ReviewSession: React.FC<{
  cards: LookupCard[];
  onExit: () => void;
  onCardsChange: (cards: LookupCard[]) => void;
}> = ({ cards, onExit, onCardsChange }) => {
  const [queue] = useState<string[]>(() => getDueLookupCards(cards).map((c) => c.id));
  const [pos, setPos] = useState(0);
  const [revealed, setRevealed] = useState(false);

  const cardsById = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);
  const currentId = queue[pos];
  const card = currentId ? cardsById.get(currentId) : undefined;

  function handleGrade(grade: LookupGrade) {
    if (!card) return;
    const { card: updated } = gradeLookupCard(card, grade);
    onCardsChange(cards.map((c) => (c.id === updated.id ? updated : c)));
    setRevealed(false);
    setPos((p) => p + 1);
  }

  const done = pos >= queue.length;

  return (
    <div className="max-w-xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <button onClick={onExit} className="text-xs font-black uppercase tracking-wide text-zinc-500 hover:text-zinc-900">
          ← Back to vocab
        </button>
        {!done ? (
          <span className="text-xs font-black text-zinc-400">
            {pos + 1} / {queue.length}
          </span>
        ) : null}
      </div>

      {done || !card ? (
        <div className="border-2 border-zinc-900 rounded-[24px] p-10 text-center space-y-4 bg-white">
          <p className="text-lg font-black text-emerald-600">Review complete!</p>
          <p className="text-sm font-bold text-zinc-500">You reviewed {queue.length} card{queue.length === 1 ? "" : "s"}.</p>
          <button
            onClick={onExit}
            className="inline-flex items-center gap-2 rounded-2xl border-2 border-zinc-900 bg-indigo-600 text-white hover:bg-indigo-500 px-4 py-2.5 text-sm font-black uppercase tracking-wide shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]"
          >
            <RotateCcw className="h-4 w-4" /> Done
          </button>
        </div>
      ) : (
        <motion.div
          key={card.id}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.15 }}
          className="border-2 border-zinc-900 rounded-[28px] p-6 bg-white shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] space-y-5 text-center"
        >
          <div className="text-6xl font-black text-zinc-950 flex items-center justify-center gap-3">
            <KanjiText text={card.word} />
            <button
              onClick={() => sound.playCharacter(card.word)}
              aria-label="Play"
              className="inline-flex items-center justify-center rounded-xl border-2 border-zinc-900 bg-white hover:bg-indigo-50 p-1.5"
            >
              <Volume2 className="h-5 w-5 text-indigo-600" />
            </button>
          </div>

          {!revealed ? (
            <button
              onClick={() => setRevealed(true)}
              className="w-full rounded-2xl border-2 border-zinc-900 bg-zinc-900 text-white hover:bg-zinc-800 py-3 text-sm font-black uppercase tracking-wide"
            >
              Show answer
            </button>
          ) : (
            <>
              {card.reading && card.reading !== card.word ? (
                <div className="text-lg font-black text-indigo-700">{card.reading}</div>
              ) : null}
              <div className="text-sm font-bold text-zinc-700">{card.meanings.join("; ")}</div>
              <WordKanjiStrip word={card.word} />
              {card.example ? (
                <div className="bg-indigo-50 border-2 border-indigo-200 rounded-2xl p-3 text-left">
                  <div className="text-sm font-black text-zinc-950">
                    <KanjiText text={card.example.j} />
                  </div>
                  <p className="text-xs font-bold text-zinc-500 mt-1">{card.example.e}</p>
                </div>
              ) : null}
              <div className="grid grid-cols-4 gap-2 pt-1">
                {GRADES.map((g) => (
                  <button
                    key={g.grade}
                    onClick={() => handleGrade(g.grade)}
                    className={`rounded-xl border-2 border-zinc-900 text-white py-2.5 text-xs font-black uppercase tracking-wide ${g.cls}`}
                  >
                    {g.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </motion.div>
      )}
    </div>
  );
};

export default ReviewSession;

import React, { useEffect, useMemo, useState } from "react";
import { n5Course } from "../content/n5/raw";
import { buildMcQuestion } from "../utils/n5-mc";
import type { N5CourseProgress, N5Grade, N5SRSCard } from "../utils/n5-course";
import { sound } from "../utils/audio";

const gradeLabels: Record<N5Grade, string> = { 1: "Again", 2: "Hard", 3: "Good", 4: "Easy" };

interface McReviewPanelProps {
  card: N5SRSCard;
  /** Controlled by parent via isBackShown */
  isRevealed: boolean;
  onReveal: (pickedCorrect: boolean | null) => void;
  onGrade: (g: N5Grade) => void;
  progress: N5CourseProgress;
  /** Full answer back rendered by reviewContent(); always uses KanjiText so kanji are decomposable. */
  back: React.ReactNode;
  cardLabel: string;
  dueLabel: string;
}

export const McReviewPanel: React.FC<McReviewPanelProps> = ({
  card,
  isRevealed,
  onReveal,
  onGrade,
  progress,
  back,
  cardLabel,
  dueLabel,
}) => {
  const [pickedIndex, setPickedIndex] = useState<number | null>(null);

  const question = useMemo(
    () => buildMcQuestion(card, n5Course, progress),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [card.id, card.reps],
  );

  // Combined revealed flag: true once the user picks or "show answer" is clicked.
  const revealed = isRevealed || pickedIndex !== null;

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (!revealed) {
        if (["1", "2", "3", "4"].includes(e.key) && question) {
          const idx = Number(e.key) - 1;
          if (idx < question.options.length) { e.preventDefault(); handlePick(idx); }
        } else if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          handleShowAnswer();
        }
      } else {
        if (["1", "2", "3", "4"].includes(e.key)) { e.preventDefault(); onGrade(Number(e.key) as N5Grade); }
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealed, question, onGrade]);

  function handlePick(idx: number) {
    if (pickedIndex !== null || !question) return;
    setPickedIndex(idx);
    const correct = idx === question.correctIndex;
    if (correct) sound.playCorrect(); else sound.playIncorrect();
    onReveal(correct);
  }

  function handleShowAnswer() {
    onReveal(null);
  }

  if (!question) return null;

  return (
    <div className="space-y-4">
      <div className="border-2 border-zinc-900 rounded-[24px] p-5 space-y-4">
        <div className="flex justify-between text-[10px] font-black uppercase text-zinc-400">
          <span>{cardLabel}</span>
          <span>{dueLabel}</span>
        </div>

        {/* Prompt */}
        <div className="text-center py-4">
          <div className="text-xl sm:text-2xl font-black text-zinc-950 leading-relaxed break-words">
            {question.promptMain}
          </div>
          {question.promptSub && (
            <div className="mt-2 text-sm font-bold text-zinc-500">{question.promptSub}</div>
          )}
        </div>

        {/* Options grid — plain text during question, color-coded after reveal */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {question.options.map((opt, i) => {
            let cls = "py-3 px-4 rounded-2xl border-2 text-sm font-black text-left transition-colors ";
            if (!revealed) {
              cls += "border-zinc-900 bg-white hover:bg-indigo-50 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] cursor-pointer";
            } else {
              if (i === question.correctIndex) {
                cls += "border-zinc-900 bg-emerald-300 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]";
              } else if (i === pickedIndex) {
                cls += "border-zinc-900 bg-red-300";
              } else {
                cls += "border-zinc-200 bg-white opacity-40";
              }
            }
            return (
              <button
                key={i}
                onClick={() => handlePick(i)}
                disabled={revealed}
                className={cls}
              >
                <span className="text-[10px] font-black uppercase text-zinc-400 mr-2">{i + 1}</span>
                {opt.text}
                {opt.sub && <span className="ml-2 text-xs font-bold text-zinc-500">{opt.sub}</span>}
              </button>
            );
          })}
        </div>

        {!revealed ? (
          <button
            onClick={handleShowAnswer}
            className="mx-auto block text-[11px] font-black uppercase text-zinc-400 hover:text-zinc-900"
          >
            Show answer instead <span className="opacity-50 font-normal normal-case">(Space)</span>
          </button>
        ) : (
          <>
            <div className="border-t-2 border-zinc-100 pt-4 text-center">
              {back}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {([1, 2, 3, 4] as N5Grade[]).map((grade) => (
                <button
                  key={grade}
                  onClick={() => onGrade(grade)}
                  className={`py-3 rounded-2xl border-2 border-zinc-900 text-xs font-black uppercase ${grade === 1 ? "bg-red-300" : grade === 2 ? "bg-amber-300" : grade === 3 ? "bg-indigo-200" : "bg-emerald-300"}`}
                >
                  {gradeLabels[grade]} <span className="opacity-40 font-normal normal-case">({grade})</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

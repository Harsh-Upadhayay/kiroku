import React from "react";
import { X } from "lucide-react";
import type { N5DayPlan, N5GrammarPoint } from "../content/n5/parser";
import {
  cardIdForKanji,
  cardIdForVocab,
  effectiveKanjiQueue,
  effectiveVocabQueue,
  type N5CourseProgress,
  type N5DayProgress,
  type N5SRSCard,
  type N5Stage,
} from "../utils/n5-course";

interface MinimapProps {
  day: N5DayPlan;
  state: N5DayProgress;
  cards: N5SRSCard[];
  progress: N5CourseProgress;
  dueCardCount: number;
  onNavigate: (stage: N5Stage, index?: number) => void;
  /** Only used in mobile toggle mode */
  onClose?: () => void;
}

type CellState = "current" | "learnt" | "skipped" | "none";

function cellClass(cs: CellState): string {
  const base = "aspect-square rounded-md border-2 cursor-pointer transition-colors ";
  switch (cs) {
    case "current": return base + "bg-indigo-600 border-zinc-900";
    case "learnt":  return base + "bg-emerald-400 border-zinc-900";
    case "skipped": return base + "bg-amber-300 border-zinc-900";
    default:        return base + "bg-white border-zinc-300 hover:bg-zinc-50";
  }
}

export const LessonMinimapGrid: React.FC<MinimapProps> = ({
  day, state, cards, progress, dueCardCount, onNavigate, onClose,
}) => {
  const vocabQueue = effectiveVocabQueue(day, state);
  const kanjiQueue = effectiveKanjiQueue(day, state);
  const deferredVocab = new Set<string>(state.deferredVocabIds || []);
  const deferredKanji = new Set<string>(state.deferredKanjiIds || []);
  const learnedGrammar = new Set<string>(progress.learnedGrammarIds || []);
  const learnedVocab = new Set<string>(progress.learnedVocabIds);
  const learnedKanji = new Set<string>(progress.learnedKanjiIds);

  function grammarCellState(point: N5GrammarPoint, i: number): CellState {
    if (state.stage === "grammar" && state.grammarIndex === i) return "current";
    if (learnedGrammar.has(point.id)) return "learnt";
    if (state.stagesCompleted?.grammar) return "learnt";
    if (state.stage !== "grammar" && !state.stagesCompleted?.grammar) return "none";
    return state.grammarIndex > i ? "learnt" : "none";
  }

  function vocabCellState(entry: { id: string }, i: number): CellState {
    if (state.stage === "vocab" && state.vocabIndex === i) return "current";
    if (learnedVocab.has(entry.id)) return "learnt";
    if (deferredVocab.has(entry.id)) return "skipped";
    if (state.stagesCompleted?.vocab) return "learnt";
    return "none";
  }

  function kanjiCellState(entry: { kanji: string; id: string }, i: number): CellState {
    if (state.stage === "kanji" && state.kanjiIndex === i) return "current";
    if (learnedKanji.has(entry.kanji)) return "learnt";
    if (deferredKanji.has(entry.kanji)) return "skipped";
    if (state.stagesCompleted?.kanji) return "learnt";
    return "none";
  }

  function reviewCellState(): CellState {
    if (state.stage === "review") return "current";
    if (state.stagesCompleted?.review) return "learnt";
    return dueCardCount === 0 ? "learnt" : "none";
  }

  function produceCellState(): CellState {
    if (state.stage === "produce") return "current";
    if (state.stagesCompleted?.produce) return "learnt";
    return "none";
  }

  function doneCellState(): CellState {
    if (state.stage === "done") return "current";
    if (state.stagesCompleted?.done) return "learnt";
    return "none";
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-black uppercase tracking-widest text-zinc-400">Day {day.day} · Outline</span>
        {onClose && (
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-900">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Legend */}
      <div className="flex gap-2 flex-wrap">
        {[
          { color: "bg-indigo-600", label: "Current" },
          { color: "bg-emerald-400", label: "Learnt" },
          { color: "bg-amber-300", label: "Skipped" },
          { color: "bg-white border border-zinc-300", label: "Not yet" },
        ].map(({ color, label }) => (
          <span key={label} className="flex items-center gap-1 text-[9px] font-bold text-zinc-500">
            <span className={`inline-block w-2.5 h-2.5 rounded-sm ${color}`} />
            {label}
          </span>
        ))}
      </div>

      {/* Review */}
      <section>
        <div className="text-[9px] font-black uppercase tracking-widest text-zinc-400 mb-1">
          Review <span className="ml-1 text-zinc-300">{dueCardCount}</span>
        </div>
        <div className="grid grid-cols-8 gap-1">
          <button
            onClick={() => onNavigate("review")}
            title={dueCardCount > 0 ? `${dueCardCount} due` : "All caught up"}
            className={`col-span-8 h-5 rounded-md border-2 cursor-pointer transition-colors ${reviewCellState() === "current" ? "bg-indigo-600 border-zinc-900" : reviewCellState() === "learnt" ? "bg-emerald-400 border-zinc-900" : "bg-white border-zinc-300 hover:bg-zinc-50"}`}
          />
        </div>
      </section>

      {/* Grammar */}
      {day.grammar.length > 0 && (
        <section>
          <div className="text-[9px] font-black uppercase tracking-widest text-zinc-400 mb-1">
            Grammar <span className="ml-1 text-zinc-300">{day.grammar.length}</span>
          </div>
          <div className="grid grid-cols-8 gap-1">
            {day.grammar.map((point, i) => (
              <button
                key={point.id}
                onClick={() => onNavigate("grammar", i)}
                title={point.title}
                aria-label={point.title}
                className={cellClass(grammarCellState(point, i))}
              />
            ))}
          </div>
        </section>
      )}

      {/* Vocab */}
      {vocabQueue.length > 0 && (
        <section>
          <div className="text-[9px] font-black uppercase tracking-widest text-zinc-400 mb-1">
            Vocab <span className="ml-1 text-zinc-300">{vocabQueue.length}</span>
          </div>
          <div className="grid grid-cols-8 gap-1">
            {vocabQueue.map((entry, i) => (
              <button
                key={entry.id}
                onClick={() => onNavigate("vocab", i)}
                title={`${entry.word} · ${entry.meaning}`}
                aria-label={entry.word}
                className={cellClass(vocabCellState(entry, i))}
              />
            ))}
          </div>
        </section>
      )}

      {/* Kanji */}
      {kanjiQueue.length > 0 && (
        <section>
          <div className="text-[9px] font-black uppercase tracking-widest text-zinc-400 mb-1">
            Kanji <span className="ml-1 text-zinc-300">{kanjiQueue.length}</span>
          </div>
          <div className="grid grid-cols-8 gap-1">
            {kanjiQueue.map((entry, i) => (
              <button
                key={entry.kanji}
                onClick={() => onNavigate("kanji", i)}
                title={`${entry.kanji} · ${entry.meaning}`}
                aria-label={`${entry.kanji} ${entry.meaning}`}
                className={cellClass(kanjiCellState(entry as { kanji: string; id: string }, i))}
              />
            ))}
          </div>
        </section>
      )}

      {/* Produce */}
      <section>
        <div className="text-[9px] font-black uppercase tracking-widest text-zinc-400 mb-1">Produce</div>
        <div className="grid grid-cols-8 gap-1">
          <button
            onClick={() => onNavigate("produce")}
            title="Production practice"
            className={`col-span-8 h-5 rounded-md border-2 cursor-pointer transition-colors ${produceCellState() === "current" ? "bg-indigo-600 border-zinc-900" : produceCellState() === "learnt" ? "bg-emerald-400 border-zinc-900" : "bg-white border-zinc-300 hover:bg-zinc-50"}`}
          />
        </div>
      </section>

      {/* Done */}
      <section>
        <div className="text-[9px] font-black uppercase tracking-widest text-zinc-400 mb-1">Done</div>
        <div className="grid grid-cols-8 gap-1">
          <button
            onClick={() => onNavigate("done")}
            title="Day completion"
            className={`col-span-8 h-5 rounded-md border-2 cursor-pointer transition-colors ${doneCellState() === "current" ? "bg-indigo-600 border-zinc-900" : doneCellState() === "learnt" ? "bg-emerald-400 border-zinc-900" : "bg-white border-zinc-300 hover:bg-zinc-50"}`}
          />
        </div>
      </section>
    </div>
  );
};

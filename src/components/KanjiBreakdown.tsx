import React, { useEffect, useMemo, useState } from "react";
import { ChevronLeft, Puzzle, X } from "lucide-react";
import { motion } from "motion/react";
import { n5Course } from "../content/n5/raw";
import { componentMeaning, getKanjiInsight, getKanjiParts, hasKanjiInsight, isKanjiChar } from "../utils/kanji-insights";

/**
 * KanjiBreakdownModal — pop-up card that decomposes a kanji into its
 * components, shows each component's meaning, how they combine, and the
 * RRTK/Heisig mnemonic story. Components with their own entry are tappable
 * for recursive drill-down.
 */
export const KanjiBreakdownModal: React.FC<{ char: string; onClose: () => void }> = ({ char, onClose }) => {
  const [stack, setStack] = useState<string[]>([char]);
  const current = stack[stack.length - 1];
  const insight = getKanjiInsight(current);
  const parts = useMemo(() => getKanjiParts(current), [current]);
  const courseEntry = n5Course.kanji[current];

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      } else if ([" ", "Enter", "1", "2", "3", "4"].includes(event.key)) {
        // keep review-stage hotkeys from firing underneath the modal
        event.stopPropagation();
      }
    }
    window.addEventListener("keydown", handleKey, true);
    return () => window.removeEventListener("keydown", handleKey, true);
  }, [onClose]);

  if (!insight) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6" role="dialog" aria-modal="true" aria-label={`Kanji breakdown for ${current}`}>
      <div className="absolute inset-0 bg-zinc-950/50" onClick={onClose} />
      <motion.div
        key={current}
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.16 }}
        className="relative w-full sm:max-w-lg max-h-[88vh] overflow-y-auto bg-white border-2 border-zinc-900 rounded-t-[28px] sm:rounded-[28px] shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] p-5"
      >
        <div className="flex items-center justify-between gap-2">
          {stack.length > 1 ? (
            <button onClick={() => setStack((prev) => prev.slice(0, -1))} className="flex items-center gap-1 text-[10px] font-black uppercase text-zinc-500 hover:text-zinc-950">
              <ChevronLeft className="h-4 w-4" /> {stack[stack.length - 2]}
            </button>
          ) : (
            <span className="flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-indigo-600">
              <Puzzle className="h-3.5 w-3.5" /> Kanji breakdown
            </span>
          )}
          <button onClick={onClose} aria-label="Close breakdown" className="text-zinc-400 hover:text-zinc-900">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-3 text-center">
          <div className="text-7xl font-black text-zinc-950 leading-none">{current}</div>
          <div className="mt-2 text-lg font-black text-indigo-700">{insight.keyword}</div>
          {courseEntry?.readings ? <div className="mt-1 text-sm font-black text-zinc-600">{courseEntry.readings}</div> : null}
          {courseEntry && courseEntry.meaning !== insight.keyword ? (
            <div className="mt-1 text-xs font-bold uppercase tracking-wide text-zinc-400">In course: {courseEntry.meaning}</div>
          ) : null}
        </div>

        {parts.length > 0 ? (
          <div className="mt-4">
            <span className="block text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-2">Components</span>
            <div className="grid grid-cols-2 gap-2">
              {parts.map((part, index) => (
                <button
                  key={`${part.char}-${index}`}
                  disabled={!part.drillable}
                  onClick={() => part.drillable && setStack((prev) => [...prev, part.char])}
                  className={`flex items-center gap-3 rounded-2xl border-2 p-3 text-left ${part.drillable ? "border-zinc-900 bg-white hover:bg-indigo-50" : "border-zinc-200 bg-zinc-50 cursor-default"}`}
                >
                  <span className="text-3xl font-black text-zinc-950 leading-none">{part.char}</span>
                  <span className="text-[11px] font-bold text-zinc-600 leading-tight">{part.meaning}</span>
                </button>
              ))}
            </div>
            <div className="mt-3 bg-indigo-50 border-2 border-indigo-200 rounded-2xl p-3 text-sm font-black text-zinc-900 text-center">
              {parts.map((part) => `${part.char} (${part.meaning.split(" / ")[0]})`).join(" + ")} → {current} ({insight.keyword})
            </div>
          </div>
        ) : (
          <p className="mt-4 text-center text-xs font-bold text-zinc-500">This kanji is its own building block — learn its shape directly.</p>
        )}

        {insight.story ? (
          <div className="mt-4 bg-emerald-50 border-2 border-emerald-200 rounded-2xl p-4">
            <span className="block text-[10px] font-black uppercase tracking-widest text-emerald-700 mb-2">Mnemonic</span>
            <p className="text-sm font-bold text-zinc-900 whitespace-pre-wrap">{insight.story}</p>
          </div>
        ) : null}

        {parts.some((part) => part.drillable) ? (
          <p className="mt-3 text-center text-[10px] font-bold text-zinc-400">Tap a component to break it down further.</p>
        ) : null}
      </motion.div>
    </div>
  );
};

/**
 * KanjiComponentsInline — component chips shown directly on the kanji course
 * card, so the decomposition is visible without opening anything. Tapping a
 * chip opens the breakdown modal for that component (or the kanji itself).
 */
export const KanjiComponentsInline: React.FC<{ char: string; onOpen: (char: string) => void; fallbackText?: string }> = ({ char, onOpen, fallbackText }) => {
  const parts = getKanjiParts(char);
  const insight = getKanjiInsight(char);
  if (!insight || parts.length === 0) {
    if (!fallbackText) return null;
    return (
      <div className="bg-zinc-50 border-2 border-zinc-200 rounded-2xl p-4">
        <span className="block text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-1">Components</span>
        <p className="text-sm font-bold text-zinc-900 whitespace-pre-wrap">{fallbackText}</p>
      </div>
    );
  }
  return (
    <div className="bg-violet-50 border-2 border-violet-200 rounded-2xl p-4">
      <span className="block text-[10px] font-black uppercase tracking-widest text-violet-700 mb-2">Components</span>
      <div className="flex flex-wrap items-center gap-2">
        {parts.map((part, index) => (
          <React.Fragment key={`${part.char}-${index}`}>
            {index > 0 && <span className="text-sm font-black text-violet-400">+</span>}
            <button
              disabled={!part.drillable}
              onClick={() => part.drillable && onOpen(part.char)}
              className={`flex items-center gap-2 rounded-xl border-2 px-2.5 py-1.5 ${part.drillable ? "border-zinc-900 bg-white hover:bg-violet-100" : "border-violet-200 bg-white/60 cursor-default"}`}
            >
              <span className="text-xl font-black text-zinc-950 leading-none">{part.char}</span>
              <span className="text-[10px] font-bold text-zinc-600 leading-tight max-w-[90px]">{part.meaning.split(" / ")[0]}</span>
            </button>
          </React.Fragment>
        ))}
        <span className="text-sm font-black text-violet-400">→</span>
        <span className="text-sm font-black text-zinc-900">{char} ({insight.keyword})</span>
      </div>
    </div>
  );
};

/**
 * WordKanjiStrip — under a vocab word, one chip per kanji showing its meaning,
 * so the learner sees how the kanji combine into the word. Tapping a chip
 * opens the full breakdown.
 */
export const WordKanjiStrip: React.FC<{ word: string }> = ({ word }) => {
  const [openChar, setOpenChar] = useState<string | null>(null);
  const chars = Array.from(new Set(Array.from<string>(word).filter((char) => isKanjiChar(char) && hasKanjiInsight(char))));
  if (chars.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      <Puzzle className="h-3.5 w-3.5 text-violet-500" aria-hidden />
      {chars.map((char) => (
        <button
          key={char}
          onClick={() => setOpenChar(char)}
          aria-label={`Break down ${char}`}
          className="flex items-center gap-1.5 rounded-xl border-2 border-zinc-900 bg-violet-50 hover:bg-violet-100 px-2.5 py-1"
        >
          <span className="text-lg font-black text-zinc-950 leading-none">{char}</span>
          <span className="text-[10px] font-bold text-zinc-600">{componentMeaning(char).split(" / ")[0]}</span>
        </button>
      ))}
      {openChar ? <KanjiBreakdownModal char={openChar} onClose={() => setOpenChar(null)} /> : null}
    </div>
  );
};

/**
 * KanjiText — renders a string where every kanji that has breakdown data is
 * tappable and opens the breakdown modal. Drop-in replacement for plain text.
 */
export const KanjiText: React.FC<{ text: string; className?: string }> = ({ text, className }) => {
  const [openChar, setOpenChar] = useState<string | null>(null);
  return (
    <span className={className}>
      {Array.from<string>(text).map((char, index) =>
        isKanjiChar(char) && hasKanjiInsight(char) ? (
          <button
            key={index}
            onClick={() => setOpenChar(char)}
            aria-label={`Break down ${char} (${componentMeaning(char)})`}
            className="inline rounded-sm underline decoration-dotted decoration-indigo-300 underline-offset-4 hover:text-indigo-700 hover:decoration-indigo-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
          >
            {char}
          </button>
        ) : (
          <span key={index}>{char}</span>
        )
      )}
      {openChar ? <KanjiBreakdownModal char={openChar} onClose={() => setOpenChar(null)} /> : null}
    </span>
  );
};

export default KanjiBreakdownModal;

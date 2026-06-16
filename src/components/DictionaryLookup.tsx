import React, { useEffect, useMemo, useRef, useState } from "react";
import { Search, X, Volume2, Plus, Check, Loader2 } from "lucide-react";
import { motion } from "motion/react";
import { sound } from "../utils/audio";
import {
  loadDictionary,
  searchWords,
  posLabel,
  type SearchResult,
} from "../utils/dict";
import {
  getKanjiInsight,
  hasKanjiInsight,
  isKanjiChar,
  loadExtendedKanjiInsights,
} from "../utils/kanji-insights";
import { KanjiText, WordKanjiStrip } from "./KanjiBreakdown";
import { n5Course } from "../content/n5/raw";
import { mirrorLookupItemToCourse } from "../utils/n5-course";
import {
  addLookupCard,
  lookupCardId,
  type LookupCardKind,
  type NewLookupInput,
} from "../utils/lookup-deck";

/**
 * DictionaryLookup — global search overlay. Search any Japanese word (kanji,
 * kana, romaji) or English meaning; see the meaning, reading, recursive kanji
 * breakdown + RTK mnemonics (same rendering as the N5 course) and an example
 * sentence; play TTS audio; and add the word (or an individual kanji) to the
 * dedicated lookup SRS deck.
 */
export const DictionaryLookup: React.FC<{
  open: boolean;
  onClose: () => void;
  onDeckChange?: () => void;
}> = ({ open, onClose, onDeckChange }) => {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selected, setSelected] = useState<SearchResult | null>(null);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState(false);
  // ids already in the deck this session, for the "Added ✓" state
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());
  // ids that were also mirrored into the N5 course, for a "↳ also in course" note
  const [courseIds, setCourseIds] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);

  // Lazy-load the dictionary + the full-RTK kanji insights the first time the
  // overlay opens. The kanji load makes hasKanjiInsight() true for non-N5 kanji,
  // so the breakdown strip lights up after `ready` flips and we re-render.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoadError(false);
    Promise.all([loadDictionary(), loadExtendedKanjiInsights().catch(() => {})])
      .then(() => {
        if (!cancelled) setReady(true);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 60);
      return () => clearTimeout(t);
    }
  }, [open]);

  // Debounced search.
  useEffect(() => {
    if (!ready) return;
    const handle = setTimeout(() => {
      const found = searchWords(query, 40);
      setResults(found);
      setSelected((prev) => {
        if (prev && found.some((r) => r.id === prev.id)) return prev;
        return found[0] || null;
      });
    }, 130);
    return () => clearTimeout(handle);
  }, [query, ready]);

  // Escape closes the overlay.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  async function handleAdd(input: NewLookupInput) {
    const result = await addLookupCard(input);
    setAddedIds((prev) => new Set(prev).add(result.card.id));
    // Mirror into the N5 course too, if the course teaches this item.
    try {
      const inCourse = await mirrorLookupItemToCourse(n5Course, input.kind, input.word, input.reading);
      if (inCourse) setCourseIds((prev) => new Set(prev).add(result.card.id));
    } catch (err) {
      console.warn("course mirror failed", err);
    }
    onDeckChange?.();
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center p-0 sm:p-6" role="dialog" aria-modal="true" aria-label="Dictionary lookup">
      <div className="absolute inset-0 bg-zinc-950/50" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.16 }}
        className="relative w-full sm:max-w-3xl h-full sm:h-auto sm:max-h-[88vh] flex flex-col bg-white sm:border-2 sm:border-zinc-900 sm:rounded-[28px] sm:shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] overflow-hidden"
      >
        {/* Search bar */}
        <div className="flex items-center gap-2 p-3 border-b-2 border-zinc-900">
          <Search className="h-5 w-5 text-zinc-400 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search word, kanji, romaji, or English…"
            className="flex-1 bg-transparent text-base font-bold text-zinc-900 placeholder:text-zinc-400 focus:outline-none"
          />
          <button onClick={onClose} aria-label="Close" className="text-zinc-400 hover:text-zinc-900 shrink-0">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 min-h-0 flex flex-col sm:flex-row overflow-hidden">
          {/* Results list */}
          <div className="sm:w-2/5 sm:border-r-2 sm:border-zinc-200 overflow-y-auto max-h-[40vh] sm:max-h-none shrink-0">
            {loadError ? (
              <p className="p-4 text-sm font-bold text-rose-600">Couldn't load the dictionary. Check your connection and try again.</p>
            ) : !ready ? (
              <p className="p-4 text-sm font-bold text-zinc-400 flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading dictionary…</p>
            ) : query.trim() === "" ? (
              <p className="p-4 text-sm font-bold text-zinc-400">Type to search the dictionary.</p>
            ) : results.length === 0 ? (
              <p className="p-4 text-sm font-bold text-zinc-400">No matches for “{query}”.</p>
            ) : (
              <ul>
                {results.map((r) => {
                  const head = r.k[0] || r.r[0];
                  const isActive = selected?.id === r.id;
                  return (
                    <li key={r.id}>
                      <button
                        onClick={() => setSelected(r)}
                        className={`w-full text-left px-4 py-2.5 border-b border-zinc-100 ${isActive ? "bg-indigo-50" : "hover:bg-zinc-50"}`}
                      >
                        <span className="text-lg font-black text-zinc-950">{head}</span>
                        {r.k[0] && r.r[0] && r.k[0] !== r.r[0] ? (
                          <span className="ml-2 text-xs font-bold text-indigo-600">{r.r[0]}</span>
                        ) : null}
                        <span className="block text-[11px] font-bold text-zinc-500 truncate">{r.s[0]?.g.join(", ")}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Detail */}
          <div className="flex-1 overflow-y-auto p-5">
            {selected ? (
              <ResultDetail
                key={selected.id}
                entry={selected}
                addedIds={addedIds}
                courseIds={courseIds}
                onAdd={handleAdd}
              />
            ) : ready && query.trim() !== "" && results.length === 0 ? null : (
              <p className="text-sm font-bold text-zinc-400">Select a result to see its breakdown.</p>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
};

const SpeakButton: React.FC<{ text: string; label?: string }> = ({ text, label }) => (
  <button
    onClick={() => sound.playCharacter(text)}
    aria-label={label || `Play ${text}`}
    className="inline-flex items-center justify-center rounded-xl border-2 border-zinc-900 bg-white hover:bg-indigo-50 p-1.5 shrink-0"
  >
    <Volume2 className="h-4 w-4 text-indigo-600" />
  </button>
);

const ResultDetail: React.FC<{
  entry: SearchResult;
  addedIds: Set<string>;
  courseIds: Set<string>;
  onAdd: (input: NewLookupInput) => void;
}> = ({ entry, addedIds, courseIds, onAdd }) => {
  const word = entry.k[0] || entry.r[0];
  const reading = entry.r[0] || "";
  const meanings = entry.s.flatMap((s) => s.g);
  const wordKind: LookupCardKind = Array.from(word).length === 1 && isKanjiChar(word) ? "kanji" : "vocab";
  const wordId = lookupCardId(wordKind, word, reading);
  const wordAdded = addedIds.has(wordId);

  // Distinct kanji in the word that we can add individually as kanji cards.
  const kanji = useMemo(
    () => Array.from(new Set(Array.from<string>(word).filter((c) => isKanjiChar(c) && hasKanjiInsight(c)))),
    [word]
  );

  return (
    <div className="space-y-5">
      <div className="text-center space-y-2">
        <div className="text-5xl sm:text-6xl font-black text-zinc-950 flex items-center justify-center gap-3">
          <KanjiText text={word} />
          <SpeakButton text={word} />
        </div>
        {reading && reading !== word ? (
          <div className="text-lg font-black text-indigo-700">{reading}</div>
        ) : null}
      </div>

      {/* Senses */}
      <div className="space-y-2">
        {entry.s.map((sense, i) => (
          <div key={i} className="bg-zinc-50 border-2 border-zinc-200 rounded-2xl p-3">
            {sense.pos.length > 0 ? (
              <span className="block text-[10px] font-black uppercase tracking-wide text-zinc-400 mb-1">
                {sense.pos.map(posLabel).join(" · ")}
              </span>
            ) : null}
            <p className="text-sm font-bold text-zinc-900">{sense.g.join("; ")}</p>
          </div>
        ))}
      </div>

      {/* Recursive kanji breakdown (same component as the N5 course) */}
      <WordKanjiStrip word={word} />

      {/* Example sentence */}
      {entry.ex ? (
        <div className="bg-indigo-50 border-2 border-indigo-200 rounded-2xl p-4 space-y-1">
          <div className="flex items-start gap-2">
            <div className="text-base font-black text-zinc-950 flex-1">
              <KanjiText text={entry.ex.j} />
            </div>
            <SpeakButton text={entry.ex.j} label="Play example" />
          </div>
          <p className="text-xs font-bold text-zinc-500">{entry.ex.e}</p>
        </div>
      ) : null}

      {/* Add to deck */}
      <div className="space-y-2 pt-1">
        <button
          onClick={() => onAdd({ kind: wordKind, word, reading, meanings, example: entry.ex })}
          disabled={wordAdded}
          className={`w-full flex items-center justify-center gap-2 rounded-2xl border-2 border-zinc-900 py-3 text-sm font-black uppercase tracking-wide ${
            wordAdded
              ? "bg-emerald-100 text-emerald-700 cursor-default"
              : "bg-indigo-600 text-white hover:bg-indigo-500 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]"
          }`}
        >
          {wordAdded ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {wordAdded ? "Added to deck" : "Add to my deck"}
        </button>
        {wordAdded && courseIds.has(wordId) ? (
          <p className="text-[11px] font-bold text-emerald-600 text-center">↳ also added to your N5 course review</p>
        ) : null}

        {kanji.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Add kanji:</span>
            {kanji.map((char) => {
              const insight = getKanjiInsight(char);
              const kReading = insight?.readings || "";
              const id = lookupCardId("kanji", char, kReading);
              const added = addedIds.has(id);
              return (
                <button
                  key={char}
                  onClick={() =>
                    onAdd({ kind: "kanji", word: char, reading: kReading, meanings: insight?.keyword ? [insight.keyword] : [] })
                  }
                  disabled={added}
                  className={`flex items-center gap-1.5 rounded-xl border-2 px-2.5 py-1 text-sm font-black ${
                    added ? "border-emerald-300 bg-emerald-50 text-emerald-700 cursor-default" : "border-zinc-900 bg-white hover:bg-indigo-50"
                  }`}
                >
                  {added ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                  <span className="text-base">{char}</span>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default DictionaryLookup;

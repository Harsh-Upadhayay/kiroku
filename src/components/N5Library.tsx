import React, { useMemo, useState } from "react";
import { BookOpen, ChevronLeft, Search } from "lucide-react";
import { motion } from "motion/react";
import { State } from "ts-fsrs";
import { n5Course } from "../content/n5/raw";
import {
  cardIdForKanji,
  cardIdForVocab,
  formatN5Due,
  isN5CardDue,
  type N5CourseProgress,
  type N5SRSCard,
} from "../utils/n5-course";
import { KanjiBreakdownModal, KanjiText } from "./KanjiBreakdown";
import { hasKanjiInsight } from "../utils/kanji-insights";

type ItemStatus = "new" | "learning" | "due" | "mastered";

const STATUS_META: Record<ItemStatus, { label: string; chip: string }> = {
  new: { label: "Not started", chip: "bg-zinc-100 text-zinc-500 border-zinc-300" },
  learning: { label: "Learning", chip: "bg-indigo-50 text-indigo-700 border-indigo-200" },
  due: { label: "Due now", chip: "bg-amber-50 text-amber-800 border-amber-300" },
  mastered: { label: "Mastered", chip: "bg-emerald-50 text-emerald-700 border-emerald-300" },
};

const FILTERS: Array<{ id: "all" | ItemStatus; label: string }> = [
  { id: "all", label: "All" },
  { id: "due", label: "Due" },
  { id: "learning", label: "Learning" },
  { id: "mastered", label: "Mastered" },
  { id: "new", label: "Not started" },
];

function itemStatus(card: N5SRSCard | undefined, learned: boolean): ItemStatus {
  if (!card && !learned) return "new";
  if (!card) return "learning";
  if (isN5CardDue(card)) return "due";
  // Anki's "mature" threshold: scheduled at 21+ days in review state
  if (card.state === State.Review && card.scheduled_days >= 21) return "mastered";
  return "learning";
}

function statusCounts(statuses: ItemStatus[]): Record<ItemStatus, number> {
  const counts: Record<ItemStatus, number> = { new: 0, learning: 0, due: 0, mastered: 0 };
  statuses.forEach((status) => { counts[status] += 1; });
  return counts;
}

const LibraryShell: React.FC<{
  eyebrow: string;
  title: string;
  subtitle: string;
  counts: Record<ItemStatus, number>;
  total: number;
  filter: "all" | ItemStatus;
  setFilter: (filter: "all" | ItemStatus) => void;
  query: string;
  setQuery: (query: string) => void;
  searchPlaceholder: string;
  onBack: () => void;
  children: React.ReactNode;
}> = ({ eyebrow, title, subtitle, counts, total, filter, setFilter, query, setQuery, searchPlaceholder, onBack, children }) => {
  const learned = total - counts.new;
  return (
    <div className="bg-white border-2 border-zinc-900 rounded-[28px] p-4 sm:p-5 shadow-[5px_5px_0px_0px_rgba(0,0,0,1)] space-y-4">
      <button onClick={onBack} className="text-xs font-black uppercase text-zinc-500 hover:text-zinc-950 flex items-center gap-1">
        <ChevronLeft className="h-4 w-4" /> Course Home
      </button>
      <div>
        <span className="text-[10px] font-black uppercase tracking-widest text-indigo-600">{eyebrow}</span>
        <h2 className="text-2xl sm:text-3xl font-black text-zinc-950 mt-1">{title}</h2>
        <p className="mt-1 text-sm font-bold text-zinc-500">{subtitle}</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <StatTile label="Learned" value={`${learned} / ${total}`} accent="text-indigo-700" />
        <StatTile label="Due now" value={String(counts.due)} accent={counts.due > 0 ? "text-amber-700" : "text-zinc-400"} />
        <StatTile label="Learning" value={String(counts.learning)} accent="text-zinc-800" />
        <StatTile label="Mastered" value={String(counts.mastered)} accent="text-emerald-700" />
      </div>
      <div className="h-2 bg-zinc-100 rounded-full overflow-hidden flex" aria-label="Progress breakdown">
        <div className="h-full bg-emerald-500" style={{ width: `${(counts.mastered / Math.max(1, total)) * 100}%` }} />
        <div className="h-full bg-indigo-500" style={{ width: `${(counts.learning / Math.max(1, total)) * 100}%` }} />
        <div className="h-full bg-amber-400" style={{ width: `${(counts.due / Math.max(1, total)) * 100}%` }} />
      </div>

      <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={searchPlaceholder}
            className="w-full bg-white border-2 border-zinc-900 rounded-xl py-2 pl-9 pr-3 text-sm font-bold focus:outline-none placeholder:text-zinc-300"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((option) => (
            <button
              key={option.id}
              onClick={() => setFilter(option.id)}
              className={`px-3 py-1.5 rounded-xl border-2 text-[10px] font-black uppercase tracking-wider transition-colors ${
                filter === option.id ? "bg-zinc-900 text-white border-zinc-900" : "bg-white text-zinc-500 border-zinc-200 hover:border-zinc-400"
              }`}
            >
              {option.label}
              {option.id !== "all" ? <span className="opacity-60 ml-1">{counts[option.id]}</span> : null}
            </button>
          ))}
        </div>
      </div>

      {children}
    </div>
  );
};

const StatTile: React.FC<{ label: string; value: string; accent: string }> = ({ label, value, accent }) => (
  <div className="bg-zinc-50 border-2 border-zinc-200 rounded-2xl px-3 py-2.5">
    <span className="block text-[9px] font-black uppercase tracking-widest text-zinc-400">{label}</span>
    <span className={`block text-lg font-black mt-0.5 ${accent}`}>{value}</span>
  </div>
);

const StatusChip: React.FC<{ status: ItemStatus; due?: string }> = ({ status, due }) => (
  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border-2 text-[9px] font-black uppercase tracking-wider ${STATUS_META[status].chip}`}>
    {STATUS_META[status].label}
    {status !== "new" && due ? <span className="opacity-60 normal-case">· {due}</span> : null}
  </span>
);

// ─── Kanji library ───────────────────────────────────────────────────────────

export const KanjiLibrary: React.FC<{
  progress: N5CourseProgress;
  cards: N5SRSCard[];
  onBack: () => void;
}> = ({ progress, cards, onBack }) => {
  const [filter, setFilter] = useState<"all" | ItemStatus>("all");
  const [query, setQuery] = useState("");
  const [breakdownChar, setBreakdownChar] = useState<string | null>(null);

  const cardById = useMemo(() => new Map(cards.map((card) => [card.id, card])), [cards]);
  const learnedSet = useMemo(() => new Set(progress.learnedKanjiIds), [progress.learnedKanjiIds]);

  const items = useMemo(() => {
    // kanjiList can contain alias entries (e.g. 話 listed at two course indices)
    const seen = new Set<string>();
    return n5Course.kanjiList
      .filter((entry) => !seen.has(entry.kanji) && (seen.add(entry.kanji), true))
      .map((entry) => {
        const card = cardById.get(cardIdForKanji(entry));
        return { entry, card, status: itemStatus(card, learnedSet.has(entry.kanji)) };
      });
  }, [cardById, learnedSet]);

  const counts = useMemo(() => statusCounts(items.map((item) => item.status)), [items]);

  const visible = items.filter(({ entry, status }) => {
    if (filter !== "all" && status !== filter) return false;
    if (!query.trim()) return true;
    const q = query.trim().toLowerCase();
    return entry.kanji.includes(q) || entry.meaning.toLowerCase().includes(q) || entry.readings.toLowerCase().includes(q);
  });

  return (
    <LibraryShell
      eyebrow="N5 Course"
      title="Kanji"
      subtitle={`All ${items.length} kanji taught in the 30-day course, with their review status. Tap a kanji to break it down.`}
      counts={counts}
      total={items.length}
      filter={filter}
      setFilter={setFilter}
      query={query}
      setQuery={setQuery}
      searchPlaceholder="Search kanji, meaning, or reading…"
      onBack={onBack}
    >
      {visible.length === 0 ? (
        <p className="text-center py-10 text-xs font-bold text-zinc-400">Nothing matches this filter.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {visible.map(({ entry, card, status }) => (
            <motion.button
              key={entry.kanji}
              layout
              onClick={() => hasKanjiInsight(entry.kanji) && setBreakdownChar(entry.kanji)}
              className="text-left rounded-2xl border-2 border-zinc-200 hover:border-zinc-900 bg-white p-3 transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-4xl font-black text-zinc-950 leading-none">{entry.kanji}</span>
                <span className="text-[9px] font-black text-zinc-300">#{entry.index}</span>
              </div>
              <div className="mt-2 text-xs font-black text-zinc-800 truncate">{entry.meaning}</div>
              <div className="text-[10px] font-bold text-indigo-700 truncate">{entry.readings}</div>
              <div className="mt-2">
                <StatusChip status={status} due={card ? formatN5Due(card.due) : undefined} />
              </div>
            </motion.button>
          ))}
        </div>
      )}
      {breakdownChar ? <KanjiBreakdownModal char={breakdownChar} onClose={() => setBreakdownChar(null)} /> : null}
    </LibraryShell>
  );
};

// ─── Vocab library ───────────────────────────────────────────────────────────

const VOCAB_PAGE_SIZE = 60;

export const VocabLibrary: React.FC<{
  progress: N5CourseProgress;
  cards: N5SRSCard[];
  onBack: () => void;
}> = ({ progress, cards, onBack }) => {
  const [filter, setFilter] = useState<"all" | ItemStatus>("all");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(VOCAB_PAGE_SIZE);

  const cardById = useMemo(() => new Map(cards.map((card) => [card.id, card])), [cards]);
  const learnedSet = useMemo(() => new Set(progress.learnedVocabIds), [progress.learnedVocabIds]);

  const items = useMemo(() => Object.values(n5Course.vocab)
    .sort((a, b) => a.number - b.number)
    .map((entry) => {
      const card = cardById.get(cardIdForVocab(entry));
      return { entry, card, status: itemStatus(card, learnedSet.has(entry.id)) };
    }), [cardById, learnedSet]);

  const counts = useMemo(() => statusCounts(items.map((item) => item.status)), [items]);

  const visible = items.filter(({ entry, status }) => {
    if (filter !== "all" && status !== filter) return false;
    if (!query.trim()) return true;
    const q = query.trim().toLowerCase();
    return entry.word.includes(q) || entry.reading.includes(q) || entry.romaji.toLowerCase().includes(q) || entry.meaning.toLowerCase().includes(q);
  });
  const shown = visible.slice(0, limit);

  return (
    <LibraryShell
      eyebrow="N5 Course"
      title="Vocabulary"
      subtitle={`All ${items.length} words in the course, with their review status. Kanji in every word are tappable.`}
      counts={counts}
      total={items.length}
      filter={filter}
      setFilter={setFilter}
      query={query}
      setQuery={(value) => { setQuery(value); setLimit(VOCAB_PAGE_SIZE); }}
      searchPlaceholder="Search word, reading, romaji, or meaning…"
      onBack={onBack}
    >
      {shown.length === 0 ? (
        <p className="text-center py-10 text-xs font-bold text-zinc-400">Nothing matches this filter.</p>
      ) : (
        <div className="divide-y-2 divide-zinc-100 border-2 border-zinc-200 rounded-2xl overflow-hidden">
          {shown.map(({ entry, card, status }) => (
            <div key={entry.id} className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-3 px-3 py-2.5 bg-white hover:bg-zinc-50 transition-colors">
              <span className="text-[9px] font-black text-zinc-300 w-8 shrink-0">#{entry.number}</span>
              <span className="text-lg font-black text-zinc-950 sm:w-32 shrink-0"><KanjiText text={entry.word} /></span>
              <span className="text-xs font-black text-indigo-700 sm:w-36 shrink-0 truncate">{entry.reading}{entry.romaji ? ` · ${entry.romaji}` : ""}</span>
              <span className="text-xs font-bold text-zinc-600 flex-1 truncate">{entry.type} · {entry.meaning}</span>
              <StatusChip status={status} due={card ? formatN5Due(card.due) : undefined} />
            </div>
          ))}
        </div>
      )}
      {visible.length > limit ? (
        <button
          onClick={() => setLimit((value) => value + VOCAB_PAGE_SIZE)}
          className="w-full py-2.5 rounded-2xl border-2 border-zinc-300 text-xs font-black uppercase text-zinc-500 hover:border-zinc-900 hover:text-zinc-900 transition-colors flex items-center justify-center gap-2"
        >
          <BookOpen className="h-4 w-4" /> Show {Math.min(VOCAB_PAGE_SIZE, visible.length - limit)} more ({visible.length - limit} left)
        </button>
      ) : null}
    </LibraryShell>
  );
};

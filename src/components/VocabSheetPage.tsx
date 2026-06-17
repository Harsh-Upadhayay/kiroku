import React, { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { BookMarked, Check, FileImage, Loader2, Play, Search, Trash2, Upload, X } from "lucide-react";
import { sound } from "../utils/audio";
import { loadExtendedKanjiInsights } from "../utils/kanji-insights";
import {
  addLookupCard,
  getDueLookupCards,
  getLookupCards,
  isLookupCardDue,
  lookupCardId,
  removeLookupCard,
  saveLookupCards,
  type LookupCard,
} from "../utils/lookup-deck";
import { enrichImportedRowsWithDictionary } from "../utils/vocab-dict-match";
import {
  createVocabSheet,
  getVocabSheets,
  saveVocabSheets,
  type ImportedVocabRow,
  type VocabSheet,
  type VocabSheetRow,
} from "../utils/vocab-sheets";
import { KanjiText } from "./KanjiBreakdown";
import { ReviewSession } from "./LookupReviewSession";
import { State } from "ts-fsrs";

type SegmentFilter = "all" | "words" | "kanji";

interface ImportResult {
  engine: string;
  rows: ImportedVocabRow[];
  warnings?: string[];
}

// A VocabSheetRow enriched with deck card info for SRS display
interface DisplayRow extends VocabSheetRow {
  rowKind: "vocab" | "kanji";
  deckCard?: LookupCard;
}

export const VocabSheetPage: React.FC<{
  onDeckChange?: () => void;
  onOpenSearch: () => void;
}> = ({ onDeckChange, onOpenSearch }) => {
  const [sheets, setSheets] = useState<VocabSheet[]>([]);
  const [deckCards, setDeckCards] = useState<LookupCard[]>([]);
  const [query, setQuery] = useState("");
  const [segment, setSegment] = useState<SegmentFilter>("all");
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [importReview, setImportReview] = useState<{ sheet: VocabSheet; previewURL: string } | null>(null);
  const [reviewing, setReviewing] = useState(false);

  useEffect(() => {
    loadExtendedKanjiInsights().catch(() => {});
    getVocabSheets().then(setSheets);
    refreshDeck();
  }, []);

  useEffect(() => {
    return () => {
      if (importReview) URL.revokeObjectURL(importReview.previewURL);
    };
  }, []);

  const deckById = useMemo(() => new Map(deckCards.map((c) => [c.id, c])), [deckCards]);

  const allRows = useMemo<DisplayRow[]>(() => {
    const sheetRows = sheets.flatMap((s) => s.rows);

    // Track sheet rows by their deck card ID to avoid duplicates
    const sheetCardIds = new Set(
      sheetRows
        .map((r) => (r.dictMatch ? lookupCardId("vocab", r.dictMatch.word, r.dictMatch.reading) : null))
        .filter(Boolean)
    );

    // Deck-only rows (not present in any sheet): both vocab + kanji
    const deckOnlyRows: DisplayRow[] = deckCards
      .filter((c) => !sheetCardIds.has(c.id))
      .map((c) => ({
        id: c.id,
        word: c.word,
        furigana: c.kind === "vocab" ? c.reading : "",
        romaji: "",
        meaning: c.meanings.join("; "),
        dictMatch: { id: c.id, word: c.word, reading: c.reading, meanings: c.meanings, example: c.example },
        addedToDeckAt: c.createdAt,
        updatedAt: c.updatedAt,
        rowKind: c.kind,
        deckCard: c,
      }));

    // OCR sheet rows enriched with their deck card if present
    const enrichedSheetRows: DisplayRow[] = sheetRows.map((r) => {
      const cardId = r.dictMatch ? lookupCardId("vocab", r.dictMatch.word, r.dictMatch.reading) : "";
      const deckCard = cardId ? deckById.get(cardId) : undefined;
      return { ...r, rowKind: "vocab" as const, deckCard };
    });

    return [...enrichedSheetRows, ...deckOnlyRows];
  }, [sheets, deckCards, deckById]);

  const dueCount = useMemo(() => getDueLookupCards(deckCards).length, [deckCards]);

  const visibleRows = useMemo(() => {
    let rows = allRows;
    if (segment === "words") rows = rows.filter((r) => r.rowKind === "vocab");
    if (segment === "kanji") rows = rows.filter((r) => r.rowKind === "kanji");
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) =>
      [row.word, row.furigana, row.romaji, row.meaning, row.dictMatch?.word, row.dictMatch?.reading, row.dictMatch?.meanings.join(" ")]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle)
    );
  }, [query, segment, allRows]);

  async function refreshDeck() {
    setDeckCards(await getLookupCards());
  }

  function notify(type: "success" | "error", text: string) {
    setNotice({ type, text });
    window.setTimeout(() => setNotice(null), 4200);
  }

  async function handleImport(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    sound.playTick();
    setImporting(true);
    setNotice(null);
    try {
      const formData = new FormData();
      formData.append("image", file);
      const response = await fetch("/api/vocab/import-image", { method: "POST", body: formData });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || `Import failed with HTTP ${response.status}`);
      }
      const result = payload.data as ImportResult;
      const rows = await enrichImportedRowsWithDictionary(result.rows || []);
      const sheet = createVocabSheet(file.name, rows);
      if (sheet.rows.length === 0) throw new Error("No vocabulary rows found in image.");
      if (importReview) URL.revokeObjectURL(importReview.previewURL);
      setImportReview({ sheet, previewURL: URL.createObjectURL(file) });
      notify("success", `Found ${sheet.rows.length} row${sheet.rows.length === 1 ? "" : "s"} with ${result.engine}.`);
      if (result.warnings?.length) console.warn("Vocabulary OCR warnings", result.warnings);
    } catch (error: any) {
      sound.playIncorrect();
      notify("error", error?.message || "Vocabulary import failed.");
    } finally {
      setImporting(false);
      event.target.value = "";
    }
  }

  async function handleConfirmImport(sheet: VocabSheet, selectedRowIds: Set<string>) {
    const rowsToSave = sheet.rows.filter((r) => selectedRowIds.has(r.id));
    const finalSheet = { ...sheet, rows: rowsToSave };
    const nextSheets = [finalSheet, ...sheets];
    setSheets(nextSheets);
    await saveVocabSheets(nextSheets);

    const targets = rowsToSave.filter((r) => r.dictMatch?.word && r.dictMatch?.reading);
    let added = 0;
    let existing = 0;
    for (const row of targets) {
      const match = row.dictMatch!;
      const result = await addLookupCard({ kind: "vocab", word: match.word, reading: match.reading, meanings: match.meanings, example: match.example });
      if (result.added) added += 1;
      else existing += 1;
    }
    await refreshDeck();
    onDeckChange?.();
    sound.playCorrect();
    if (importReview) URL.revokeObjectURL(importReview.previewURL);
    setImportReview(null);
    const skipped = rowsToSave.length - targets.length;
    notify("success", `${added} added${existing ? `, ${existing} already existed` : ""}${skipped ? `, ${skipped} unmatched skipped` : ""}.`);
  }

  function handleDiscardImport() {
    if (importReview) URL.revokeObjectURL(importReview.previewURL);
    setImportReview(null);
  }

  async function handleRemove(id: string) {
    const next = await removeLookupCard(id);
    setDeckCards(next);
    onDeckChange?.();
  }

  async function handleReviewDone(updated: LookupCard[]) {
    setDeckCards(updated);
    await saveLookupCards(updated);
    onDeckChange?.();
  }

  if (reviewing) {
    return (
      <ReviewSession
        cards={deckCards}
        onExit={() => setReviewing(false)}
        onCardsChange={handleReviewDone}
      />
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-2xl font-black uppercase tracking-tight text-zinc-900 flex items-center gap-2">
          <FileImage className="h-6 w-6 text-indigo-600" /> Vocab
          {allRows.length > 0 && (
            <span className="text-sm font-bold text-zinc-400 normal-case tracking-normal">
              {allRows.length} words{dueCount > 0 ? ` · ${dueCount} due` : ""}
            </span>
          )}
        </h2>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={onOpenSearch}
            className="flex items-center gap-2 rounded-2xl border-2 border-zinc-900 bg-white hover:bg-indigo-50 px-3 py-2 text-xs font-black uppercase tracking-wide shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
          >
            <Search className="h-4 w-4" /> Search
          </button>
          <label className={`flex items-center gap-2 rounded-2xl border-2 border-zinc-900 bg-white hover:bg-indigo-50 px-3 py-2 text-xs font-black uppercase tracking-wide shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] cursor-pointer ${importing ? "opacity-60 pointer-events-none" : ""}`}>
            {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {importing ? "Reading…" : "Import"}
            <input type="file" accept="image/*" className="hidden" onChange={handleImport} disabled={importing} />
          </label>
          <button
            onClick={() => setReviewing(true)}
            disabled={dueCount === 0}
            className={`flex items-center gap-2 rounded-2xl border-2 border-zinc-900 px-3 py-2 text-xs font-black uppercase tracking-wide ${
              dueCount === 0
                ? "bg-zinc-100 text-zinc-400 cursor-not-allowed"
                : "bg-indigo-600 text-white hover:bg-indigo-500 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
            }`}
          >
            <Play className="h-4 w-4" /> Review{dueCount > 0 ? ` ${dueCount}` : ""}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {notice ? (
          <motion.div
            initial={{ opacity: 0, y: -6, height: 0 }}
            animate={{ opacity: 1, y: 0, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className={`rounded-2xl border-2 px-3 py-2 text-xs font-bold overflow-hidden ${
              notice.type === "success" ? "bg-emerald-50 border-emerald-300 text-emerald-900" : "bg-red-50 border-red-300 text-red-900"
            }`}
          >
            {notice.text}
          </motion.div>
        ) : null}
      </AnimatePresence>

      {allRows.length === 0 ? (
        <div className="border-2 border-dashed border-zinc-300 rounded-[24px] p-10 text-center space-y-4">
          <div className="mx-auto w-14 h-14 rounded-2xl border-2 border-zinc-900 bg-indigo-50 flex items-center justify-center">
            <FileImage className="h-6 w-6 text-indigo-600" />
          </div>
          <p className="text-sm font-bold text-zinc-500">No vocabulary yet.</p>
          <div className="flex items-center justify-center gap-3 flex-wrap">
            <button
              onClick={onOpenSearch}
              className="inline-flex items-center gap-2 rounded-2xl border-2 border-zinc-900 bg-white hover:bg-indigo-50 px-4 py-2.5 text-xs font-black uppercase tracking-wide shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
            >
              <Search className="h-4 w-4" /> Search dictionary
            </button>
            <label className={`inline-flex items-center gap-2 rounded-2xl border-2 border-zinc-900 bg-indigo-600 text-white hover:bg-indigo-500 px-5 py-3 text-xs font-black uppercase tracking-wide shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] cursor-pointer ${importing ? "opacity-60 pointer-events-none" : ""}`}>
              {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {importing ? "Reading image..." : "Import image"}
              <input type="file" accept="image/*" className="hidden" onChange={handleImport} disabled={importing} />
            </label>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Filter row */}
          <div className="flex items-center gap-3 flex-wrap">
            {/* Segment pills */}
            <div className="flex bg-white rounded-2xl border-2 border-zinc-900 p-1 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
              {(["all", "words", "kanji"] as SegmentFilter[]).map((seg) => (
                <button
                  key={seg}
                  onClick={() => setSegment(seg)}
                  className={`relative px-3 py-1 text-[10px] font-black uppercase tracking-wider rounded-xl transition-colors ${
                    segment === seg ? "bg-indigo-600 text-white shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]" : "text-zinc-500 hover:text-zinc-900"
                  }`}
                >
                  {seg === "all" ? "All" : seg === "words" ? "語" : "字"}
                </button>
              ))}
            </div>
            {/* Text filter */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter"
                className="rounded-xl border-2 border-zinc-900 pl-9 pr-3 py-1.5 text-xs font-bold bg-white w-36"
              />
            </div>
          </div>

          {visibleRows.length === 0 ? (
            <div className="bg-zinc-50 border-2 border-dashed border-zinc-300 rounded-2xl p-6 text-center text-[10px] font-black uppercase tracking-wide text-zinc-400">
              No matching words.
            </div>
          ) : (
            <VocabReferenceTable rows={visibleRows} onRemove={handleRemove} />
          )}
        </div>
      )}

      <AnimatePresence>
        {importReview ? (
          <ImportReviewModal
            sheet={importReview.sheet}
            deckById={deckById}
            onConfirm={handleConfirmImport}
            onDiscard={handleDiscardImport}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
};

// ─── SRS status helpers ──────────────────────────────────────────────────────

function SrsStatusCell({ card }: { card?: LookupCard }) {
  if (!card) return <td className="w-16 px-3 py-2" />;

  if (isLookupCardDue(card)) {
    return (
      <td className="w-16 px-3 py-2">
        <span className="text-[9px] font-black uppercase tracking-wide text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-1.5 py-0.5 whitespace-nowrap">
          Due
        </span>
      </td>
    );
  }
  if (card.state === State.New) {
    return (
      <td className="w-16 px-3 py-2">
        <span className="text-[9px] font-black uppercase tracking-wide text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-lg px-1.5 py-0.5 whitespace-nowrap">
          New
        </span>
      </td>
    );
  }
  return (
    <td className="w-16 px-3 py-2">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" title="Scheduled" />
    </td>
  );
}

// ─── Compact reference table ─────────────────────────────────────────────────

const VocabReferenceTable: React.FC<{
  rows: DisplayRow[];
  onRemove: (id: string) => void;
}> = ({ rows, onRemove }) => (
  <div className="overflow-x-auto rounded-[24px] border-2 border-zinc-900 bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
    <table className="min-w-[640px] w-full border-collapse text-left">
      <thead className="bg-zinc-50 border-b-2 border-zinc-900">
        <tr className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
          <th className="w-16 px-3 py-2.5">SRS</th>
          <th className="w-52 px-4 py-2.5">Word</th>
          <th className="w-40 px-4 py-2.5">Reading</th>
          <th className="w-36 px-4 py-2.5">Romaji</th>
          <th className="px-4 py-2.5">English</th>
          <th className="w-10 px-2 py-2.5" />
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const match = row.dictMatch;
          const word = match?.word || row.word || "";
          const reading = row.furigana || match?.reading || "";
          const romaji = row.romaji || "";
          const english = row.meaning || match?.meanings.join("; ") || "";
          const isKanjiRow = row.rowKind === "kanji";

          return (
            <motion.tr
              key={row.id}
              initial={{ opacity: 0, y: 3 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.1 }}
              className="group align-middle border-b border-zinc-100 last:border-b-0 hover:bg-zinc-50/60 transition-colors"
            >
              <SrsStatusCell card={row.deckCard} />
              <td className="px-4 py-2">
                <div className="flex items-center gap-2">
                  {isKanjiRow && (
                    <span className="shrink-0 text-[9px] font-black text-zinc-400 bg-zinc-100 border border-zinc-200 rounded px-1 leading-tight">字</span>
                  )}
                  <div className="text-base font-black text-zinc-950 leading-tight">
                    <KanjiText text={word || " "} />
                  </div>
                </div>
              </td>
              <td className="px-4 py-2">
                <span className="text-xs font-bold text-indigo-700">{reading}</span>
              </td>
              <td className="px-4 py-2">
                <span className="text-xs font-bold text-zinc-400">{romaji}</span>
              </td>
              <td className="px-4 py-2">
                <span className="text-xs font-bold text-zinc-700 leading-snug">{english}</span>
              </td>
              <td className="px-2 py-2 text-right">
                {row.deckCard && (
                  <button
                    onClick={() => onRemove(row.deckCard!.id)}
                    aria-label={`Remove ${word}`}
                    className="opacity-0 group-hover:opacity-100 transition-opacity text-zinc-300 hover:text-rose-600"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </td>
            </motion.tr>
          );
        })}
      </tbody>
    </table>
  </div>
);

// ─── Import review modal ─────────────────────────────────────────────────────

const ImportReviewModal: React.FC<{
  sheet: VocabSheet;
  deckById: Map<string, LookupCard>;
  onConfirm: (sheet: VocabSheet, selectedRowIds: Set<string>) => Promise<void>;
  onDiscard: () => void;
}> = ({ sheet, deckById, onConfirm, onDiscard }) => {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(sheet.rows.filter((r) => r.dictMatch?.word && r.dictMatch?.reading).map((r) => r.id))
  );
  const [confirming, setConfirming] = useState(false);

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    const matchedIds = sheet.rows.filter((r) => r.dictMatch?.word && r.dictMatch?.reading).map((r) => r.id);
    const allSelected = matchedIds.length > 0 && matchedIds.every((id) => selected.has(id));
    setSelected(allSelected ? new Set() : new Set(matchedIds));
  }

  async function handleConfirm() {
    setConfirming(true);
    await onConfirm(sheet, selected);
    setConfirming(false);
  }

  const matchedCount = sheet.rows.filter((r) => r.dictMatch?.word && r.dictMatch?.reading).length;
  const selectedCount = sheet.rows.filter((r) => selected.has(r.id)).length;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onDiscard} />

      <motion.div
        initial={{ scale: 0.95, opacity: 0, y: 12 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 8 }}
        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
        className="relative z-10 w-full max-w-2xl bg-white border-2 border-zinc-900 rounded-[28px] shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] flex flex-col max-h-[90vh]"
      >
        <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3 border-b-2 border-zinc-100 shrink-0">
          <div>
            <h3 className="text-base font-black uppercase tracking-tight text-zinc-900">Review import</h3>
            <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 mt-0.5">
              {sheet.rows.length} detected · {matchedCount} matched
            </p>
          </div>
          <button
            onClick={onDiscard}
            className="rounded-xl border-2 border-zinc-200 bg-zinc-50 hover:bg-zinc-100 p-1.5 text-zinc-500"
            aria-label="Discard import"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-3 space-y-1">
          <div className="flex items-center justify-between mb-2">
            <button onClick={toggleAll} className="text-[10px] font-black uppercase tracking-widest text-zinc-400 hover:text-zinc-900">
              {matchedCount > 0 && matchedCount === selectedCount ? "Deselect all" : "Select all matched"}
            </button>
            <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400">{selectedCount} selected</span>
          </div>
          {sheet.rows.map((row) => {
            const match = row.dictMatch;
            const word = match?.word || row.word || "";
            const furigana = row.furigana || match?.reading || "";
            const english = row.meaning || match?.meanings.slice(0, 2).join("; ") || "";
            const hasMatch = !!(match?.word && match?.reading);
            const isSelected = selected.has(row.id);
            const lookupId = match ? lookupCardId("vocab", match.word, match.reading) : "";
            const inDeck = !!lookupId && deckById.has(lookupId);
            return (
              <div
                key={row.id}
                onClick={() => hasMatch && toggleRow(row.id)}
                className={`flex items-center gap-3 rounded-2xl border-2 px-3 py-2.5 transition-colors ${
                  hasMatch ? "cursor-pointer" : "opacity-50 cursor-default"
                } ${isSelected && hasMatch ? "bg-indigo-50 border-indigo-200" : "bg-white border-zinc-200 hover:bg-zinc-50"}`}
              >
                <div
                  className={`shrink-0 w-7 h-7 rounded-xl border-2 border-zinc-900 flex items-center justify-center ${
                    isSelected && hasMatch ? "bg-indigo-600 text-white" : "bg-white text-transparent"
                  }`}
                >
                  <Check className="h-3.5 w-3.5" />
                </div>
                <div className="min-w-0 flex-1 grid grid-cols-[auto_1fr_1fr] gap-x-4 items-baseline">
                  <span className="text-base font-black text-zinc-950">
                    <KanjiText text={word || " "} />
                  </span>
                  <span className="text-xs font-bold text-indigo-700 truncate">{furigana}</span>
                  <span className="text-xs font-bold text-zinc-500 truncate">{english}</span>
                </div>
                <div className="shrink-0 flex items-center gap-1.5">
                  {inDeck ? (
                    <span className="text-[10px] font-black uppercase tracking-wide text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-lg px-2 py-0.5">
                      In deck
                    </span>
                  ) : hasMatch ? (
                    <span className="text-[10px] font-black uppercase tracking-wide text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-lg px-2 py-0.5">
                      Matched
                    </span>
                  ) : (
                    <span className="text-[10px] font-black uppercase tracking-wide text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-2 py-0.5">
                      No match
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-between gap-3 px-5 py-4 border-t-2 border-zinc-100 shrink-0">
          <button
            onClick={onDiscard}
            className="flex items-center gap-2 rounded-2xl border-2 border-zinc-900 bg-white hover:bg-red-50 px-4 py-2.5 text-xs font-black uppercase tracking-wide text-zinc-700 hover:text-red-700 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
          >
            <Trash2 className="h-4 w-4" /> Discard
          </button>
          <button
            onClick={handleConfirm}
            disabled={selectedCount === 0 || confirming}
            className={`flex items-center gap-2 rounded-2xl border-2 border-zinc-900 px-5 py-2.5 text-xs font-black uppercase tracking-wide shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] ${
              selectedCount === 0 || confirming
                ? "bg-zinc-100 text-zinc-400 cursor-not-allowed"
                : "bg-indigo-600 text-white hover:bg-indigo-500"
            }`}
          >
            {confirming ? <Loader2 className="h-4 w-4 animate-spin" /> : <BookMarked className="h-4 w-4" />}
            Add {selectedCount > 0 ? selectedCount : ""} to deck
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
};

export default VocabSheetPage;

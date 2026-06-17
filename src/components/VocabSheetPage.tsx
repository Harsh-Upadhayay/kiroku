import React, { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { BookMarked, Check, FileImage, Loader2, Search, Trash2, Upload, X } from "lucide-react";
import { sound } from "../utils/audio";
import { loadExtendedKanjiInsights } from "../utils/kanji-insights";
import { addLookupCard, getLookupCards, lookupCardId, type LookupCard } from "../utils/lookup-deck";
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

interface ImportResult {
  engine: string;
  rows: ImportedVocabRow[];
  warnings?: string[];
}

export const VocabSheetPage: React.FC<{ onDeckChange?: () => void }> = ({ onDeckChange }) => {
  const [sheets, setSheets] = useState<VocabSheet[]>([]);
  const [deckCards, setDeckCards] = useState<LookupCard[]>([]);
  const [query, setQuery] = useState("");
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [importReview, setImportReview] = useState<{ sheet: VocabSheet; previewURL: string } | null>(null);

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

  const deckIds = useMemo(() => new Set(deckCards.map((c) => c.id)), [deckCards]);

  // Sheet rows (have romaji from OCR) merged with any vocab deck cards not already
  // represented in sheets (added via dictionary search).
  const allRows = useMemo<VocabSheetRow[]>(() => {
    const sheetRows = sheets.flatMap((s) => s.rows);
    const sheetCardIds = new Set(
      sheetRows.map((r) => (r.dictMatch ? lookupCardId("vocab", r.dictMatch.word, r.dictMatch.reading) : null)).filter(Boolean)
    );
    const deckOnlyRows: VocabSheetRow[] = deckCards
      .filter((c) => c.kind === "vocab" && !sheetCardIds.has(c.id))
      .map((c) => ({
        id: c.id,
        word: c.word,
        furigana: c.reading,
        romaji: "",
        meaning: c.meanings.join("; "),
        dictMatch: { id: c.id, word: c.word, reading: c.reading, meanings: c.meanings, example: c.example },
        addedToDeckAt: c.createdAt,
        updatedAt: c.updatedAt,
      }));
    return [...sheetRows, ...deckOnlyRows];
  }, [sheets, deckCards]);

  const visibleRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return allRows;
    return allRows.filter((row) =>
      [row.word, row.furigana, row.romaji, row.meaning, row.dictMatch?.word, row.dictMatch?.reading, row.dictMatch?.meanings.join(" ")]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle)
    );
  }, [query, allRows]);

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

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-2xl font-black uppercase tracking-tight text-zinc-900 flex items-center gap-2">
          <FileImage className="h-6 w-6 text-indigo-600" /> Vocab
          {allRows.length > 0 && (
            <span className="text-sm font-bold text-zinc-400 normal-case tracking-normal">{allRows.length} words</span>
          )}
        </h2>
        <label className={`flex items-center gap-2 rounded-2xl border-2 border-zinc-900 bg-white hover:bg-indigo-50 px-4 py-2 text-xs font-black uppercase tracking-wide shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] cursor-pointer ${importing ? "opacity-60 pointer-events-none" : ""}`}>
          {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          {importing ? "Reading image..." : "Import image"}
          <input type="file" accept="image/*" className="hidden" onChange={handleImport} disabled={importing} />
        </label>
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
          <p className="text-sm font-bold text-zinc-500">No vocabulary yet — import an image to get started.</p>
          <label className={`inline-flex items-center gap-2 rounded-2xl border-2 border-zinc-900 bg-indigo-600 text-white hover:bg-indigo-500 px-5 py-3 text-xs font-black uppercase tracking-wide shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] cursor-pointer ${importing ? "opacity-60 pointer-events-none" : ""}`}>
            {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {importing ? "Reading image..." : "Import image"}
            <input type="file" accept="image/*" className="hidden" onChange={handleImport} disabled={importing} />
          </label>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="relative max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter words"
              className="w-full rounded-xl border-2 border-zinc-900 pl-9 pr-3 py-2 text-xs font-bold bg-white"
            />
          </div>
          {visibleRows.length === 0 ? (
            <div className="bg-zinc-50 border-2 border-dashed border-zinc-300 rounded-2xl p-6 text-center text-[10px] font-black uppercase tracking-wide text-zinc-400">
              No matching words.
            </div>
          ) : (
            <VocabReferenceTable rows={visibleRows} deckIds={deckIds} />
          )}
        </div>
      )}

      <AnimatePresence>
        {importReview ? (
          <ImportReviewModal
            sheet={importReview.sheet}
            deckIds={deckIds}
            onConfirm={handleConfirmImport}
            onDiscard={handleDiscardImport}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
};

// ─── Compact read-only reference table ──────────────────────────────────────

const VocabReferenceTable: React.FC<{
  rows: VocabSheetRow[];
  deckIds: Set<string>;
}> = ({ rows, deckIds }) => (
    <div className="overflow-x-auto rounded-[24px] border-2 border-zinc-900 bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
      <table className="min-w-[640px] w-full border-collapse text-left">
        <thead className="bg-zinc-50 border-b-2 border-zinc-900">
          <tr className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
            <th className="w-52 px-4 py-2.5">Word</th>
            <th className="w-40 px-4 py-2.5">Furigana</th>
            <th className="w-36 px-4 py-2.5">Romaji</th>
            <th className="px-4 py-2.5">English</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
                const match = row.dictMatch;
                const word = match?.word || row.word || "";
                const furigana = row.furigana || match?.reading || "";
                const romaji = row.romaji || "";
                const english = row.meaning || match?.meanings.join("; ") || "";
                const lookupId = match ? lookupCardId("vocab", match.word, match.reading) : "";
                const inDeck = (!!lookupId && deckIds.has(lookupId)) || !!row.addedToDeckAt;
                return (
                  <motion.tr
                    key={row.id}
                    initial={{ opacity: 0, y: 3 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.1 }}
                    className="align-middle border-b border-zinc-100 last:border-b-0 hover:bg-zinc-50/60 transition-colors"
                  >
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        {inDeck ? (
                          <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-emerald-400" title="In deck" />
                        ) : (
                          <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-transparent" />
                        )}
                        <div className="text-base font-black text-zinc-950 leading-tight">
                          <KanjiText text={word || " "} />
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      <span className="text-xs font-bold text-indigo-700">{furigana}</span>
                    </td>
                    <td className="px-4 py-2">
                      <span className="text-xs font-bold text-zinc-500">{romaji}</span>
                    </td>
                    <td className="px-4 py-2">
                      <span className="text-xs font-bold text-zinc-700 leading-snug">{english}</span>
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
  deckIds: Set<string>;
  onConfirm: (sheet: VocabSheet, selectedRowIds: Set<string>) => Promise<void>;
  onDiscard: () => void;
}> = ({ sheet, deckIds, onConfirm, onDiscard }) => {
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
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onDiscard} />

      <motion.div
        initial={{ scale: 0.95, opacity: 0, y: 12 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 8 }}
        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
        className="relative z-10 w-full max-w-2xl bg-white border-2 border-zinc-900 rounded-[28px] shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] flex flex-col max-h-[90vh]"
      >
        {/* Header */}
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

        {/* Row list */}
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
            const inDeck = (!!lookupId && deckIds.has(lookupId)) || !!row.addedToDeckAt;
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

        {/* Footer actions */}
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

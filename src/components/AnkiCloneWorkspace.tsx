import React, { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Archive,
  BarChart3,
  Boxes,
  Cog,
  Download,
  Eye,
  FileAudio,
  FileImage,
  Filter,
  Flag,
  Layers,
  PauseCircle,
  Play,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  Upload,
  Volume2,
} from "lucide-react";
import {
  type AnkiCard,
  type AnkiCollection,
  type AnkiGrade,
  type CollectionIndex,
  buildCollectionIndex,
  buildMediaURLMap,
  resolveCardMedia,
  cardSearchText,
  defaultSchedulerPreset,
  emptyCollection,
  getAnkiCollection,
  gradeAnkiCard,
  importAnkiPackage,
  isV3CardDue,
  firstDeckWithCards,
  orderCardsForStudy,
  previewFSRS,
  renderAnkiCard,
  saveAnkiCard,
  appendAnkiReviewLog,
  markAnkiCardsDeleted,
  saveAnkiCollection,
  sanitizeTemplateHTML,
  stripHTML,
  type PendingMediaTransfer,
} from "../utils/anki-v3";
import { getCurrentUser } from "../utils/auth";
import { sound } from "../utils/audio";
import { MediaTransferPanel } from "./MediaTransferPanel";
import { TabPanel } from "./TabPanel";

type WorkspaceTab = "decks" | "review" | "browser" | "editor" | "media" | "options" | "custom" | "stats";
type BrowserFilter = "all" | "due" | "new" | "learning" | "review" | "suspended" | "buried" | "flagged";

interface AnkiCloneWorkspaceProps {
  onChange?: () => void;
}

const gradeLabels: Record<AnkiGrade, string> = {
  1: "Again",
  2: "Hard",
  3: "Good",
  4: "Easy",
};

// Render long lists incrementally: only this many rows are mounted up front, growing as the
// user scrolls near the bottom. Keeps a 10k-card browser from putting thousands of nodes (each
// running renderAnkiCard) in the DOM at once.
const BROWSER_PAGE = 100;
const MEDIA_PAGE = 60;

// Append more rows once the scroll position is within this many px of the bottom.
const SCROLL_LOAD_THRESHOLD = 240;

// Matches kana, kanji and half-width katakana so we can speak the Japanese side
// of a card regardless of which template field holds it.
const JAPANESE_RE = /[぀-ヿ㐀-䶿一-鿿ｦ-ﾟ]/;

// Pick the most natural text to read aloud from a card: prefer the first side
// that actually contains Japanese, falling back to plain front text otherwise.
function pickSpeechText(...sides: (string | null | undefined)[]): string {
  let fallback = "";
  for (const side of sides) {
    const text = stripHTML(side || "");
    if (!text) continue;
    if (JAPANESE_RE.test(text)) return text;
    if (!fallback) fallback = text;
  }
  return fallback;
}

export const AnkiCloneWorkspace: React.FC<AnkiCloneWorkspaceProps> = ({ onChange }) => {
  const [collection, setCollection] = useState<AnkiCollection>(emptyCollection());
  const [selectedDeckId, setSelectedDeckId] = useState<string>("");
  const [selectedCardId, setSelectedCardId] = useState<string>("");
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("decks");
  const [browserQuery, setBrowserQuery] = useState("");
  const [browserFilter, setBrowserFilter] = useState<BrowserFilter>("all");
  const [reviewStartedAt, setReviewStartedAt] = useState(Date.now());
  const [isBackShown, setIsBackShown] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  // True until the first collection load settles, so the first visit shows a skeleton
  // instead of the "import a deck" empty state while IndexedDB is still being read.
  const [loading, setLoading] = useState(true);
  // Upload fraction (0–1) while a chunked import is in flight; null when idle.
  const [importProgress, setImportProgress] = useState<number | null>(null);
const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [newFilteredQuery, setNewFilteredQuery] = useState("is:due");
  const [editorFront, setEditorFront] = useState("");
  const [editorBack, setEditorBack] = useState("");
  const [confirmDeleteDeckId, setConfirmDeleteDeckId] = useState<string | null>(null);
  // How many browser/media rows are currently mounted (grows on scroll).
  const [browserVisibleCount, setBrowserVisibleCount] = useState(BROWSER_PAGE);
  const [mediaVisibleCount, setMediaVisibleCount] = useState(MEDIA_PAGE);
  // Media from the most recent client-side import still needs to reach the user's other
  // devices (P2P primary, cloud fallback) — see MediaTransferPanel.
  const [pendingTransfer, setPendingTransfer] = useState<PendingMediaTransfer | null>(null);

  useEffect(() => {
    reload();
  }, []);

  // Reset the browser window whenever the result set changes so we don't start scrolled deep
  // into a stale, now-shorter list.
  useEffect(() => {
    setBrowserVisibleCount(BROWSER_PAGE);
  }, [browserFilter, browserQuery, selectedDeckId]);

  // Grow a list's mounted-row count when the scroll container nears its bottom.
  const onListScroll = (grow: (n: number) => void, page: number) => (event: React.UIEvent<HTMLDivElement>) => {
    const el = event.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_LOAD_THRESHOLD) {
      grow(page);
    }
  };

  useEffect(() => {
    let cancelled = false;
    buildMediaURLMap(collection.mediaManifest).then((urls) => {
      if (!cancelled) setMediaUrls(urls);
    });
    return () => {
      cancelled = true;
    };
  }, [collection.mediaManifest]);

  const reload = async () => {
    try {
      const loaded = await getAnkiCollection();
      setCollection(loaded);
      setSelectedDeckId((current) => current || firstDeckWithCards(loaded));
    } finally {
      setLoading(false);
    }
  };

  const persist = async (next: AnkiCollection) => {
    setCollection(next);
    await saveAnkiCollection(next);
    onChange?.();
  };

  const notify = (type: "success" | "error", text: string) => {
    setNotice({ type, text });
    window.setTimeout(() => setNotice(null), 4500);
  };

  // O(1) id→record lookups, rebuilt only when the collection changes. Threaded into the render
  // and search paths below so they stop doing linear scans per card.
  const collectionIndex = useMemo(() => buildCollectionIndex(collection), [collection]);

  const deckCards = useMemo(() => {
    if (!selectedDeckId) return orderCardsForStudy(collection.cards);
    const selectedDeck = collectionIndex.decksById.get(selectedDeckId);
    const deckPrefix = selectedDeck?.name ? `${selectedDeck.name}::` : "";
    const childDeckIds = new Set(collection.decks.filter((deck) => deck.id === selectedDeckId || deck.name.startsWith(deckPrefix)).map((deck) => deck.id));
    return orderCardsForStudy(collection.cards.filter((card) => childDeckIds.has(card.deckId)));
  }, [collection, collectionIndex, selectedDeckId]);

  const filteredCards = useMemo(() => {
    const query = browserQuery.trim().toLowerCase();
    return deckCards.filter((card) => {
      const due = isV3CardDue(card);
      const state = card.fsrs?.state ?? card.type;
      const matchesFilter =
        browserFilter === "all" ||
        (browserFilter === "due" && due) ||
        (browserFilter === "new" && (state === 0 || card.queue === 0)) ||
        (browserFilter === "learning" && (state === 1 || card.queue === 1)) ||
        (browserFilter === "review" && (state === 2 || card.queue === 2)) ||
        (browserFilter === "suspended" && !!card.suspended) ||
        (browserFilter === "buried" && !!card.buriedUntil && card.buriedUntil > Date.now()) ||
        (browserFilter === "flagged" && !!card.flags);
      const matchesQuery = !query || cardSearchText(collection, card, collectionIndex).includes(query);
      return matchesFilter && matchesQuery;
    });
  }, [browserFilter, browserQuery, collection, collectionIndex, deckCards]);

  const dueCards = useMemo(() => deckCards.filter((card) => isV3CardDue(card)), [deckCards]);
  const currentReviewCard = dueCards[0] || deckCards[0];

  // Lazy-load media for the card about to be reviewed. Only fires when the card changes
  // and only fetches files not already in the URL map (cache hit → instant; miss → API fetch).
  useEffect(() => {
    if (!currentReviewCard) return;
    const rendered = renderAnkiCard(collection, currentReviewCard, {}, collectionIndex);
    if (!rendered?.mediaFiles.length) return;
    const missing = rendered.mediaFiles.filter((m) => !mediaUrls[m.fileName]);
    if (!missing.length) return;
    let cancelled = false;
    resolveCardMedia(missing).then((newUrls) => {
      if (!cancelled && Object.keys(newUrls).length > 0)
        setMediaUrls((prev) => ({ ...prev, ...newUrls }));
    });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentReviewCard?.id]);
  // No cards are due but the deck still has cards: we fall back to studying ahead of schedule.
  // Surface that explicitly rather than silently handing out not-yet-due cards.
  const studyingAhead = dueCards.length === 0 && !!currentReviewCard;
  const selectedCard = (selectedCardId ? collectionIndex.cardsById.get(selectedCardId) : undefined) || filteredCards[0] || currentReviewCard;
  const renderedReview = useMemo(
    () => (currentReviewCard ? renderAnkiCard(collection, currentReviewCard, mediaUrls, collectionIndex) : null),
    [collection, collectionIndex, currentReviewCard, mediaUrls]
  );
  const reviewBack = renderedReview ? splitAnswerHTML(renderedReview.backHTML) : null;
  const reviewSpeech = renderedReview ? pickSpeechText(renderedReview.frontHTML, renderedReview.backHTML) : "";
  const renderedSelected = useMemo(
    () => (selectedCard ? renderAnkiCard(collection, selectedCard, mediaUrls, collectionIndex) : null),
    [collection, collectionIndex, selectedCard, mediaUrls]
  );
  const selectedSpeech = renderedSelected ? pickSpeechText(renderedSelected.frontHTML, renderedSelected.backHTML) : "";
  const preset = collection.schedulerPresets[0] || defaultSchedulerPreset();

  // Per-deck counts in a single pass over the cards instead of four filters per deck.
  const deckRows = useMemo(() => {
    const counts = new Map<string, { total: number; due: number; suspended: number; studied: number }>();
    for (const deck of collection.decks) counts.set(deck.id, { total: 0, due: 0, suspended: 0, studied: 0 });
    for (const card of collection.cards) {
      const row = counts.get(card.deckId);
      if (!row) continue;
      row.total++;
      if (isV3CardDue(card)) row.due++;
      if (card.suspended) row.suspended++;
      if ((card.reps || card.fsrs?.reps || 0) > 0) row.studied++;
    }
    return collection.decks.map((deck) => ({ ...deck, ...(counts.get(deck.id) || { total: 0, due: 0, suspended: 0, studied: 0 }) }));
  }, [collection]);

  const studyDeck = (deckId: string) => {
    sound.playTick();
    setSelectedDeckId(deckId);
    setActiveTab("review");
    setIsBackShown(false);
    setReviewStartedAt(Date.now());
  };

  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    sound.playTick();
    setIsImporting(true);
    setImportProgress(0);
    try {
      const { collection: next, pendingMediaTransfer } = await importAnkiPackage(file, setImportProgress);
      setCollection(next);
      setSelectedDeckId(firstDeckWithCards(next));
      setActiveTab("decks");
      notify("success", `Imported ${file.name}: ${next.cards.length.toLocaleString()} total cards now in collection.`);
      if (pendingMediaTransfer) setPendingTransfer(pendingMediaTransfer);
    } catch (error: any) {
      sound.playIncorrect();
      notify("error", error?.message || "Import failed.");
    } finally {
      setIsImporting(false);
      setImportProgress(null);
      event.target.value = "";
    }
  };

  const gradeCurrentCard = async (grade: AnkiGrade) => {
    if (!currentReviewCard) return;
    const answerSeconds = Math.max(1, Math.round((Date.now() - reviewStartedAt) / 1000));
    const { card: updatedCard, log } = gradeAnkiCard(currentReviewCard, grade, preset, new Date(), answerSeconds);
    const next: AnkiCollection = {
      ...collection,
      cards: collection.cards.map((card) => card.id === currentReviewCard.id ? updatedCard : card),
      reviewLogs: [log, ...collection.reviewLogs],
    };
    setCollection(next);
    // Hot path: persist only the one changed card and the new log, not the whole collection.
    await saveAnkiCard(updatedCard);
    await appendAnkiReviewLog(log);
    onChange?.();
    setIsBackShown(false);
    setReviewStartedAt(Date.now());
    if (grade === 1) sound.playIncorrect();
    else sound.playCorrect();
  };

  useEffect(() => {
    if (activeTab !== "review" || !currentReviewCard) return;
    function handleKey(event: KeyboardEvent) {
      const tag = (event.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        if (!isBackShown) setIsBackShown(true);
      } else if (isBackShown && ["1", "2", "3", "4"].includes(event.key)) {
        gradeCurrentCard(Number(event.key) as AnkiGrade);
      } else if ((event.key === "r" || event.key === "R") && reviewSpeech) {
        sound.playCharacter(reviewSpeech);
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [activeTab, currentReviewCard, isBackShown, reviewSpeech]);

  const updateCard = async (cardId: string, updater: (card: AnkiCard) => AnkiCard) => {
    await persist({
      ...collection,
      cards: collection.cards.map((card) => card.id === cardId ? { ...updater(card), updatedAt: Date.now() } : card),
    });
  };

  const createBasicNote = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedDeckId || !editorFront.trim() || !editorBack.trim()) return;
    const noteType = collection.noteTypes.find((model) => model.name === "Kiroku Basic") || {
      id: "kiroku-basic",
      name: "Kiroku Basic",
      type: 0,
      css: ".card { font-family: system-ui, sans-serif; font-size: 24px; text-align: center; }",
      fields: [{ name: "Front", ord: 0 }, { name: "Back", ord: 1 }],
      templates: [{ name: "Card 1", ord: 0, qfmt: "{{Front}}", afmt: "{{FrontSide}}<hr id=answer>{{Back}}" }],
    };
    const noteId = `note-${Date.now()}`;
    const cardId = `card-${Date.now()}`;
    await persist({
      ...collection,
      noteTypes: collection.noteTypes.some((model) => model.id === noteType.id) ? collection.noteTypes : [...collection.noteTypes, noteType],
      notes: [...collection.notes, {
        id: noteId,
        guid: crypto.randomUUID?.() || noteId,
        noteTypeId: noteType.id,
        tags: [],
        fields: { Front: editorFront.trim(), Back: editorBack.trim() },
        fieldOrder: ["Front", "Back"],
        rawFields: [editorFront.trim(), editorBack.trim()],
        sortField: editorFront.trim(),
      }],
      cards: [...collection.cards, {
        id: cardId,
        noteId,
        deckId: selectedDeckId,
        ord: 0,
        type: 0,
        queue: 0,
        due: 0,
        interval: 0,
        factor: 0,
        reps: 0,
        lapses: 0,
        templateName: "Card 1",
        front: editorFront.trim(),
        back: editorBack.trim(),
        updatedAt: Date.now(),
      }],
    });
    setEditorFront("");
    setEditorBack("");
    notify("success", "Added a basic note.");
  };

  const createFilteredDeck = async () => {
    const query = newFilteredQuery.trim() || "is:due";
    const cardIds = applySimpleSearch(collection, query).map((card) => card.id);
    await persist({
      ...collection,
      filteredDecks: [{
        id: `filtered-${Date.now()}`,
        name: `Custom Study ${new Date().toLocaleDateString()}`,
        query,
        cardIds,
        reschedule: true,
        createdAt: Date.now(),
      }, ...collection.filteredDecks],
    });
    notify("success", `Created filtered deck with ${cardIds.length} cards.`);
  };

  const handleDeleteDeck = async (deckId: string) => {
    const targetDeck = collection.decks.find((d) => d.id === deckId);
    if (!targetDeck) return;
    const deckPrefix = `${targetDeck.name}::`;
    const removedDeckIds = new Set(
      collection.decks
        .filter((d) => d.id === deckId || d.name.startsWith(deckPrefix))
        .map((d) => d.id)
    );
    const remainingCards = collection.cards.filter((c) => !removedDeckIds.has(c.deckId));
    const remainingCardIds = new Set(remainingCards.map((c) => c.id));
    const remainingNoteIds = new Set(remainingCards.map((c) => c.noteId));
    const removedCardIds = collection.cards.filter((c) => removedDeckIds.has(c.deckId)).map((c) => c.id);
    const next: AnkiCollection = {
      ...collection,
      decks: collection.decks.filter((d) => !removedDeckIds.has(d.id)),
      cards: remainingCards,
      notes: collection.notes.filter((n) => remainingNoteIds.has(n.id)),
      reviewLogs: collection.reviewLogs.filter((log) => remainingCardIds.has(log.cardId)),
    };
    // Tombstone the removed cards so the deletion propagates to the server/other devices
    // instead of being resurrected from their copies on the next sync.
    await markAnkiCardsDeleted(removedCardIds);
    await persist(next);
    setConfirmDeleteDeckId(null);
    if (removedDeckIds.has(selectedDeckId)) {
      setSelectedDeckId(next.decks[0]?.id || "");
    }
    notify("success", `Deleted "${targetDeck.name}" and all related progress.`);
  };

  const exportCollection = () => {
    const blob = new Blob([JSON.stringify(collection, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "kiroku-anki-v3-collection.json";
    link.click();
  };

  // All collection-wide stats in a single memoized pass, recomputed only when the collection
  // changes — not on every render of the header/stats tabs.
  const stats = useMemo(() => {
    let studied = 0, mature = 0, due = 0, lapses = 0;
    for (const card of collection.cards) {
      if ((card.reps || card.fsrs?.reps || 0) > 0) studied++;
      if ((card.fsrs?.scheduled_days || card.interval || 0) >= 21) mature++;
      if (isV3CardDue(card)) due++;
      lapses += card.lapses || card.fsrs?.lapses || 0;
    }
    let mediaBytes = 0;
    for (const media of collection.mediaManifest) mediaBytes += media.bytes;
    return {
      cards: collection.cards.length,
      studied,
      mature,
      due,
      lapses,
      reviews: collection.reviewLogs.length,
      mediaMB: (mediaBytes / 1024 / 1024).toFixed(1),
      imports: collection.importReports.length,
    };
  }, [collection]);

  return (
    <>
    <div className="bg-white border-2 border-zinc-900 rounded-[28px] p-4 sm:p-5 shadow-[5px_5px_0px_0px_rgba(0,0,0,1)] space-y-5">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b-2 border-zinc-100 pb-4">
        <div className="flex items-center gap-2.5">
          <span className="grid place-items-center h-9 w-9 rounded-xl border-2 border-zinc-900 bg-indigo-50 shrink-0">
            <Boxes className="h-5 w-5 text-indigo-600" />
          </span>
          <div>
            <h3 className="text-lg font-black uppercase text-zinc-950 leading-none">Anki Decks</h3>
            <p className="hidden sm:block text-[11px] font-bold uppercase tracking-wide text-zinc-500 mt-1">
              Import, review &amp; manage Anki packages — media + FSRS included.
            </p>
          </div>
        </div>
        <div className="flex flex-col min-[520px]:flex-row gap-2">
          <label className={`relative overflow-hidden px-3 py-2 rounded-xl border-2 border-zinc-900 bg-indigo-600 text-white text-xs font-black uppercase flex items-center justify-center gap-1.5 cursor-pointer shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] ${isImporting ? "opacity-60 pointer-events-none" : ""}`}>
            <Upload className="h-4 w-4" />
            {importButtonLabel(isImporting, importProgress)}
            <input type="file" accept=".apkg,.colpkg" className="hidden" onChange={handleImport} disabled={isImporting} />
            <ImportProgressBar progress={isImporting ? importProgress : null} />
          </label>
          <button onClick={exportCollection} className="px-3 py-2 rounded-xl border-2 border-zinc-900 bg-white text-zinc-900 text-xs font-black uppercase flex items-center justify-center gap-1.5">
            <Download className="h-4 w-4" /> Export JSON
          </button>
        </div>
      </div>


      <AnimatePresence>
        {notice && (
          <motion.div
            initial={{ opacity: 0, y: -6, height: 0 }}
            animate={{ opacity: 1, y: 0, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className={`rounded-2xl border-2 px-3 py-2 text-xs font-bold overflow-hidden ${notice.type === "success" ? "bg-emerald-50 border-emerald-300 text-emerald-900" : "bg-red-50 border-red-300 text-red-900"}`}
          >
            {notice.text}
          </motion.div>
        )}
      </AnimatePresence>

      {loading ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading decks">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-16 rounded-2xl border-2 border-zinc-200 bg-zinc-100 animate-pulse" />
            ))}
          </div>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 rounded-2xl border-2 border-zinc-200 bg-zinc-100 animate-pulse" />
          ))}
        </div>
      ) : collection.cards.length === 0 ? (
        <FirstRunImport isImporting={isImporting} importProgress={importProgress} onImport={handleImport} />
      ) : (
      <>
      <div className="grid grid-cols-4 min-[560px]:grid-cols-4 lg:grid-cols-8 gap-2">
        {[
          ["decks", Layers, "Decks"],
          ["review", Play, "Review"],
          ["browser", Search, "Browser"],
          ["editor", Plus, "Editor"],
          ["media", FileImage, "Media"],
          ["options", Cog, "Options"],
          ["custom", Filter, "Custom"],
          ["stats", BarChart3, "Stats"],
        ].map(([id, Icon, label]) => (
          <button
            key={String(id)}
            onClick={() => {
              sound.playTick();
              setActiveTab(id as WorkspaceTab);
              setIsBackShown(false);
              setReviewStartedAt(Date.now());
            }}
            className={`px-2 py-2 rounded-xl border-2 text-[10px] font-black uppercase flex items-center justify-center gap-1.5 transition-colors ${activeTab === id ? "bg-zinc-900 text-white border-zinc-900" : "bg-zinc-50 text-zinc-700 border-zinc-200"}`}
          >
            <Icon className="h-3.5 w-3.5" /> {label}
          </button>
        ))}
      </div>

      {/* Inner panels stay mounted (hidden when inactive) so switching tabs is instant and
          keeps local view state — they read already-loaded collection data, so no flash. */}
      <TabPanel active={activeTab === "decks"}>{(
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Metric label="Due now" value={stats.due} accent />
            <Metric label="Cards" value={stats.cards} />
            <Metric label="Studied" value={stats.studied} />
            <Metric label="Mature" value={stats.mature} />
          </div>
          <div className="space-y-2">
            {deckRows.length === 0 ? <EmptyState text="Import an Anki package to populate decks." /> : deckRows.map((deck) => {
              const progress = deck.total > 0 ? Math.round((deck.studied / deck.total) * 100) : 0;
              return (
                <div
                  key={deck.id}
                  className={`p-3 sm:p-4 rounded-2xl border-2 transition-colors ${selectedDeckId === deck.id ? "bg-indigo-50 border-indigo-900" : "bg-white border-zinc-200 hover:border-zinc-400"}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <button className="text-left min-w-0 flex-1" onClick={() => studyDeck(deck.id)}>
                      <span className="block text-sm font-black uppercase text-zinc-900 break-words leading-tight">{deck.name}</span>
                      <span className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] font-bold uppercase text-zinc-500">
                        <span>{deck.total} cards</span>
                        {deck.due > 0 && <span className="text-indigo-600">{deck.due} due</span>}
                        {deck.suspended > 0 && <span>{deck.suspended} suspended</span>}
                      </span>
                    </button>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => studyDeck(deck.id)}
                        className="px-3 py-1.5 rounded-xl border-2 border-zinc-900 bg-indigo-600 text-white text-[10px] font-black uppercase flex items-center gap-1 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] active:translate-y-px active:shadow-none transition"
                      >
                        <Play className="h-3 w-3" /> Study
                      </button>
                      <button
                        onClick={() => setConfirmDeleteDeckId(deck.id)}
                        aria-label={`Delete ${deck.name}`}
                        className="p-1.5 rounded-xl border-2 border-zinc-200 bg-white text-zinc-400 hover:border-red-300 hover:text-red-600 transition-colors"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="mt-2.5 flex items-center gap-2">
                    <div className="h-1.5 flex-1 rounded-full bg-zinc-100 overflow-hidden">
                      <div className="h-full rounded-full bg-emerald-400" style={{ width: `${progress}%` }} />
                    </div>
                    <span className="text-[9px] font-black uppercase tabular-nums text-zinc-400">{progress}%</span>
                  </div>
                  {confirmDeleteDeckId === deck.id && (
                    <div className="mt-2.5 pt-2.5 border-t border-zinc-100 flex items-center gap-2">
                      <span className="text-[10px] font-black uppercase text-red-700 flex-1">Delete deck + all progress?</span>
                      <button
                        onClick={() => handleDeleteDeck(deck.id)}
                        className="px-2 py-1 rounded-lg border border-red-400 bg-red-100 text-[10px] font-black uppercase text-red-700"
                      >
                        Yes, Delete
                      </button>
                      <button
                        onClick={() => setConfirmDeleteDeckId(null)}
                        className="px-2 py-1 rounded-lg border border-zinc-300 bg-white text-[10px] font-black uppercase"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}</TabPanel>

      <TabPanel active={activeTab === "review"}>{(
        <div className={`mx-auto w-full space-y-4 transition-[max-width] duration-200 ${isBackShown && reviewBack?.hasAnswer ? "max-w-5xl" : "max-w-2xl"}`}>
          <DeckSelect collection={collection} selectedDeckId={selectedDeckId} setSelectedDeckId={setSelectedDeckId} />
          {!currentReviewCard || !renderedReview ? (
            <EmptyState text="Import an Anki package or choose a deck with cards to start review." />
          ) : (
            <div className="space-y-4">
              {studyingAhead && (
                <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900">
                  All due cards are cleared — you're now studying ahead of schedule. Reviewing early can pull future cards forward.
                </div>
              )}
              <div className="bg-white border-2 border-zinc-900 rounded-[24px] shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] min-h-[clamp(320px,55vh,560px)] p-4 sm:p-6 flex flex-col">
                <div className="flex justify-between items-center gap-2 text-[10px] font-black uppercase text-zinc-400">
                  <span className="truncate">{collection.decks.find((deck) => deck.id === currentReviewCard.deckId)?.name || "Deck"}</span>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {reviewSpeech && (
                      <button
                        type="button"
                        onClick={() => sound.playCharacter(reviewSpeech)}
                        aria-label="Play pronunciation"
                        title="Play pronunciation"
                        className="inline-flex items-center justify-center rounded-full p-1 text-zinc-400 hover:text-indigo-600 hover:bg-indigo-50 transition"
                      >
                        <Volume2 className="h-4 w-4" />
                      </button>
                    )}
                    <span className={`px-2 py-0.5 rounded-full ${studyingAhead ? "bg-amber-100 text-amber-700" : "bg-indigo-100 text-indigo-700"}`}>{studyingAhead ? "ahead" : `${dueCards.length} due`}</span>
                  </div>
                </div>
                <div className={`flex-1 py-6 flex ${isBackShown && reviewBack?.hasAnswer ? "items-start" : "items-center justify-center"}`}>
                  {!isBackShown ? (
                    <div className="anki-card-render text-center w-full" dangerouslySetInnerHTML={{ __html: sanitizeTemplateHTML(renderedReview.frontHTML) }} />
                  ) : reviewBack?.hasAnswer ? (
                    <div className="grid w-full items-start gap-4 lg:grid-cols-2 lg:gap-8">
                      <div className="min-w-0">
                        <span className="block text-[10px] font-black uppercase tracking-wider text-zinc-400 mb-2">Question</span>
                        <div className="anki-card-render break-words" dangerouslySetInnerHTML={{ __html: sanitizeTemplateHTML(renderedReview.frontHTML) }} />
                      </div>
                      <div className="min-w-0 border-t-2 border-zinc-100 pt-4 lg:border-t-0 lg:border-l-2 lg:pt-0 lg:pl-8">
                        <span className="block text-[10px] font-black uppercase tracking-wider text-indigo-500 mb-2">Answer</span>
                        <div className="anki-card-render break-words" dangerouslySetInnerHTML={{ __html: sanitizeTemplateHTML(reviewBack.answerHTML) }} />
                      </div>
                    </div>
                  ) : (
                    <div className="anki-card-render text-center w-full" dangerouslySetInnerHTML={{ __html: sanitizeTemplateHTML(renderedReview.backHTML) }} />
                  )}
                </div>
                <style dangerouslySetInnerHTML={{ __html: renderedReview.css.replace(/^<style>|<\/style>$/g, "") }} />
                {!isBackShown ? (
                  <button onClick={() => setIsBackShown(true)} className="w-full py-3 rounded-2xl border-2 border-zinc-900 bg-zinc-900 text-white text-xs font-black uppercase active:translate-y-px transition">
                    Show Answer <span className="opacity-50 normal-case">(Space)</span>
                  </button>
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    {([1, 2, 3, 4] as AnkiGrade[]).map((grade) => {
                      const preview = previewFSRS(currentReviewCard, preset)[grade];
                      return (
                        <button key={grade} onClick={() => gradeCurrentCard(grade)} className={`py-3 rounded-2xl border-2 border-zinc-900 text-xs font-black uppercase active:translate-y-px transition ${grade === 1 ? "bg-red-300" : grade === 2 ? "bg-amber-300" : grade === 3 ? "bg-indigo-200" : "bg-emerald-300"}`}>
                          <span className="block">{gradeLabels[grade]}</span>
                          <span className="block text-[9px] opacity-70">{formatDue(preview.card.due.getTime())}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              <CardActions card={currentReviewCard} updateCard={updateCard} />
            </div>
          )}
        </div>
      )}</TabPanel>

      <TabPanel active={activeTab === "browser"}>{(
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <div className="lg:col-span-5 space-y-3">
            <DeckSelect collection={collection} selectedDeckId={selectedDeckId} setSelectedDeckId={setSelectedDeckId} />
            <div className="flex gap-2">
              <input value={browserQuery} onChange={(e) => setBrowserQuery(e.target.value)} placeholder="Search fields, tags, deck..." className="flex-1 min-w-0 rounded-xl border-2 border-zinc-900 px-3 py-2 text-xs font-bold" />
              <select value={browserFilter} onChange={(e) => setBrowserFilter(e.target.value as BrowserFilter)} className="rounded-xl border-2 border-zinc-900 px-2 py-2 text-xs font-black uppercase">
                {["all", "due", "new", "learning", "review", "suspended", "buried", "flagged"].map((filter) => <option key={filter} value={filter}>{filter}</option>)}
              </select>
            </div>
            <div
              className="max-h-[520px] overflow-y-auto space-y-2 pr-1"
              onScroll={onListScroll((n) => setBrowserVisibleCount((c) => Math.min(filteredCards.length, c + n)), BROWSER_PAGE)}
            >
              {filteredCards.slice(0, browserVisibleCount).map((card) => (
                <button key={card.id} onClick={() => setSelectedCardId(card.id)} className={`w-full p-3 rounded-2xl border-2 text-left ${selectedCard?.id === card.id ? "bg-indigo-50 border-indigo-900" : "bg-white border-zinc-200"}`}>
                  <span className="block text-sm font-black text-zinc-900 truncate">{stripHTML(card.front || renderedPreview(collection, card, mediaUrls, collectionIndex)?.frontHTML || "")}</span>
                  <span className="block text-[10px] font-bold text-zinc-500 mt-1 truncate">{collectionIndex.notesById.get(card.noteId)?.tags.map((tag) => `#${tag}`).join(" ")}</span>
                </button>
              ))}
              {filteredCards.length > browserVisibleCount && (
                <p className="text-center text-[10px] font-bold uppercase tracking-wide text-zinc-400 py-2">
                  Showing {browserVisibleCount.toLocaleString()} of {filteredCards.length.toLocaleString()} — scroll for more
                </p>
              )}
            </div>
          </div>
          <div className="lg:col-span-7 bg-zinc-50 border-2 border-zinc-900 rounded-[22px] p-4 space-y-4">
            {!selectedCard || !renderedSelected ? <EmptyState text="Select a card to inspect." /> : (
              <>
                <div className="flex flex-wrap gap-2 justify-between">
                  <div>
                    <span className="block text-[10px] font-black uppercase text-zinc-400">Selected Card</span>
                    <h4 className="flex items-center gap-1.5 text-lg font-black text-zinc-900">
                      {renderedSelected.template?.name}
                      {selectedSpeech && (
                        <button
                          type="button"
                          onClick={() => sound.playCharacter(selectedSpeech)}
                          aria-label="Play pronunciation"
                          title="Play pronunciation"
                          className="inline-flex items-center justify-center rounded-full p-1 text-zinc-400 hover:text-indigo-600 hover:bg-indigo-50 transition"
                        >
                          <Volume2 className="h-4 w-4" />
                        </button>
                      )}
                    </h4>
                  </div>
                  <CardActions card={selectedCard} updateCard={updateCard} />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <RenderPanel title="Front" html={renderedSelected.frontHTML} css={renderedSelected.css} />
                  <RenderPanel title="Back" html={renderedSelected.backHTML} css={renderedSelected.css} />
                </div>
                <div className="space-y-2">
                  {Object.entries(renderedSelected.note.fields).map(([name, value]) => (
                    <details key={name} className="bg-white border border-zinc-200 rounded-xl p-3" open={/kanji|reading|front|back|meaning|english|story|audio/i.test(name)}>
                      <summary className="text-[10px] font-black uppercase text-zinc-700 cursor-pointer">{name}</summary>
                      <div className="mt-2 text-sm text-zinc-700 break-words" dangerouslySetInnerHTML={{ __html: sanitizeTemplateHTML(String(value)) }} />
                    </details>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}</TabPanel>

      <TabPanel active={activeTab === "editor"}>{(
        <form onSubmit={createBasicNote} className="space-y-4">
          <DeckSelect collection={collection} selectedDeckId={selectedDeckId} setSelectedDeckId={setSelectedDeckId} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <textarea value={editorFront} onChange={(e) => setEditorFront(e.target.value)} rows={5} placeholder="Front field" className="rounded-2xl border-2 border-zinc-900 p-3 text-sm font-bold" />
            <textarea value={editorBack} onChange={(e) => setEditorBack(e.target.value)} rows={5} placeholder="Back field" className="rounded-2xl border-2 border-zinc-900 p-3 text-sm font-bold" />
          </div>
          <button disabled={!selectedDeckId || !editorFront.trim() || !editorBack.trim()} className="w-full py-3 rounded-2xl border-2 border-zinc-900 bg-zinc-900 text-white text-xs font-black uppercase disabled:opacity-50">
            Add Basic Note
          </button>
          <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">Imported note types and templates are preserved in Browser; this editor adds Kiroku Basic notes.</p>
        </form>
      )}</TabPanel>

      <TabPanel active={activeTab === "media"}>{(
        collection.mediaManifest.length === 0 ? <EmptyState text="No imported media yet." /> : (
          <div
            className="max-h-[640px] overflow-y-auto pr-1"
            onScroll={onListScroll((n) => setMediaVisibleCount((c) => Math.min(collection.mediaManifest.length, c + n)), MEDIA_PAGE)}
          >
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {collection.mediaManifest.slice(0, mediaVisibleCount).map((media) => (
                <div key={media.hash} className="bg-white border-2 border-zinc-200 rounded-2xl p-3 min-w-0">
                  <div className="flex items-center gap-2">
                    {media.contentType.startsWith("audio") ? <FileAudio className="h-4 w-4 text-indigo-600" /> : <FileImage className="h-4 w-4 text-emerald-600" />}
                    <span className="text-xs font-black text-zinc-900 truncate">{media.fileName}</span>
                  </div>
                  <span className="block mt-1 text-[10px] font-mono text-zinc-400">{Math.round(media.bytes / 1024)} KB</span>
                  {media.contentType.startsWith("audio") && mediaUrls[media.fileName] ? <audio controls preload="none" src={mediaUrls[media.fileName]} className="mt-2 w-full" /> : null}
                  {media.contentType.startsWith("image") && mediaUrls[media.fileName] ? <img loading="lazy" src={mediaUrls[media.fileName]} alt="" className="mt-2 max-h-40 rounded-xl border border-zinc-200 mx-auto" /> : null}
                </div>
              ))}
            </div>
            {collection.mediaManifest.length > mediaVisibleCount && (
              <p className="text-center text-[10px] font-bold uppercase tracking-wide text-zinc-400 py-2">
                Showing {mediaVisibleCount.toLocaleString()} of {collection.mediaManifest.length.toLocaleString()} — scroll for more
              </p>
            )}
          </div>
        )
      )}</TabPanel>

      <TabPanel active={activeTab === "options"}>{(
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Metric label="Scheduler" value="FSRS" />
          <Metric label="Desired Retention" value={`${Math.round(preset.desiredRetention * 100)}%`} />
          <Metric label="Max Interval" value={`${preset.maximumInterval}d`} />
          <Metric label="FSRS Params" value={preset.parameters.w.length} />
          <div className="md:col-span-2 bg-amber-50 border-2 border-amber-300 rounded-2xl p-3 text-xs font-bold text-amber-900">
            FSRS is active for all Anki review buttons. Parameter optimization UI is staged behind review-log accumulation.
          </div>
        </div>
      )}</TabPanel>

      <TabPanel active={activeTab === "custom"}>{(
        <div className="space-y-4">
          <div className="flex flex-col md:flex-row gap-2">
            <input value={newFilteredQuery} onChange={(e) => setNewFilteredQuery(e.target.value)} className="flex-1 rounded-xl border-2 border-zinc-900 px-3 py-2 text-xs font-bold" placeholder='e.g. is:due tag:JLPT or deck:"Core Japanese"' />
            <button onClick={createFilteredDeck} className="px-4 py-2 rounded-xl border-2 border-zinc-900 bg-zinc-900 text-white text-xs font-black uppercase">Build Filtered Deck</button>
          </div>
          <div className="space-y-2">
            {collection.filteredDecks.length === 0 ? <EmptyState text="No filtered decks yet." /> : collection.filteredDecks.map((deck) => (
              <div key={deck.id} className="bg-white border-2 border-zinc-200 rounded-2xl p-3">
                <span className="block text-xs font-black uppercase text-zinc-900">{deck.name}</span>
                <span className="block text-[10px] font-mono text-zinc-500 mt-1">{deck.query} · {deck.cardIds.length} cards</span>
              </div>
            ))}
          </div>
        </div>
      )}</TabPanel>

      <TabPanel active={activeTab === "stats"}>{(
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Metric label="Cards" value={stats.cards} />
          <Metric label="Due" value={stats.due} />
          <Metric label="Studied" value={stats.studied} />
          <Metric label="Mature" value={stats.mature} />
          <Metric label="Reviews" value={stats.reviews} />
          <Metric label="Lapses" value={stats.lapses} />
          <Metric label="Media MB" value={stats.mediaMB} />
          <Metric label="Imports" value={stats.imports} />
        </div>
      )}</TabPanel>
      </>
      )}
    </div>
    {pendingTransfer && getCurrentUser() && (
      <MediaTransferPanel
        file={pendingTransfer.file}
        manifest={pendingTransfer.manifest}
        email={getCurrentUser()!.email}
        onDone={() => setPendingTransfer(null)}
      />
    )}
    </>
  );
};

const EmptyState: React.FC<{ text: string }> = ({ text }) => (
  <div className="bg-zinc-50 border-2 border-dashed border-zinc-300 rounded-2xl p-6 text-center text-[10px] font-black uppercase tracking-wide text-zinc-400">
    {text}
  </div>
);

// Subtle import-button affordance: the live upload percentage while chunks are in flight,
// then "Importing…" during the server-side parse/merge once the upload itself completes.
function importButtonLabel(isImporting: boolean, progress: number | null): string {
  if (!isImporting) return "Import .apkg/.colpkg";
  if (progress !== null && progress < 1) return `Uploading ${Math.round(progress * 100)}%`;
  return "Importing…";
}

// A hairline fill along the bottom of the import button tracking upload progress. Rendered
// only while importing; the parent passes null otherwise so it disappears.
const ImportProgressBar: React.FC<{ progress: number | null }> = ({ progress }) =>
  progress === null ? null : (
    <span
      className="absolute left-0 bottom-0 h-0.5 bg-white/80 transition-[width] duration-200 ease-out"
      style={{ width: `${Math.round(progress * 100)}%` }}
    />
  );

// Focused first-run state: with no deck imported, the eight tabs + zeroed stat cards are just
// noise. Show one clear call to action instead.
const FirstRunImport: React.FC<{ isImporting: boolean; importProgress: number | null; onImport: (event: React.ChangeEvent<HTMLInputElement>) => void }> = ({ isImporting, importProgress, onImport }) => (
  <div className="border-2 border-dashed border-zinc-300 rounded-[24px] p-8 sm:p-12 text-center space-y-4">
    <div className="mx-auto w-14 h-14 rounded-2xl border-2 border-zinc-900 bg-indigo-50 flex items-center justify-center">
      <Upload className="h-6 w-6 text-indigo-600" />
    </div>
    <div>
      <h4 className="text-lg font-black text-zinc-950">Import a deck to get started</h4>
      <p className="mt-1 text-xs font-bold text-zinc-500 max-w-md mx-auto">Bring in any Anki <code>.apkg</code> / <code>.colpkg</code> package. Media and scheduling are kept — your reviews, browser, and stats appear once it's loaded.</p>
    </div>
    <label className={`relative overflow-hidden inline-flex px-5 py-3 rounded-2xl border-2 border-zinc-900 bg-indigo-600 text-white text-xs font-black uppercase items-center justify-center gap-2 cursor-pointer shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] ${isImporting ? "opacity-60 pointer-events-none" : ""}`}>
      <Upload className="h-4 w-4" />
      {importButtonLabel(isImporting, importProgress)}
      <input type="file" accept=".apkg,.colpkg" className="hidden" onChange={onImport} disabled={isImporting} />
      <ImportProgressBar progress={isImporting ? importProgress : null} />
    </label>
  </div>
);

const Metric: React.FC<{ label: string; value: React.ReactNode; accent?: boolean }> = ({ label, value, accent }) => (
  <div className={`border-2 border-zinc-900 rounded-2xl p-3 ${accent ? "bg-indigo-600" : "bg-white"}`}>
    <span className={`block text-[9px] font-black uppercase tracking-wider ${accent ? "text-indigo-200" : "text-zinc-400"}`}>{label}</span>
    <span className={`block text-xl font-black mt-1 break-words ${accent ? "text-white" : "text-zinc-900"}`}>{value}</span>
  </div>
);

const DeckSelect: React.FC<{ collection: AnkiCollection; selectedDeckId: string; setSelectedDeckId: (id: string) => void }> = ({ collection, selectedDeckId, setSelectedDeckId }) => (
  <select value={selectedDeckId} onChange={(e) => setSelectedDeckId(e.target.value)} className="w-full rounded-xl border-2 border-zinc-900 px-3 py-2 text-xs font-black uppercase text-zinc-900 bg-white">
    {collection.decks.length === 0 ? <option value="">No decks</option> : collection.decks.map((deck) => <option key={deck.id} value={deck.id}>{deck.name}</option>)}
  </select>
);

const CardActions: React.FC<{ card: AnkiCard; updateCard: (cardId: string, updater: (card: AnkiCard) => AnkiCard) => Promise<void> }> = ({ card, updateCard }) => {
  const [confirmReset, setConfirmReset] = useState(false);
  return (
    <div className="flex flex-wrap gap-2">
      <button onClick={() => updateCard(card.id, (c) => ({ ...c, suspended: !c.suspended }))} className="px-2 py-1.5 rounded-xl border border-zinc-300 bg-white text-[10px] font-black uppercase flex items-center gap-1">
        <PauseCircle className="h-3.5 w-3.5" /> {card.suspended ? "Unsuspend" : "Suspend"}
      </button>
      <button onClick={() => updateCard(card.id, (c) => ({ ...c, buriedUntil: Date.now() + 86400000 }))} className="px-2 py-1.5 rounded-xl border border-zinc-300 bg-white text-[10px] font-black uppercase flex items-center gap-1">
        <Archive className="h-3.5 w-3.5" /> Bury
      </button>
      <button onClick={() => updateCard(card.id, (c) => ({ ...c, flags: c.flags ? 0 : 1 }))} className="px-2 py-1.5 rounded-xl border border-zinc-300 bg-white text-[10px] font-black uppercase flex items-center gap-1">
        <Flag className="h-3.5 w-3.5" /> {card.flags ? "Unflag" : "Flag"}
      </button>
      {confirmReset ? (
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-black uppercase text-zinc-600">Reset progress?</span>
          <button onClick={() => { updateCard(card.id, (c) => ({ ...c, reps: 0, lapses: 0, interval: 0, queue: 0, due: 0, fsrs: undefined, buriedUntil: undefined })); setConfirmReset(false); }} className="px-2 py-1.5 rounded-xl border border-red-400 bg-red-100 text-[10px] font-black uppercase text-red-700">Yes, Reset</button>
          <button onClick={() => setConfirmReset(false)} className="px-2 py-1.5 rounded-xl border border-zinc-300 bg-white text-[10px] font-black uppercase">Cancel</button>
        </div>
      ) : (
        <button onClick={() => setConfirmReset(true)} className="px-2 py-1.5 rounded-xl border border-zinc-300 bg-white text-[10px] font-black uppercase flex items-center gap-1">
          <RotateCcw className="h-3.5 w-3.5" /> Reset
        </button>
      )}
    </div>
  );
};

const RenderPanel: React.FC<{ title: string; html: string; css: string }> = ({ title, html, css }) => (
  <div className="bg-white border border-zinc-200 rounded-2xl p-3 min-w-0">
    <span className="block text-[10px] font-black uppercase text-zinc-400 mb-2">{title}</span>
    <style dangerouslySetInnerHTML={{ __html: css.replace(/^<style>|<\/style>$/g, "") }} />
    <div className="anki-card-render break-words" dangerouslySetInnerHTML={{ __html: sanitizeTemplateHTML(html) }} />
  </div>
);

function renderedPreview(collection: AnkiCollection, card: AnkiCard, mediaUrls: Record<string, string>, index?: CollectionIndex) {
  return renderAnkiCard(collection, card, mediaUrls, index);
}

// Anki's default answer template renders the back as `{{FrontSide}}<hr id=answer>{{Back}}`.
// Splitting on that separator lets us lay the question and the answer side by side on wide
// screens instead of stacking them, so the answer doesn't push content off-screen. Cards
// whose template lacks the separator fall back to showing the full back.
function splitAnswerHTML(backHTML: string): { hasAnswer: boolean; answerHTML: string } {
  const parts = backHTML.split(/<hr\s+id=["']?answer["']?[^>]*>/i);
  if (parts.length > 1) return { hasAnswer: true, answerHTML: parts.slice(1).join("") };
  return { hasAnswer: false, answerHTML: backHTML };
}

function formatDue(timestamp: number): string {
  const diff = timestamp - Date.now();
  if (diff <= 0) return "now";
  const minutes = Math.ceil(diff / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.ceil(minutes / 60);
  if (hours < 48) return `${hours}h`;
  const days = Math.ceil(hours / 24);
  return `${days}d`;
}

function applySimpleSearch(collection: AnkiCollection, query: string): AnkiCard[] {
  const normalized = query.toLowerCase();
  return collection.cards.filter((card) => {
    if (normalized.includes("is:due") && !isV3CardDue(card)) return false;
    if (normalized.includes("is:new") && card.reps > 0) return false;
    const tagMatch = normalized.match(/tag:([^\s]+)/);
    if (tagMatch) {
      const note = collection.notes.find((item) => item.id === card.noteId);
      if (!note?.tags.some((tag) => tag.toLowerCase().includes(tagMatch[1]))) return false;
    }
    const deckMatch = normalized.match(/deck:"([^"]+)"/);
    if (deckMatch) {
      const deck = collection.decks.find((item) => item.id === card.deckId);
      if (!deck?.name.toLowerCase().includes(deckMatch[1])) return false;
    }
    const bare = normalized.replace(/is:\w+|tag:[^\s]+|deck:"[^"]+"/g, "").trim();
    return !bare || cardSearchText(collection, card).includes(bare);
  });
}

export default AnkiCloneWorkspace;

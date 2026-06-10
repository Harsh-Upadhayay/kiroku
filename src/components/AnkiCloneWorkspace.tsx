import React, { useEffect, useMemo, useState } from "react";
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
  Upload,
} from "lucide-react";
import {
  type AnkiCard,
  type AnkiCollection,
  type AnkiGrade,
  buildMediaURLMap,
  cardSearchText,
  defaultSchedulerPreset,
  emptyCollection,
  getAnkiCollection,
  gradeAnkiCard,
  importAnkiPackage,
  isV3CardDue,
  previewFSRS,
  renderAnkiCard,
  saveAnkiCollection,
  sanitizeTemplateHTML,
  stripHTML,
} from "../utils/anki-v3";
import { sound } from "../utils/audio";

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
  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [newFilteredQuery, setNewFilteredQuery] = useState("is:due");
  const [editorFront, setEditorFront] = useState("");
  const [editorBack, setEditorBack] = useState("");

  useEffect(() => {
    reload();
  }, []);

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
    const loaded = await getAnkiCollection();
    setCollection(loaded);
    setSelectedDeckId((current) => current || loaded.decks[0]?.id || "");
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

  const deckCards = useMemo(() => {
    if (!selectedDeckId) return collection.cards;
    const selectedDeck = collection.decks.find((deck) => deck.id === selectedDeckId);
    const deckPrefix = selectedDeck?.name ? `${selectedDeck.name}::` : "";
    const childDeckIds = new Set(collection.decks.filter((deck) => deck.id === selectedDeckId || deck.name.startsWith(deckPrefix)).map((deck) => deck.id));
    return collection.cards.filter((card) => childDeckIds.has(card.deckId));
  }, [collection, selectedDeckId]);

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
      const matchesQuery = !query || cardSearchText(collection, card).includes(query);
      return matchesFilter && matchesQuery;
    });
  }, [browserFilter, browserQuery, collection, deckCards]);

  const dueCards = useMemo(() => deckCards.filter((card) => isV3CardDue(card)), [deckCards]);
  const currentReviewCard = dueCards[0] || deckCards[0];
  const selectedCard = collection.cards.find((card) => card.id === selectedCardId) || filteredCards[0] || currentReviewCard;
  const renderedReview = currentReviewCard ? renderAnkiCard(collection, currentReviewCard, mediaUrls) : null;
  const renderedSelected = selectedCard ? renderAnkiCard(collection, selectedCard, mediaUrls) : null;
  const preset = collection.schedulerPresets[0] || defaultSchedulerPreset();

  const deckRows = collection.decks.map((deck) => {
    const cards = collection.cards.filter((card) => card.deckId === deck.id);
    return {
      ...deck,
      total: cards.length,
      due: cards.filter((card) => isV3CardDue(card)).length,
      suspended: cards.filter((card) => card.suspended).length,
    };
  });

  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    sound.playTick();
    setIsImporting(true);
    try {
      const next = await importAnkiPackage(file);
      setCollection(next);
      setSelectedDeckId(next.decks[0]?.id || "");
      setActiveTab("decks");
      notify("success", `Imported ${file.name}: ${next.cards.length.toLocaleString()} total cards now in collection.`);
    } catch (error: any) {
      sound.playIncorrect();
      notify("error", error?.message || "Import failed.");
    } finally {
      setIsImporting(false);
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
    await persist(next);
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
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [activeTab, currentReviewCard, isBackShown]);

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

  const exportCollection = () => {
    const blob = new Blob([JSON.stringify(collection, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "kiroku-anki-v3-collection.json";
    link.click();
  };

  const statCardsStudied = collection.cards.filter((card) => (card.reps || card.fsrs?.reps || 0) > 0).length;
  const statMature = collection.cards.filter((card) => (card.fsrs?.scheduled_days || card.interval || 0) >= 21).length;

  return (
    <div className="bg-white border-2 border-zinc-900 rounded-[28px] p-4 sm:p-5 shadow-[5px_5px_0px_0px_rgba(0,0,0,1)] space-y-5">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b-2 border-zinc-100 pb-4">
        <div>
          <h3 className="text-lg font-black uppercase text-zinc-950 flex items-center gap-2">
            <Boxes className="h-5 w-5 text-indigo-600" />
            Anki Decks
          </h3>
          <p className="text-[11px] font-bold uppercase tracking-wide text-zinc-500 mt-1">
          Import, review, browse, edit, and manage full Anki packages with local media and FSRS scheduling.
          </p>
        </div>
        <div className="flex flex-col min-[520px]:flex-row gap-2">
          <label className={`px-3 py-2 rounded-xl border-2 border-zinc-900 bg-indigo-600 text-white text-xs font-black uppercase flex items-center justify-center gap-1.5 cursor-pointer shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] ${isImporting ? "opacity-60 pointer-events-none" : ""}`}>
            <Upload className="h-4 w-4" />
            {isImporting ? "Importing..." : "Import .apkg/.colpkg"}
            <input type="file" accept=".apkg,.colpkg" className="hidden" onChange={handleImport} disabled={isImporting} />
          </label>
          <button onClick={exportCollection} className="px-3 py-2 rounded-xl border-2 border-zinc-900 bg-white text-zinc-900 text-xs font-black uppercase flex items-center justify-center gap-1.5">
            <Download className="h-4 w-4" /> Export JSON
          </button>
        </div>
      </div>

      {notice && (
        <div className={`rounded-2xl border-2 px-3 py-2 text-xs font-bold ${notice.type === "success" ? "bg-emerald-50 border-emerald-300 text-emerald-900" : "bg-red-50 border-red-300 text-red-900"}`}>
          {notice.text}
        </div>
      )}

      <div className="grid grid-cols-2 min-[560px]:grid-cols-4 lg:grid-cols-9 gap-2">
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
            className={`px-2 py-2 rounded-xl border-2 text-[10px] font-black uppercase flex items-center justify-center gap-1.5 ${activeTab === id ? "bg-zinc-900 text-white border-zinc-900" : "bg-zinc-50 text-zinc-700 border-zinc-200"}`}
          >
            <Icon className="h-3.5 w-3.5" /> {label}
          </button>
        ))}
      </div>

      {activeTab === "decks" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <div className="lg:col-span-4 space-y-2 max-h-[520px] overflow-y-auto pr-1">
            {deckRows.length === 0 ? <EmptyState text="Import an Anki package to populate decks." /> : deckRows.map((deck) => (
              <button
                key={deck.id}
                onClick={() => setSelectedDeckId(deck.id)}
                className={`w-full text-left p-3 rounded-2xl border-2 ${selectedDeckId === deck.id ? "bg-indigo-50 border-indigo-900" : "bg-white border-zinc-200"}`}
              >
                <span className="block text-xs font-black uppercase text-zinc-900 break-words">{deck.name}</span>
                <span className="mt-2 flex gap-2 text-[10px] font-bold uppercase text-zinc-500">
                  <span>{deck.total} cards</span><span>{deck.due} due</span><span>{deck.suspended} suspended</span>
                </span>
              </button>
            ))}
          </div>
          <div className="lg:col-span-8 grid grid-cols-2 md:grid-cols-4 gap-3">
            <Metric label="Decks" value={collection.decks.length} />
            <Metric label="Notes" value={collection.notes.length} />
            <Metric label="Cards" value={collection.cards.length} />
            <Metric label="Media" value={collection.mediaManifest.length} />
            <Metric label="Due" value={dueCards.length} />
            <Metric label="Studied" value={statCardsStudied} />
            <Metric label="Mature" value={statMature} />
            <Metric label="Revlog" value={collection.reviewLogs.length} />
          </div>
        </div>
      )}

      {activeTab === "review" && (
        <div className="space-y-4">
          <DeckSelect collection={collection} selectedDeckId={selectedDeckId} setSelectedDeckId={setSelectedDeckId} />
          {!currentReviewCard || !renderedReview ? (
            <EmptyState text="Import an Anki package or choose a deck with cards to start review." />
          ) : (
            <div className="space-y-4">
              <div className="bg-white border-2 border-zinc-900 rounded-[24px] min-h-[340px] p-4 sm:p-6 flex flex-col justify-between">
                <div className="flex justify-between gap-2 text-[10px] font-black uppercase text-zinc-400">
                  <span>{collection.decks.find((deck) => deck.id === currentReviewCard.deckId)?.name || "Deck"}</span>
                  <span>{dueCards.length} due</span>
                </div>
                <div className="anki-card-render text-center my-6" dangerouslySetInnerHTML={{ __html: sanitizeTemplateHTML(isBackShown ? renderedReview.backHTML : renderedReview.frontHTML) }} />
                <style dangerouslySetInnerHTML={{ __html: renderedReview.css.replace(/^<style>|<\/style>$/g, "") }} />
                {!isBackShown ? (
                  <button onClick={() => setIsBackShown(true)} className="w-full py-3 rounded-2xl border-2 border-zinc-900 bg-zinc-900 text-white text-xs font-black uppercase">
                    Show Answer
                  </button>
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    {([1, 2, 3, 4] as AnkiGrade[]).map((grade) => {
                      const preview = previewFSRS(currentReviewCard, preset)[grade];
                      return (
                        <button key={grade} onClick={() => gradeCurrentCard(grade)} className={`py-3 rounded-2xl border-2 border-zinc-900 text-xs font-black uppercase ${grade === 1 ? "bg-red-300" : grade === 2 ? "bg-amber-300" : grade === 3 ? "bg-indigo-200" : "bg-emerald-300"}`}>
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
      )}

      {activeTab === "browser" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <div className="lg:col-span-5 space-y-3">
            <DeckSelect collection={collection} selectedDeckId={selectedDeckId} setSelectedDeckId={setSelectedDeckId} />
            <div className="flex gap-2">
              <input value={browserQuery} onChange={(e) => setBrowserQuery(e.target.value)} placeholder="Search fields, tags, deck..." className="flex-1 min-w-0 rounded-xl border-2 border-zinc-900 px-3 py-2 text-xs font-bold" />
              <select value={browserFilter} onChange={(e) => setBrowserFilter(e.target.value as BrowserFilter)} className="rounded-xl border-2 border-zinc-900 px-2 py-2 text-xs font-black uppercase">
                {["all", "due", "new", "learning", "review", "suspended", "buried", "flagged"].map((filter) => <option key={filter} value={filter}>{filter}</option>)}
              </select>
            </div>
            <div className="max-h-[520px] overflow-y-auto space-y-2 pr-1">
              {filteredCards.map((card) => (
                <button key={card.id} onClick={() => setSelectedCardId(card.id)} className={`w-full p-3 rounded-2xl border-2 text-left ${selectedCard?.id === card.id ? "bg-indigo-50 border-indigo-900" : "bg-white border-zinc-200"}`}>
                  <span className="block text-sm font-black text-zinc-900 truncate">{stripHTML(card.front || renderedPreview(collection, card, mediaUrls)?.frontHTML || "")}</span>
                  <span className="block text-[10px] font-bold text-zinc-500 mt-1 truncate">{collection.notes.find((note) => note.id === card.noteId)?.tags.map((tag) => `#${tag}`).join(" ")}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="lg:col-span-7 bg-zinc-50 border-2 border-zinc-900 rounded-[22px] p-4 space-y-4">
            {!selectedCard || !renderedSelected ? <EmptyState text="Select a card to inspect." /> : (
              <>
                <div className="flex flex-wrap gap-2 justify-between">
                  <div>
                    <span className="block text-[10px] font-black uppercase text-zinc-400">Selected Card</span>
                    <h4 className="text-lg font-black text-zinc-900">{renderedSelected.template?.name}</h4>
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
                      <div className="mt-2 text-sm text-zinc-700 break-words" dangerouslySetInnerHTML={{ __html: sanitizeTemplateHTML(value) }} />
                    </details>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {activeTab === "editor" && (
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
      )}

      {activeTab === "media" && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {collection.mediaManifest.length === 0 ? <EmptyState text="No imported media yet." /> : collection.mediaManifest.slice(0, 300).map((media) => (
            <div key={media.hash} className="bg-white border-2 border-zinc-200 rounded-2xl p-3 min-w-0">
              <div className="flex items-center gap-2">
                {media.contentType.startsWith("audio") ? <FileAudio className="h-4 w-4 text-indigo-600" /> : <FileImage className="h-4 w-4 text-emerald-600" />}
                <span className="text-xs font-black text-zinc-900 truncate">{media.fileName}</span>
              </div>
              <span className="block mt-1 text-[10px] font-mono text-zinc-400">{Math.round(media.bytes / 1024)} KB</span>
              {media.contentType.startsWith("audio") && mediaUrls[media.fileName] ? <audio controls src={mediaUrls[media.fileName]} className="mt-2 w-full" /> : null}
              {media.contentType.startsWith("image") && mediaUrls[media.fileName] ? <img src={mediaUrls[media.fileName]} alt="" className="mt-2 max-h-40 rounded-xl border border-zinc-200 mx-auto" /> : null}
            </div>
          ))}
        </div>
      )}

      {activeTab === "options" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Metric label="Scheduler" value="FSRS" />
          <Metric label="Desired Retention" value={`${Math.round(preset.desiredRetention * 100)}%`} />
          <Metric label="Max Interval" value={`${preset.maximumInterval}d`} />
          <Metric label="FSRS Params" value={preset.parameters.w.length} />
          <div className="md:col-span-2 bg-amber-50 border-2 border-amber-300 rounded-2xl p-3 text-xs font-bold text-amber-900">
            FSRS is active for all Anki review buttons. Parameter optimization UI is staged behind review-log accumulation.
          </div>
        </div>
      )}

      {activeTab === "custom" && (
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
      )}

      {activeTab === "stats" && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Metric label="Cards" value={collection.cards.length} />
          <Metric label="Due" value={collection.cards.filter((card) => isV3CardDue(card)).length} />
          <Metric label="Studied" value={statCardsStudied} />
          <Metric label="Mature" value={statMature} />
          <Metric label="Reviews" value={collection.reviewLogs.length} />
          <Metric label="Lapses" value={collection.cards.reduce((sum, card) => sum + (card.lapses || card.fsrs?.lapses || 0), 0)} />
          <Metric label="Media MB" value={(collection.mediaManifest.reduce((sum, media) => sum + media.bytes, 0) / 1024 / 1024).toFixed(1)} />
          <Metric label="Imports" value={collection.importReports.length} />
        </div>
      )}
    </div>
  );
};

const EmptyState: React.FC<{ text: string }> = ({ text }) => (
  <div className="bg-zinc-50 border-2 border-dashed border-zinc-300 rounded-2xl p-6 text-center text-[10px] font-black uppercase tracking-wide text-zinc-400">
    {text}
  </div>
);

const Metric: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="bg-white border-2 border-zinc-900 rounded-2xl p-3">
    <span className="block text-[9px] font-black uppercase tracking-wider text-zinc-400">{label}</span>
    <span className="block text-xl font-black text-zinc-900 mt-1 break-words">{value}</span>
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

function renderedPreview(collection: AnkiCollection, card: AnkiCard, mediaUrls: Record<string, string>) {
  return renderAnkiCard(collection, card, mediaUrls);
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

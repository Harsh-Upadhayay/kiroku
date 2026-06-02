import React, { useState, useEffect } from "react";
import { 
  AnkiDeck, 
  AnkiCard, 
  getAnkiDecks, 
  saveAnkiDecks, 
  getAnkiCards, 
  saveAnkiCards, 
  STARTER_ANKI_DECKS, 
  loadStarterDeck, 
  parseAnkiTextExport,
  formatIntervalLabel,
  normalizeAnkiCard,
  formatDueLabel,
  getAnkiCardState,
  getCardAllText,
  getCardMnemonic,
  getCardStrokeInfo,
  isAnkiCardDue,
  sanitizeHTML,
  stripHTML,
} from "../utils/anki-sm2";
import { sound } from "../utils/audio";
import { getSettingFromDB, saveSettingToDB } from "../utils/db";
import { 
  Plus, 
  Trash2, 
  Upload, 
  BookOpen, 
  Check, 
  Layers, 
  Cpu, 
  AlertCircle, 
  ArrowRight,
  Clipboard,
  FileText,
  Import,
  TrendingUp,
  Download,
  Search,
  Eye,
  Flag,
  PauseCircle,
  Archive,
  RotateCcw,
  Info
} from "lucide-react";

interface AnkiDeckManagerProps {
  onDecksChange?: () => void;
}

export const AnkiDeckManager: React.FC<AnkiDeckManagerProps> = ({ onDecksChange }) => {
  const [decks, setDecks] = useState<AnkiDeck[]>([]);
  const [cards, setCards] = useState<AnkiCard[]>([]);
  const [selectedDeckId, setSelectedDeckId] = useState<string>("");

  // Input states
  const [newDeckName, setNewDeckName] = useState<string>("");
  const [activeTab, setActiveTab] = useState<"preset" | "import" | "manual" | "apkg">("preset");
  const [isApkgUploading, setIsApkgUploading] = useState<boolean>(false);
  
  // Text Import state
  const [rawTextImport, setRawTextImport] = useState<string>("");
  const [customDeckName, setCustomDeckName] = useState<string>("");
  
  // Single card state
  const [manualFront, setManualFront] = useState<string>("");
  const [manualBack, setManualBack] = useState<string>("");

  const [browserQuery, setBrowserQuery] = useState<string>("");
  const [browserFilter, setBrowserFilter] = useState<"all" | "due" | "new" | "learning" | "review" | "suspended" | "buried" | "flagged">("all");
  const [selectedBrowserCardId, setSelectedBrowserCardId] = useState<string>("");

  const [notification, setNotification] = useState<{ type: "success" | "error"; msg: string } | null>(null);

  useEffect(() => {
    async function loadDecksAndCards() {
      const savedDecks = await getAnkiDecks();
      const savedCards = await getAnkiCards();
      setDecks(savedDecks);
      setCards(savedCards);
      
      if (savedDecks.length > 0) {
        setSelectedDeckId(savedDecks[0].id);
      }
    }
    loadDecksAndCards();
  }, []);

  const triggerNotify = (type: "success" | "error", msg: string) => {
    setNotification({ type, msg });
    setTimeout(() => {
      setNotification(null);
    }, 4000);
  };

  // 1. Install Starter Deck
  const handleLoadPresetDeck = async (presetId: string) => {
    sound.playTick();
    try {
      const { deck, cards: starterCards } = loadStarterDeck(presetId);
      
      // Prevent duplicates
      if (decks.some(d => d.id === deck.id)) {
        triggerNotify("error", "This starter deck is already installed!");
        return;
      }

      const nextDecks = [...decks, deck];
      const nextCards = [...cards, ...starterCards];

      setDecks(nextDecks);
      setCards(nextCards);
      setSelectedDeckId(deck.id);

      await saveAnkiDecks(nextDecks);
      await saveAnkiCards(nextCards);
      
      if (onDecksChange) onDecksChange();
      triggerNotify("success", `Installed "${deck.name}" with ${starterCards.length} cards!`);
    } catch (e: any) {
      triggerNotify("error", e.message || "Failed to parse starter deck");
    }
  };

  // 2. Create Empty Deck
  const handleCreateEmptyDeck = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDeckName.trim()) return;

    sound.playTick();
    const deckId = `deck-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const newDeck: AnkiDeck = {
      id: deckId,
      name: newDeckName.trim(),
      created: Date.now(),
      updatedAt: Date.now(),
    };

    const nextDecks = [...decks, newDeck];
    setDecks(nextDecks);
    setSelectedDeckId(deckId);
    setNewDeckName("");

    await saveAnkiDecks(nextDecks);
    if (onDecksChange) onDecksChange();
    triggerNotify("success", `Created deck "${newDeck.name}"!`);
  };

  // 3. Import from raw/copied plain text
  const handleImportText = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rawTextImport.trim()) {
      triggerNotify("error", "Please paste or write some card text first!");
      return;
    }

    sound.playTick();
    const deckName = customDeckName.trim() || `Imported Deck - ${new Date().toLocaleDateString()}`;
    const deckId = `deck-${Date.now()}`;
    
    // Parse
    const parsedCards = parseAnkiTextExport(rawTextImport, deckId);
    if (parsedCards.length === 0) {
      triggerNotify("error", "No valid card patterns found. Make sure front and back are separated by tabs, commas, or semicolons.");
      return;
    }

    const newDeck: AnkiDeck = {
      id: deckId,
      name: deckName,
      created: Date.now(),
    };

    const nextDecks = [...decks, newDeck];
    const nextCards = [...cards, ...parsedCards];

    setDecks(nextDecks);
    setCards(nextCards);
    setSelectedDeckId(deckId);
    
    setRawTextImport("");
    setCustomDeckName("");

    await saveAnkiDecks(nextDecks);
    await saveAnkiCards(nextCards);

    if (onDecksChange) onDecksChange();
    triggerNotify("success", `Successfully imported "${newDeck.name}" with ${parsedCards.length} cards!`);
  };

  // 4. File-Upload trigger
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const text = event.target?.result as string;
      if (!text) return;

      const deckName = file.name.replace(/\.[^/.]+$/, ""); // strip extension
      setCustomDeckName(deckName);
      setRawTextImport(text);
      setActiveTab("import");
      triggerNotify("success", `Loaded file "${file.name}". Click Import below to finalize!`);
    };
    reader.readAsText(file);
  };

  // 4b. APKG file reader and uploader
  const handleApkgUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith(".apkg")) {
      triggerNotify("error", "Please select a valid .apkg file!");
      return;
    }

    sound.playTick();
    setIsApkgUploading(true);
    triggerNotify("success", `Uploading and parsing "${file.name}" on the backend...`);

    try {
      const arrayBuffer = await file.arrayBuffer();
      const response = await fetch("/api/import-apkg", {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
        },
        body: arrayBuffer,
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(errJson.error || `Server error: ${response.status}`);
      }

      const data = await response.json();
      if (!data.success || !data.data || !data.data.cards) {
        throw new Error("Invalid response structural format from server.");
      }

      // We have the cards list! Let's import!
      const cardsToImport: any[] = data.data.cards;
      if (cardsToImport.length === 0) {
        triggerNotify("error", "No valid cards found in this APKG file.");
        setIsApkgUploading(false);
        return;
      }

      const uniqueDeckNames = Array.from(new Set(cardsToImport.map(c => c.deckName))) as string[];
      const createdDecksMap: Record<string, string> = {}; 

      const nextDecks = [...decks];
      uniqueDeckNames.forEach(name => {
        const existing = decks.find(d => d.name.toLowerCase() === name.toLowerCase());
        if (existing) {
          createdDecksMap[name] = existing.id;
        } else {
          const newId = `deck-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
          nextDecks.push({
            id: newId,
            name: name,
            created: Date.now(),
            updatedAt: Date.now(),
          });
          createdDecksMap[name] = newId;
        }
      });

      const mappedCards: AnkiCard[] = cardsToImport.map((c: any, index) => {
        const deckId = createdDecksMap[c.deckName] || selectedDeckId || `deck-import-${Date.now()}`;

        // Ensure front/back and fields are strings to avoid runtime errors
        const front = c.front == null ? "" : String(c.front);
        const back = c.back == null ? "" : String(c.back);

        const rawFields = Array.isArray(c.rawFields) ? c.rawFields.map((f: any) => (f == null ? "" : String(f))) : [];

        const fieldsObj: Record<string, string> = {};
        if (c.fields && typeof c.fields === "object") {
          Object.entries(c.fields).forEach(([k, v]) => {
            fieldsObj[k] = v == null ? "" : String(v);
          });
        }

        return normalizeAnkiCard({
          id: `anki-card-apkg-${deckId}-${index}-${Math.floor(Math.random() * 100000)}`,
          deckId,
          front,
          back,
          noteId: c.noteId,
          modelName: c.modelName,
          fieldOrder: Array.isArray(c.fieldOrder) ? c.fieldOrder.map(String) : undefined,
          fields: Object.keys(fieldsObj).length ? fieldsObj : undefined,
          rawFields: rawFields.length ? rawFields : undefined,
          mnemonic: c.mnemonic == null ? undefined : String(c.mnemonic),
          strokeInfo: c.strokeInfo == null ? undefined : String(c.strokeInfo),
          strokeCount: typeof c.strokeCount === "number" ? c.strokeCount : undefined,
          tags: Array.isArray(c.tags) ? c.tags.map(String) : [],
          added: c.added || Date.now(),
          updatedAt: Date.now(),
          flag: 0,
          suspended: false,
          ease: 2.5,
          interval: 0,
          reps: 0,
          lapses: 0,
          nextReview: Date.now(),
          status: "new",
        });
      });

      const nextCards = [...cards, ...mappedCards];
      setDecks(nextDecks);
      setCards(nextCards);
      
      if (uniqueDeckNames.length > 0) {
        const firstDeckId = createdDecksMap[uniqueDeckNames[0]];
        if (firstDeckId) setSelectedDeckId(firstDeckId);
      }

      await saveAnkiDecks(nextDecks);
      await saveAnkiCards(nextCards);

      if (onDecksChange) onDecksChange();
      triggerNotify("success", `Processed APKG: Imported ${uniqueDeckNames.length} decks with ${mappedCards.length} cards total!`);
    } catch (err: any) {
      console.error(err);
      sound.playIncorrect();
      triggerNotify("error", err.message || "Failed to process APKG file on server.");
    } finally {
      setIsApkgUploading(false);
    }
  };

  // 5. Add Single Manual Card
  const handleAddManualCard = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDeckId) {
      triggerNotify("error", "Please create or select an active deck first!");
      return;
    }
    if (!manualFront.trim() || !manualBack.trim()) {
      triggerNotify("error", "Both card Front and Back fields are required!");
      return;
    }

    sound.playTick();
    const newCard: AnkiCard = {
      id: `anki-card-manual-${Date.now()}-${Math.floor(Math.random()*1000)}`,
      deckId: selectedDeckId,
      front: manualFront.trim(),
      back: manualBack.trim(),
      fields: { Front: manualFront.trim(), Back: manualBack.trim() },
      fieldOrder: ["Front", "Back"],
      rawFields: [manualFront.trim(), manualBack.trim()],
      added: Date.now(),
      updatedAt: Date.now(),
      flag: 0,
      suspended: false,
      ease: 2.5,
      interval: 0,
      reps: 0,
      lapses: 0,
      nextReview: Date.now(),
      status: "new",
    };

    const nextCards = [...cards, newCard];
    setCards(nextCards);
    setManualFront("");
    setManualBack("");

    await saveAnkiCards(nextCards);
    if (onDecksChange) onDecksChange();
    triggerNotify("success", "Added 1 custom card to selected deck!");
  };

  // 6. Delete deck and associated cards
  const handleDeleteDeck = async (deckId: string) => {
    sound.playIncorrect();
    const deckToDelete = decks.find(d => d.id === deckId);
    if (!deckToDelete) return;

    if (!window.confirm(`Are you sure you want to delete "${deckToDelete.name}" and all of its cards?`)) {
      return;
    }

    const nextDecks = decks.filter(d => d.id !== deckId);
    const nextCards = cards.filter(c => c.deckId !== deckId);
    const deletedDeckIds = await getSettingFromDB<string[]>("deleted_deck_ids", []);
    await saveSettingToDB("deleted_deck_ids", Array.from(new Set([...deletedDeckIds, deckId])));

    setDecks(nextDecks);
    setCards(nextCards);
    
    if (nextDecks.length > 0) {
      setSelectedDeckId(nextDecks[0].id);
    } else {
      setSelectedDeckId("");
    }

    await saveAnkiDecks(nextDecks);
    await saveAnkiCards(nextCards);

    if (onDecksChange) onDecksChange();
    triggerNotify("success", `Deleted "${deckToDelete.name}" successfully.`);
  };

  const persistCards = async (nextCards: AnkiCard[]) => {
    setCards(nextCards);
    await saveAnkiCards(nextCards);
    if (onDecksChange) onDecksChange();
  };

  const updateCard = async (cardId: string, updater: (card: AnkiCard) => AnkiCard) => {
    const nextCards = cards.map((card) => (card.id === cardId ? { ...updater(card), updatedAt: Date.now() } : card));
    await persistCards(nextCards);
  };

  const selectedDeckCards = selectedDeckId ? cards.filter((card) => card.deckId === selectedDeckId) : [];
  const filteredBrowserCards = selectedDeckCards.filter((card) => {
    const state = getAnkiCardState(card);
    const matchesFilter =
      browserFilter === "all" ||
      (browserFilter === "due" && isAnkiCardDue(card)) ||
      (browserFilter === "flagged" && !!card.flag) ||
      state === browserFilter;
    const query = browserQuery.trim().toLowerCase();
    const matchesQuery = !query || getCardAllText(card).includes(query);
    return matchesFilter && matchesQuery;
  });
  const selectedBrowserCard =
    filteredBrowserCards.find((card) => card.id === selectedBrowserCardId) ||
    filteredBrowserCards[0] ||
    selectedDeckCards[0];
  const selectedMnemonic = selectedBrowserCard ? getCardMnemonic(selectedBrowserCard) : "";
  const selectedStroke = selectedBrowserCard ? getCardStrokeInfo(selectedBrowserCard) : "";
  const selectedFieldEntries = selectedBrowserCard
    ? (selectedBrowserCard.fieldOrder || Object.keys(selectedBrowserCard.fields || {})).map((name) => [
        name,
        selectedBrowserCard.fields?.[name] || "",
      ] as const).filter(([, value]) => stripHTML(value))
    : [];

  // 7. Dynamic stats calculations
  const deckStats = decks.map(d => {
    const deckCards = cards.filter(c => c.deckId === d.id);
    const total = deckCards.length;
    const due = deckCards.filter(c => c.nextReview <= Date.now()).length;
    const learned = deckCards.filter(c => c.reps > 0).length;
    return {
      ...d,
      total,
      due,
      learned
    };
  });

  const RichField: React.FC<{ html?: string; className?: string }> = ({ html, className }) => (
    <div
      className={`prose prose-sm max-w-none text-zinc-700 [&_img]:max-w-full [&_img]:rounded-xl [&_img]:border [&_img]:border-zinc-200 ${className || ""}`}
      dangerouslySetInnerHTML={{ __html: sanitizeHTML(html || "") }}
    />
  );

  return (
    <div className="bg-white rounded-[32px] border-2 border-zinc-900 p-5 sm:p-6 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] space-y-6">
      
      {/* Importer Title */}
      <div className="border-b-2 border-zinc-150 pb-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-black text-zinc-900 flex items-center gap-2 uppercase">
            <Import className="h-5 w-5 text-indigo-600" />
            Kiroku Deck Center
          </h3>
          <p className="text-xs text-zinc-400 font-bold uppercase tracking-wider mt-0.5">
            Import, view, and schedule custom Anki Decks with native SM-2 spaced repetition algorithms.
          </p>
        </div>

        {/* File input styled container */}
        <label className="w-full md:w-auto py-2 px-3.5 bg-zinc-100 hover:bg-zinc-200 text-zinc-900 rounded-xl border-2 border-zinc-900 text-xs font-black uppercase tracking-wider transition-all cursor-pointer shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] active:translate-y-0.5 flex items-center justify-center gap-1.5 shrink-0 text-center">
          <Upload className="h-3.5 w-3.5" />
          Upload Anki Text (.txt / .csv)
          <input 
            type="file" 
            accept=".txt,.csv,.tsv" 
            onChange={handleFileUpload} 
            className="hidden" 
          />
        </label>
      </div>

      {notification && (
        <div className={`p-4 rounded-2xl border-2 font-bold text-xs flex items-center gap-2 ${
          notification.type === "success" 
            ? "bg-emerald-50 text-emerald-900 border-emerald-300"
            : "bg-red-50 text-red-900 border-red-300"
        }`}>
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{notification.msg}</span>
        </div>
      )}

      {/* Main layout: left side managers, right side existing list */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Side: Create/Loader Panel */}
        <div className="lg:col-span-7 bg-zinc-50 border-2 border-zinc-900 rounded-[24px] p-4 sm:p-5 space-y-5">
          {/* Sub tabs */}
          <div className="flex border-b border-zinc-200 overflow-x-auto">
            {[
              { id: "preset", label: "Starter Decks", icon: BookOpen },
              { id: "import", label: "Raw Copy-Paste", icon: FileText },
              { id: "apkg", label: "Anki APKG", icon: Layers },
              { id: "manual", label: "Add Manual Card", icon: Plus }
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => {
                  sound.playTick();
                  setActiveTab(tab.id as any);
                }}
                className={`flex-1 min-w-[64px] py-2 text-[10px] sm:text-xs font-black uppercase tracking-wider border-b-2 transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                  activeTab === tab.id 
                    ? "border-zinc-950 text-zinc-950" 
                    : "border-transparent text-zinc-400 hover:text-zinc-650 hover:text-zinc-600"
                }`}
              >
                <tab.icon className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{tab.label}</span>
              </button>
            ))}
          </div>

          {/* TAB CONTENT 1: Presets */}
          {activeTab === "preset" && (
            <div className="space-y-4">
              <p className="text-[11px] font-extrabold text-zinc-400 uppercase tracking-widest leading-normal">
                Do not have an Anki deck export handy? Install one of these polished preset Japanese decks in 1-click to test the scheduler immediately:
              </p>

              <div className="space-y-2.5">
                {STARTER_ANKI_DECKS.map(p => {
                  const alreadyHave = decks.some(d => d.id === p.id);
                  return (
                    <div 
                      key={p.id} 
                      className="p-3 bg-white border-2 border-zinc-900 rounded-xl flex flex-col min-[420px]:flex-row min-[420px]:items-center min-[420px]:justify-between gap-3"
                    >
                      <div>
                        <span className="text-xs font-black text-zinc-900 uppercase block">{p.name}</span>
                        <span className="text-[10px] font-semibold text-zinc-400 block mt-0.5">
                          {p.cards.length} structured cards (Vocalized & Explained)
                        </span>
                      </div>
                      <button
                        onClick={() => handleLoadPresetDeck(p.id)}
                        disabled={alreadyHave}
                        className={`w-full min-[420px]:w-auto py-1.5 px-3 rounded-xl border-2 text-[10px] font-black uppercase tracking-wider transition-all flex items-center justify-center gap-1 cursor-pointer ${
                          alreadyHave 
                            ? "bg-zinc-100 text-zinc-400 border-zinc-200 cursor-not-allowed shadow-none" 
                            : "bg-indigo-500 hover:bg-indigo-650 text-white border-zinc-900 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] active:translate-y-0.5"
                        }`}
                      >
                        {alreadyHave ? <Check className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
                        {alreadyHave ? "Installed" : "Install"}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB CONTENT 2: Import Code-Text */}
          {activeTab === "import" && (
            <form onSubmit={handleImportText} className="space-y-4">
              <p className="text-[11px] font-extrabold text-zinc-400 uppercase tracking-widest leading-loose">
                Supports copy-pasted Anki plain text notes export or comma-separated pairs:
                <br />
                <code className="bg-zinc-200 px-1 py-0.5 text-zinc-800 rounded font-mono text-[9px] lowercase">
                  FrontText [tab / comma / semicolon] BackText
                </code>
              </p>

              <div className="space-y-2.5">
                <div>
                  <label className="text-[10px] font-black uppercase tracking-wider text-zinc-500 block mb-1">
                    Deck Label Name:
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. JLPT N4 Verbs..."
                    value={customDeckName}
                    onChange={(e) => setCustomDeckName(e.target.value)}
                    className="w-full bg-white border-2 border-zinc-900 rounded-xl px-3 py-2 text-xs font-bold text-zinc-800"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-black uppercase tracking-wider text-zinc-500 block mb-1">
                    Paste Deck Content Here:
                  </label>
                  <textarea
                    rows={4}
                    placeholder={`猫\tCat (Neko)\n犬\tDog (Inu)\n食べる\tTo eat`}
                    value={rawTextImport}
                    onChange={(e) => setRawTextImport(e.target.value)}
                    className="w-full bg-white border-2 border-zinc-900 rounded-xl p-3 text-xs font-mono text-zinc-800"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-black uppercase tracking-wider rounded-xl border-2 border-zinc-900 text-xs shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] active:translate-y-0.5 cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <Upload className="h-4 w-4" />
                  Import Into Database
                </button>
              </div>
            </form>
          )}

          {/* TAB CONTENT 3: Add manually */}
          {activeTab === "manual" && (
            <form onSubmit={handleAddManualCard} className="space-y-4">
              <p className="text-[11px] font-extrabold text-zinc-400 uppercase tracking-widest">
                Add a customized single card to the selected deck container:
              </p>

              <div className="space-y-3">
                <div>
                  <label className="text-[10px] font-black uppercase tracking-wider text-zinc-500 block mb-1">
                    Selected deck destination:
                  </label>
                  <select
                    value={selectedDeckId}
                    onChange={(e) => setSelectedDeckId(e.target.value)}
                    className="w-full bg-white border-2 border-zinc-900 rounded-xl px-3 py-2 text-xs font-bold text-zinc-800"
                  >
                    <option value="">-- Choose Target Deck --</option>
                    {decks.map(d => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-wider text-zinc-500 block mb-1">
                      Front Side (Character/Question):
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. 林檎"
                      value={manualFront}
                      onChange={(e) => setManualFront(e.target.value)}
                      className="w-full bg-white border-2 border-zinc-900 rounded-xl px-3 py-2.5 text-xs font-black text-zinc-800"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-wider text-zinc-500 block mb-1">
                      Back Side (Answer/Meaning):
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Apple (Ringo)"
                      value={manualBack}
                      onChange={(e) => setManualBack(e.target.value)}
                      className="w-full bg-white border-2 border-zinc-900 rounded-xl px-3 py-2.5 text-xs font-bold text-zinc-800"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  className="w-full py-2.5 bg-zinc-900 hover:bg-zinc-800 text-white font-black uppercase tracking-wider rounded-xl border-2 border-zinc-900 text-xs shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] active:translate-y-0.5 cursor-pointer flex items-center justify-center gap-1"
                >
                  <Plus className="h-4 w-4" /> Add Card to Deck
                </button>
              </div>
            </form>
          )}

          {/* TAB CONTENT 4: Import .apkg binary files */}
          {activeTab === "apkg" && (
            <div className="space-y-4">
              <div className="p-4 bg-indigo-50 border-2 border-indigo-900 rounded-2xl">
                <p className="text-[11px] font-black text-indigo-900 uppercase tracking-wide leading-relaxed">
                  High-Performance SQLite Parsing Enabled
                </p>
                <p className="text-[11px] font-bold text-indigo-700/90 mt-1 leading-relaxed">
                  Upload any standard packaged Anki deck (<code className="bg-indigo-100 px-1 py-0.5 rounded font-mono font-black text-[10px]">.apkg</code> file). 
                  Our server will unzip, read the sqlite database, convert HTML tags, extract cards, mapping schemas, and load them instantly into your local progress repository.
                </p>
              </div>

              <div className="space-y-4">
                <label className={`border-2 border-dashed border-zinc-400 rounded-2xl p-6 flex flex-col items-center justify-center text-center cursor-pointer hover:bg-zinc-100/50 transition-all ${isApkgUploading ? "opacity-50 pointer-events-none" : ""}`}>
                  <Upload className="h-8 w-8 text-indigo-600 animate-bounce mb-2" />
                  <span className="text-xs font-black text-zinc-800 uppercase block">
                    {isApkgUploading ? "Processing APKG on Backend..." : "Select Anki .apkg File"}
                  </span>
                  <span className="text-[10px] font-bold text-zinc-400 block mt-1 uppercase">
                    Drag and drop file or click to browse
                  </span>
                  <input
                    type="file"
                    accept=".apkg"
                    onChange={handleApkgUpload}
                    className="hidden"
                    disabled={isApkgUploading}
                  />
                </label>

                {isApkgUploading && (
                  <div className="p-3 bg-zinc-100 border border-zinc-200 rounded-xl flex items-center justify-center gap-2 text-xs font-bold text-zinc-500 uppercase">
                    <div className="animate-spin h-4 w-4 border-2 border-indigo-600 border-t-transparent rounded-full" />
                    Connecting to server & extracting deck SQLite db...
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Quick empty deck option */}
          <div className="border-t border-dashed border-zinc-200 pt-4 mt-3">
            <form onSubmit={handleCreateEmptyDeck} className="flex flex-col min-[420px]:flex-row gap-2">
              <input
                type="text"
                placeholder="Or create empty deck..."
                value={newDeckName}
                onChange={(e) => setNewDeckName(e.target.value)}
                className="flex-1 bg-white border-2 border-zinc-900 rounded-xl px-3 py-2 text-xs font-bold placeholder:text-zinc-300 text-zinc-800 min-w-0"
              />
              <button
                type="submit"
                disabled={!newDeckName.trim()}
                className="py-2 px-3 bg-zinc-100 hover:bg-zinc-200 text-zinc-900 rounded-xl border-2 border-zinc-900 text-xs font-black uppercase tracking-wide transition-all shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] cursor-pointer active:translate-y-0.5 disabled:opacity-50"
              >
                Create
              </button>
            </form>
          </div>
        </div>

        {/* Right Side: Existing Importer List */}
        <div className="lg:col-span-5 space-y-4">
          <div className="text-zinc-500 text-[10px] font-black uppercase tracking-wide">
            Your Installed Decks:
          </div>

          {deckStats.length === 0 ? (
            <div className="text-center py-10 bg-zinc-50 border-2 border-dashed border-zinc-300 rounded-2xl flex flex-col justify-center items-center">
              <Layers className="h-8 w-8 text-zinc-300" />
              <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mt-2.5 max-w-[200px]">
                No custom decks imported yet. Select the "Starter Decks" tab to install a preset in 1-click!
              </p>
            </div>
          ) : (
            <div className="space-y-3 max-h-[360px] overflow-y-auto pr-1">
              {deckStats.map(d => (
                <div 
                  key={d.id} 
                  className={`p-3.5 rounded-2xl border-2 flex flex-col justify-between gap-3 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] transition-colors ${
                    selectedDeckId === d.id 
                      ? "bg-indigo-50 border-indigo-900" 
                      : "bg-white border-zinc-900"
                  }`}
                >
                  <div className="flex items-start justify-between min-w-0">
                    <button
                      onClick={() => {
                        sound.playTick();
                        setSelectedDeckId(d.id);
                      }}
                      className="text-left font-black text-xs text-zinc-900 flex items-center gap-1.5 uppercase hover:text-indigo-600 truncate mr-2"
                    >
                      <Layers className="h-3.5 w-3.5 text-zinc-650 shrink-0" />
                      <span className="truncate">{d.name}</span>
                    </button>
                    <button
                      onClick={() => handleDeleteDeck(d.id)}
                      className="text-zinc-400 hover:text-red-650 tracking-wider focus:outline-none transition-colors"
                      title="Delete deck"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {/* Micro dashboard layout status metrics */}
                  <div className="grid grid-cols-3 gap-1 bg-zinc-50 border-2 border-zinc-900/6 border-zinc-200 py-1.5 px-2 rounded-xl text-center font-mono">
                    <div className="border-r border-zinc-200">
                      <span className="text-[11px] font-extrabold text-zinc-800 block leading-tight">{d.total}</span>
                      <span className="text-[8px] text-zinc-400 block uppercase leading-none font-sans font-bold">CARDS</span>
                    </div>
                    <div className="border-r border-zinc-200">
                      <span className="text-[11px] font-extrabold text-[#7c3aed] block leading-tight">{d.due}</span>
                      <span className="text-[8px] text-[#8b5cf6]/70 block uppercase leading-none font-sans font-bold">DUE</span>
                    </div>
                    <div>
                      <span className="text-[11px] font-extrabold text-emerald-600 block leading-tight">{d.learned}</span>
                      <span className="text-[8px] text-emerald-600/75 block uppercase leading-none font-sans font-bold">STUDIED</span>
                    </div>
                  </div>

                  {/* Export Trigger */}
                  <div className="flex flex-col min-[420px]:flex-row min-[420px]:justify-between min-[420px]:items-center gap-2 text-[9px] font-extrabold font-mono text-zinc-400">
                    <span>Created: {new Date(d.created).toLocaleDateString()}</span>
                    <button
                      onClick={() => {
                        sound.playTick();
                        const deckCards = cards.filter(c => c.deckId === d.id);
                        const exportedText = deckCards.map(c => `${c.front}\t${c.back}`).join("\n");
                        const blob = new Blob([exportedText], { type: "text/plain;charset=utf-8" });
                        const link = document.createElement("a");
                        link.href = URL.createObjectURL(blob);
                        link.download = `${d.name.toLowerCase().replace(/\s+/g, "_")}_anki_export.txt`;
                        link.click();
                      }}
                      className="text-indigo-600 hover:text-indigo-805 hover:underline flex items-center gap-1 font-sans font-black"
                    >
                      <Download className="h-3 w-3" /> EXPORT DECK
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Anki-style browser and learner panels */}
      <div className="border-2 border-zinc-900 rounded-[24px] p-4 sm:p-5 bg-zinc-50 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div>
            <h4 className="text-sm font-black text-zinc-900 uppercase tracking-wide flex items-center gap-2">
              <Search className="h-4 w-4 text-indigo-600" />
              Card Browser & RRTK Details
            </h4>
            <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mt-1">
              Search all imported note fields, inspect mnemonics/strokes, and manage card state.
            </p>
          </div>
          <div className="grid grid-cols-2 min-[520px]:grid-cols-4 gap-2 text-center">
            <div className="bg-white border-2 border-zinc-900 rounded-xl px-3 py-2">
              <span className="block text-sm font-black font-mono">{selectedDeckCards.length}</span>
              <span className="block text-[8px] font-black uppercase text-zinc-400">Cards</span>
            </div>
            <div className="bg-white border-2 border-zinc-900 rounded-xl px-3 py-2">
              <span className="block text-sm font-black font-mono text-indigo-600">{selectedDeckCards.filter((card) => isAnkiCardDue(card)).length}</span>
              <span className="block text-[8px] font-black uppercase text-zinc-400">Due</span>
            </div>
            <div className="bg-white border-2 border-zinc-900 rounded-xl px-3 py-2">
              <span className="block text-sm font-black font-mono text-amber-600">{selectedDeckCards.filter((card) => card.suspended).length}</span>
              <span className="block text-[8px] font-black uppercase text-zinc-400">Suspended</span>
            </div>
            <div className="bg-white border-2 border-zinc-900 rounded-xl px-3 py-2">
              <span className="block text-sm font-black font-mono text-red-600">{selectedDeckCards.filter((card) => !!card.flag).length}</span>
              <span className="block text-[8px] font-black uppercase text-zinc-400">Flagged</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <div className="lg:col-span-5 space-y-3">
            <div className="flex flex-col min-[520px]:flex-row gap-2">
              <input
                value={browserQuery}
                onChange={(e) => setBrowserQuery(e.target.value)}
                placeholder="Search kanji, keyword, story, tag..."
                className="flex-1 min-w-0 bg-white border-2 border-zinc-900 rounded-xl px-3 py-2 text-xs font-bold text-zinc-900 placeholder:text-zinc-300"
              />
              <select
                value={browserFilter}
                onChange={(e) => setBrowserFilter(e.target.value as any)}
                className="bg-white border-2 border-zinc-900 rounded-xl px-3 py-2 text-xs font-black uppercase text-zinc-800"
              >
                <option value="all">All</option>
                <option value="due">Due</option>
                <option value="new">New</option>
                <option value="learning">Learning</option>
                <option value="review">Review</option>
                <option value="suspended">Suspended</option>
                <option value="buried">Buried</option>
                <option value="flagged">Flagged</option>
              </select>
            </div>

            <div className="max-h-[440px] overflow-y-auto space-y-2 pr-1">
              {filteredBrowserCards.length === 0 ? (
                <div className="bg-white border-2 border-dashed border-zinc-300 rounded-2xl p-6 text-center text-[10px] font-black uppercase tracking-wider text-zinc-400">
                  No cards match this search.
                </div>
              ) : (
                filteredBrowserCards.map((card) => {
                  const state = getAnkiCardState(card);
                  const active = selectedBrowserCard?.id === card.id;
                  return (
                    <button
                      key={card.id}
                      onClick={() => {
                        sound.playTick();
                        setSelectedBrowserCardId(card.id);
                      }}
                      className={`w-full p-3 rounded-2xl border-2 text-left transition-all ${
                        active ? "bg-indigo-50 border-indigo-900 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]" : "bg-white border-zinc-900"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <span className="block text-lg font-black text-zinc-900 leading-tight truncate">{card.front}</span>
                          <span className="block text-[10px] font-bold text-zinc-500 truncate mt-1">{stripHTML(card.back)}</span>
                        </div>
                        <span className={`text-[8px] font-black uppercase rounded-lg border px-1.5 py-0.5 shrink-0 ${
                          state === "due" ? "bg-indigo-100 text-indigo-800 border-indigo-300" :
                          state === "new" ? "bg-emerald-100 text-emerald-800 border-emerald-300" :
                          state === "suspended" ? "bg-zinc-200 text-zinc-700 border-zinc-300" :
                          state === "buried" ? "bg-amber-100 text-amber-800 border-amber-300" :
                          "bg-white text-zinc-500 border-zinc-300"
                        }`}>
                          {state}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[9px] font-black uppercase text-zinc-400">
                        {card.flag ? <span className="text-red-600">Flag {card.flag}</span> : null}
                        <span>Due {formatDueLabel(card.nextReview)}</span>
                        <span>Ease {card.ease}x</span>
                        {card.tags?.slice(0, 2).map((tag) => <span key={tag}>#{tag}</span>)}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          <div className="lg:col-span-7 bg-white border-2 border-zinc-900 rounded-[20px] p-4 space-y-4 min-w-0">
            {!selectedBrowserCard ? (
              <div className="py-12 text-center text-[10px] font-black uppercase tracking-wider text-zinc-400">
                Select or import a deck to inspect cards.
              </div>
            ) : (
              <>
                <div className="flex flex-col min-[560px]:flex-row min-[560px]:items-start justify-between gap-3">
                  <div className="min-w-0">
                    <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400 block">Selected card</span>
                    <h5 className="text-3xl font-black text-zinc-900 leading-tight break-words">{selectedBrowserCard.front}</h5>
                    <p className="text-sm font-bold text-zinc-600 mt-1 break-words">{stripHTML(selectedBrowserCard.back)}</p>
                  </div>
                  <div className="flex flex-wrap gap-2 shrink-0">
                    <button
                      onClick={() => updateCard(selectedBrowserCard.id, (card) => ({ ...card, suspended: !card.suspended }))}
                      className="px-3 py-2 rounded-xl border-2 border-zinc-900 bg-zinc-100 text-zinc-900 text-[10px] font-black uppercase flex items-center gap-1.5"
                    >
                      <PauseCircle className="h-3.5 w-3.5" />
                      {selectedBrowserCard.suspended ? "Unsuspend" : "Suspend"}
                    </button>
                    <button
                      onClick={() => updateCard(selectedBrowserCard.id, (card) => ({ ...card, buriedUntil: Date.now() + 24 * 60 * 60 * 1000 }))}
                      className="px-3 py-2 rounded-xl border-2 border-zinc-900 bg-amber-100 text-zinc-900 text-[10px] font-black uppercase flex items-center gap-1.5"
                    >
                      <Archive className="h-3.5 w-3.5" />
                      Bury 1d
                    </button>
                    <button
                      onClick={() => updateCard(selectedBrowserCard.id, (card) => ({ ...card, flag: card.flag ? 0 : 1 }))}
                      className="px-3 py-2 rounded-xl border-2 border-zinc-900 bg-red-100 text-zinc-900 text-[10px] font-black uppercase flex items-center gap-1.5"
                    >
                      <Flag className="h-3.5 w-3.5" />
                      {selectedBrowserCard.flag ? "Unflag" : "Flag"}
                    </button>
                    <button
                      onClick={() => updateCard(selectedBrowserCard.id, (card) => ({
                        ...card,
                        status: "new",
                        reps: 0,
                        lapses: 0,
                        interval: 0,
                        nextReview: Date.now(),
                        buriedUntil: undefined,
                      }))}
                      className="px-3 py-2 rounded-xl border-2 border-zinc-900 bg-white text-zinc-900 text-[10px] font-black uppercase flex items-center gap-1.5"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      Reset
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 min-[560px]:grid-cols-4 gap-2">
                  <div className="rounded-xl bg-zinc-50 border border-zinc-200 p-2">
                    <span className="block text-[8px] font-black uppercase text-zinc-400">State</span>
                    <span className="block text-xs font-black uppercase text-zinc-900">{getAnkiCardState(selectedBrowserCard)}</span>
                  </div>
                  <div className="rounded-xl bg-zinc-50 border border-zinc-200 p-2">
                    <span className="block text-[8px] font-black uppercase text-zinc-400">Due</span>
                    <span className="block text-xs font-black uppercase text-zinc-900">{formatDueLabel(selectedBrowserCard.nextReview)}</span>
                  </div>
                  <div className="rounded-xl bg-zinc-50 border border-zinc-200 p-2">
                    <span className="block text-[8px] font-black uppercase text-zinc-400">Interval</span>
                    <span className="block text-xs font-black uppercase text-zinc-900">{formatIntervalLabel(selectedBrowserCard.interval)}</span>
                  </div>
                  <div className="rounded-xl bg-zinc-50 border border-zinc-200 p-2">
                    <span className="block text-[8px] font-black uppercase text-zinc-400">Reviews</span>
                    <span className="block text-xs font-black uppercase text-zinc-900">{selectedBrowserCard.reps} reps / {selectedBrowserCard.lapses} lapses</span>
                  </div>
                </div>

                {(selectedMnemonic || selectedStroke || selectedBrowserCard.strokeCount) && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {selectedMnemonic && (
                      <div className="rounded-2xl border-2 border-emerald-300 bg-emerald-50 p-4">
                        <span className="text-[10px] font-black uppercase tracking-widest text-emerald-700 flex items-center gap-1.5">
                          <Info className="h-3.5 w-3.5" /> Mnemonic / Story
                        </span>
                        <RichField html={selectedMnemonic} className="mt-2" />
                      </div>
                    )}
                    {(selectedStroke || selectedBrowserCard.strokeCount) && (
                      <div className="rounded-2xl border-2 border-indigo-300 bg-indigo-50 p-4">
                        <span className="text-[10px] font-black uppercase tracking-widest text-indigo-700 flex items-center gap-1.5">
                          <Eye className="h-3.5 w-3.5" /> Stroke Info
                        </span>
                        {selectedBrowserCard.strokeCount ? (
                          <span className="inline-block mt-2 mb-2 text-[10px] font-black uppercase bg-white border border-indigo-200 rounded-lg px-2 py-1 text-indigo-900">
                            {selectedBrowserCard.strokeCount} strokes
                          </span>
                        ) : null}
                        <RichField html={selectedStroke} className="mt-2" />
                      </div>
                    )}
                  </div>
                )}

                {selectedFieldEntries.length > 0 && (
                  <div className="space-y-2">
                    <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400 block">All imported note fields</span>
                    <div className="grid grid-cols-1 gap-2">
                      {selectedFieldEntries.map(([name, value]) => (
                        <details key={name} className="bg-zinc-50 border border-zinc-200 rounded-xl p-3" open={/(mnemonic|story|stroke|keyword|kanji)/i.test(name)}>
                          <summary className="cursor-pointer text-[10px] font-black uppercase tracking-wider text-zinc-700">{name}</summary>
                          <RichField html={value} className="mt-2" />
                        </details>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

import React, { useState, useEffect } from "react";
import { KANA_DATA, KANA_GROUPS, KANA_SCRIPTS, KanaScript, SRSCard, getScriptLabel } from "../types";
import { normalizeActiveRows, saveActiveRows, resetAllData } from "../utils/srs";
import { sound } from "../utils/audio";
import { Check, ToggleLeft, Activity, Grid, Compass, RefreshCcw, HelpCircle, AlertTriangle } from "lucide-react";
import { motion } from "motion/react";
import { AnkiDeckManager } from "./AnkiDeckManager";

interface CharDictionaryProps {
  cards: SRSCard[];
  activeRows: string[];
  onActiveRowsUpdate: (rows: string[]) => void;
  onResetDatabase: () => void;
}

export const CharDictionary: React.FC<CharDictionaryProps> = ({
  cards,
  activeRows,
  onActiveRowsUpdate,
  onResetDatabase,
}) => {
  const [showResetConfirm, setShowResetConfirm] = useState<boolean>(false);
  const [reviewLogs, setReviewLogs] = useState<any[]>([]);
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);

  // Online/Offline status listeners
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Fetch log audits dynamically from IndexedDB
  useEffect(() => {
    async function fetchLogs() {
      try {
        const { getReviewActionsFromDB } = await import("../utils/db");
        const storedActions = await getReviewActionsFromDB();
        // Sort newest first, take last 50 entries
        setReviewLogs(storedActions.reverse().slice(0, 50));
      } catch (err) {
        console.warn("Could not retrieve IndexedDB logs", err);
      }
    }
    fetchLogs();
  }, [cards]);

  // Read all distinct rows available
  const activeGroupIds = normalizeActiveRows(activeRows);
  const availableGroups = KANA_GROUPS;

  const handleToggleGroup = (groupId: string) => {
    let nextRows = [...activeGroupIds];
    if (activeGroupIds.includes(groupId)) {
      // Don't allow deselecting everything
      if (activeGroupIds.length === 1) return;
      nextRows = activeGroupIds.filter((r) => r !== groupId);
    } else {
      nextRows.push(groupId);
    }
    sound.playTick();
    onActiveRowsUpdate(nextRows);
    saveActiveRows(nextRows);
  };

  const handleSelectAll = () => {
    sound.playTick();
    const allGroups = availableGroups.map((group) => group.id);
    onActiveRowsUpdate(allGroups);
    saveActiveRows(allGroups);
  };

  const handleSelectScript = (script: KanaScript) => {
    sound.playTick();
    const scriptGroups = availableGroups.filter((group) => group.script === script).map((group) => group.id);
    onActiveRowsUpdate(scriptGroups);
    saveActiveRows(scriptGroups);
  };

  const handleSelectVowelsOnly = (script: KanaScript) => {
    sound.playTick();
    const groupId = availableGroups.find((group) => group.script === script && group.row === "Vowels")?.id;
    const rows = groupId ? [groupId] : activeGroupIds;
    onActiveRowsUpdate(rows);
    saveActiveRows(rows);
  };

  const executeFullReset = () => {
    sound.playIncorrect();
    resetAllData();
    onResetDatabase();
    setShowResetConfirm(false);
  };

  // Helper: map character to box score
  const getCardBox = (char: string): number => {
    const card = cards.find((c) => c.char === char);
    return card ? card.box : 1;
  };

  return (
    <div className="space-y-8" id="dictionary-view">
      {/* 1. ACTIVE ROW SELECTION BOARD */}
      <div className="bg-white rounded-[32px] border-2 border-zinc-900 p-5 sm:p-6 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-5 border-b-2 border-zinc-150 pb-4 gap-3">
          <div>
            <h3 className="text-lg font-black text-zinc-900 flex items-center gap-2 uppercase">
              <Activity className="h-5 w-5 text-[#818cf8]" />
              Active Kana Groups
            </h3>
            <p className="text-xs text-zinc-400 font-bold uppercase tracking-wider mt-0.5">
              Selected hiragana and katakana groups appear in built-in flashcards and speed grids.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-2xl border-2 font-black text-[10px] uppercase tracking-wider shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] ${
              isOnline ? "bg-emerald-50 text-emerald-700 border-emerald-300" : "bg-amber-50 text-amber-700 border-amber-300"
            }`}>
              <div className={`h-2 w-2 rounded-full ${isOnline ? "bg-emerald-500 animate-pulse" : "bg-amber-500"}`} />
              {isOnline ? "Online / Sync Active" : "Offline / Local Only"}
            </div>
            <button
              onClick={() => {
                sound.playTick();
                handleSelectVowelsOnly("hiragana");
              }}
              className="py-1.5 px-3 bg-white border-2 border-zinc-900 text-zinc-900 rounded-2xl text-xs font-black uppercase tracking-wider hover:bg-zinc-100 transition-colors shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] cursor-pointer active:translate-y-0.5"
            >
              Hira Vowels
            </button>
            <button
              onClick={() => {
                sound.playTick();
                handleSelectVowelsOnly("katakana");
              }}
              className="py-1.5 px-3 bg-white border-2 border-zinc-900 text-zinc-900 rounded-2xl text-xs font-black uppercase tracking-wider hover:bg-zinc-100 transition-colors shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] cursor-pointer active:translate-y-0.5"
            >
              Kata Vowels
            </button>
            <button
              onClick={() => handleSelectScript("hiragana")}
              className="py-1.5 px-3 bg-white border-2 border-zinc-900 text-zinc-900 rounded-2xl text-xs font-black uppercase tracking-wider hover:bg-zinc-100 transition-colors shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] cursor-pointer active:translate-y-0.5"
            >
              All Hira
            </button>
            <button
              onClick={() => handleSelectScript("katakana")}
              className="py-1.5 px-3 bg-white border-2 border-zinc-900 text-zinc-900 rounded-2xl text-xs font-black uppercase tracking-wider hover:bg-zinc-100 transition-colors shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] cursor-pointer active:translate-y-0.5"
            >
              All Kata
            </button>
            <button
              onClick={() => {
                sound.playTick();
                handleSelectAll();
              }}
              className="py-1.5 px-3 bg-white border-2 border-zinc-900 text-zinc-900 rounded-2xl text-xs font-black uppercase tracking-wider hover:bg-zinc-100 transition-colors shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] cursor-pointer active:translate-y-0.5"
            >
              All Kana
            </button>
          </div>
        </div>

        {/* Categories grid checkboxes */}
        <div className="grid grid-cols-1 min-[380px]:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {availableGroups.map((group) => {
            const isActive = activeGroupIds.includes(group.id);
            
            return (
              <button
                key={group.id}
                onClick={() => handleToggleGroup(group.id)}
                className={`py-3 px-4 text-left rounded-2xl border-2 border-zinc-900 text-sm font-black transition-all flex items-center justify-between cursor-pointer shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] active:translate-y-0.5 active:shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] ${
                  isActive
                    ? "bg-zinc-900 border-zinc-900 text-white"
                    : "bg-white border-zinc-900 text-zinc-900 hover:bg-zinc-50"
                }`}
              >
                <div className="flex items-center gap-2">
                  <div
                    className={`h-4 w-4 rounded flex items-center justify-center border-2 border-zinc-900 transition-all ${
                      isActive ? "bg-emerald-400 text-zinc-950" : "bg-zinc-50"
                    }`}
                  >
                    {isActive && <Check className="h-3 w-3 stroke-[4]" />}
                  </div>
                  <span className="uppercase tracking-wide text-xs">
                    {group.script === "hiragana" ? "Hira" : "Kata"} {group.row}
                  </span>
                </div>
                <span className={`text-[10px] font-black tracking-wide inline-block px-2 py-0.5 rounded-lg border border-zinc-300 ${
                  isActive ? "bg-zinc-800 text-zinc-300 border-zinc-700" : "bg-zinc-50 text-zinc-400"
                }`}>
                  {group.count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 2. GLOSSARY BROWSER CARD LIST */}
      <div className="bg-white rounded-[32px] border-2 border-zinc-900 p-5 sm:p-6 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]">
        <div className="mb-6 border-b-2 border-zinc-150 pb-4">
          <h3 className="text-lg font-black text-zinc-900 flex items-center gap-2 uppercase">
            <Grid className="h-5 w-5 text-indigo-500" />
            Kana Glossary
          </h3>
          <p className="text-xs text-zinc-400 font-bold uppercase tracking-wider mt-0.5">
            Click any character to hear its native Japanese pronunciation aloud.
          </p>
        </div>

        <div className="space-y-6">
          {KANA_SCRIPTS.map((script) => (
            <div key={script} className="space-y-4">
              <div className="flex items-center gap-2 px-1">
                <span className="h-2 w-2 rounded-full bg-indigo-500" />
                <h4 className="text-sm font-black uppercase tracking-widest text-zinc-800">
                  {getScriptLabel(script)}
                </h4>
              </div>

              {availableGroups.filter((group) => group.script === script).map((group) => {
                const rowItems = KANA_DATA.filter((item) => item.groupId === group.id);
                const isActiveRow = activeGroupIds.includes(group.id);

            return (
              <div
                key={group.id}
                className={`space-y-3 p-4 rounded-2xl border-2 border-zinc-900 transition-all shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] ${
                  isActiveRow
                    ? "bg-white border-zinc-900"
                    : "bg-zinc-50 opacity-60"
                }`}
              >
                <div className="flex items-center justify-between text-[11px] font-black text-zinc-500 uppercase tracking-widest px-1">
                  <span>{group.row} Series</span>
                  <span className={`px-2 py-0.5 rounded-lg border text-[10px] font-black tracking-widest uppercase ${
                    isActiveRow ? "bg-emerald-100 text-emerald-800 border-emerald-300 shadow-sm" : "bg-zinc-200 border-zinc-300 text-zinc-500"
                  }`}>
                    {isActiveRow ? "Active" : "Inactive"}
                  </span>
                </div>

                {/* Character matrix */}
                <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 gap-2.5">
                  {rowItems.map((item) => {
                    const box = getCardBox(item.char);
                    // Match visual styling box colors: Box 5 = fully mastered (Emerald highlight)
                    let levelColor = "text-zinc-500 bg-zinc-50 border-zinc-200";
                    if (box === 5) levelColor = "text-zinc-950 bg-emerald-400 border-zinc-900 font-black shadow-sm";
                    else if (box >= 3) levelColor = "text-zinc-950 bg-indigo-305 bg-indigo-200 border-zinc-900 font-bold";
                    else if (box === 2) levelColor = "text-zinc-950 bg-amber-305 bg-amber-250 border-zinc-900 font-bold";

                    return (
                      <button
                        key={item.char}
                        onClick={() => {
                          sound.playCharacter(item.char);
                        }}
                        className="py-2.5 px-1 rounded-xl bg-white border-2 border-zinc-900 shadow-[2.5px_2.5px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-0.5 hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] transition-all text-center relative cursor-pointer group flex flex-col items-center justify-between min-h-[96px]"
                      >
                        <span className="text-3xl font-black text-zinc-900 block leading-none pt-1">
                          {item.char}
                        </span>
                        <span className="text-[11px] font-extrabold text-zinc-400 uppercase tracking-widest block leading-none mt-1">
                          {item.romaji}
                        </span>

                        {/* Box level badge indicator inside grid */}
                        <div className={`mt-2 text-[9px] font-bold py-0.5 w-[90%] rounded border-2 leading-none uppercase ${levelColor}`}>
                          Box {box}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* 3. OFFLINE PERSISTENCE & AUDIT LOG */}
      <div className="bg-white rounded-[32px] border-2 border-zinc-900 p-5 sm:p-6 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-5 border-b-2 border-zinc-150 pb-4 gap-3">
          <div>
            <h3 className="text-lg font-black text-zinc-900 flex items-center gap-2 uppercase">
              <Compass className="h-5 w-5 text-[#818cf8]" />
              IndexedDB Review Logs (Offline-First Audit)
            </h3>
            <p className="text-xs text-zinc-400 font-bold uppercase tracking-wider mt-0.5">
              Verified review logs stored locally inside IndexedDB. Turn off your Wi-Fi to test offline progress.
            </p>
          </div>
          {reviewLogs.length > 0 && (
            <button
              onClick={async () => {
                sound.playTick();
                const { clearReviewActionsFromDB } = await import("../utils/db");
                await clearReviewActionsFromDB();
                setReviewLogs([]);
              }}
              className="py-1.5 px-3 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 hover:text-zinc-900 rounded-xl border-2 border-zinc-900 text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] active:translate-y-0.5"
            >
              Clear Logs
            </button>
          )}
        </div>

        {reviewLogs.length === 0 ? (
          <div className="text-center py-8 bg-zinc-50 rounded-2xl border-2 border-dashed border-zinc-300">
            <p className="text-xs font-bold uppercase tracking-wider text-zinc-400">
              No review actions recorded yet. Completing card reviews in the Spaced Repetitions tab will populate logs here.
            </p>
          </div>
        ) : (
          <div className="max-h-64 overflow-y-auto rounded-2xl border-2 border-zinc-900 divide-y-2 divide-zinc-950 font-mono text-xs">
            {reviewLogs.map((log, index) => (
              <div key={log.id || index} className="p-3 bg-zinc-50 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 hover:bg-zinc-100/50 transition-colors">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="text-base font-black px-2 py-0.5 rounded-lg bg-zinc-900 text-white leading-none border border-zinc-900">
                    {log.char}
                  </span>
                  <div className="min-w-0">
                    <span className="font-extrabold text-zinc-800 block sm:inline">Review action recorded</span>
                    <span className="mx-2 text-zinc-300">|</span>
                    <span className="text-zinc-500">Box {log.previousBox} → Box {log.newBox}</span>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`px-2 py-0.5 rounded-full font-black text-[9px] uppercase tracking-wider border-2 ${
                    log.isCorrect 
                      ? "bg-emerald-150 bg-emerald-100 text-emerald-800 border-emerald-400" 
                      : "bg-red-100 text-red-800 border-red-300"
                  }`}>
                    {log.isCorrect ? "Correct" : "Incorrect"}
                  </span>
                  <span className={`px-2 py-0.5 rounded-full font-black text-[9px] uppercase tracking-wider border-2 ${
                    log.offline 
                      ? "bg-amber-100 text-amber-800 border-amber-400" 
                      : "bg-indigo-150 bg-indigo-100 text-indigo-800 border-indigo-400"
                  }`}>
                    {log.offline ? "Offline" : "Synced"}
                  </span>
                  <span className="text-[10px] text-zinc-400 hidden sm:inline-block">
                    {new Date(log.timestamp).toLocaleTimeString()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 3.5. ANKI DIRECT DECK CENTER */}
      <AnkiDeckManager />

      {/* 4. DANGER ZONE RESET CONTROLS */}
      <div className="bg-red-50 border-2 border-zinc-900 rounded-[24px] p-5 mt-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
        <div>
          <h4 className="text-sm font-black text-red-855 text-red-800 flex items-center gap-1.5 uppercase">
            <AlertTriangle className="h-4 w-4" /> Reset Learning State
          </h4>
          <p className="text-xs text-red-700 font-bold uppercase tracking-wide mt-1 max-w-sm">
            This wipes out all of your Spaced Repetition boxes, study streaks, and restores defaults.
          </p>
        </div>

        <div>
          {!showResetConfirm ? (
            <button
              onClick={() => {
                sound.playTick();
                setShowResetConfirm(true);
              }}
              className="py-2 px-4 bg-white hover:bg-red-100 text-red-650 text-red-650 text-red-600 rounded-xl border-2 border-zinc-900 text-xs font-black uppercase tracking-wider transition-all cursor-pointer shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] active:translate-y-0.5"
            >
              Reset All Progress
            </button>
          ) : (
            <div className="flex flex-col min-[420px]:flex-row items-stretch min-[420px]:items-center gap-2">
              <button
                onClick={executeFullReset}
                className="py-2.5 px-4 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] border-2 border-zinc-900 block"
              >
                Yes, Clear All
              </button>
              <button
                onClick={() => {
                  sound.playTick();
                  setShowResetConfirm(false);
                }}
                className="py-2.5 px-4 bg-white border-2 border-zinc-900 text-zinc-900 rounded-xl text-xs font-black uppercase tracking-wider hover:bg-zinc-100 transition-all cursor-pointer"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
export default CharDictionary;

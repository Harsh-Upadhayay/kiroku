/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from "react";
import {
  getStoredSRSCards,
  getStoredActiveRows,
  getStoredStreak,
  isCardActive,
  normalizeActiveRows,
  normalizeSRSCards,
} from "./utils/srs";
import { SRSCard } from "./types";
import { SpeedSheet } from "./components/SpeedSheet";
import { SrsQuiz } from "./components/SrsQuiz";
import { CharDictionary } from "./components/CharDictionary";
import { AnkiPage } from "./components/AnkiPage";
import { sound } from "./utils/audio";
import { Zap, BookOpen, Settings, Layers } from "lucide-react";
import { motion } from "motion/react";
import { getAllCardsFromDB, saveAllCardsToDB, getSettingFromDB, saveSettingToDB } from "./utils/db";
import { getCurrentUser, User } from "./utils/auth";
import { AuthCenter } from "./components/AuthCenter";
import { reconcileOnStartup, syncEvents } from "./utils/sync";

export default function App() {
  // Primary state trackers
  const [cards, setCards] = useState<SRSCard[]>([]);
  const [activeRows, setActiveRows] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<"speed" | "srs" | "anki" | "dictionary">("anki");

  // User auth state tracking
  const [currentUser, setAppStateCurrentUser] = useState<User | null>(null);

  // Statistic summaries
  const [masteryPercent, setMasteryPercent] = useState<number>(0);
  const [masteredCount, setMasteredCount] = useState<number>(0);
  const [totalActiveCount, setTotalActiveCount] = useState<number>(0);

  // Read initial user session configuration
  useEffect(() => {
    setAppStateCurrentUser(getCurrentUser());
  }, []);

  function getUserPrefixedKey(key: string): string {
    const user = getCurrentUser();
    if (!user) return key;
    return "user_scoped_" + user.email.toLowerCase().replace(/[^a-z0-9]/g, "_") + "_" + key;
  }

  // Reload progress data dynamically whenever user session mounts/demounts
  useEffect(() => {
    async function loadData() {
      try {
        if (currentUser && navigator.onLine) {
          await reconcileOnStartup(currentUser.email);
        }

        let dbCards = await getAllCardsFromDB();
        let dbRows = await getSettingFromDB<string[]>("active_rows", []);

        // Fallback/Synchronize with localStorage
        if (!dbCards || dbCards.length === 0) {
          const localCards = getStoredSRSCards();
          await saveAllCardsToDB(localCards);
          dbCards = localCards;
        } else {
          const normalizedCards = normalizeSRSCards(dbCards);
          if (JSON.stringify(normalizedCards) !== JSON.stringify(dbCards)) {
            await saveAllCardsToDB(normalizedCards);
          }
          dbCards = normalizedCards;
        }

        if (!dbRows || dbRows.length === 0) {
          const localRows = getStoredActiveRows();
          await saveSettingToDB("active_rows", localRows);
          dbRows = localRows;
        } else {
          const normalizedRows = normalizeActiveRows(dbRows);
          if (JSON.stringify(normalizedRows) !== JSON.stringify(dbRows)) {
            await saveSettingToDB("active_rows", normalizedRows);
          }
          dbRows = normalizedRows;
        }

        // Sync streak settings Info
        const localStreak = getStoredStreak();
        const dbStreak = await getSettingFromDB<{ current: number; highest: number }>("streak_info", localStreak);
        if (dbStreak) {
          localStorage.setItem(getUserPrefixedKey("hiragana_srs_streak_v1"), String(dbStreak.current));
          localStorage.setItem(getUserPrefixedKey("hiragana_srs_high_streak_v1"), String(dbStreak.highest));
        } else {
          await saveSettingToDB("streak_info", localStreak);
        }

        setCards(dbCards);
        setActiveRows(dbRows);
      } catch (err) {
        console.error("IndexedDB startup load failed, using localStorage fallback", err);
        setCards(getStoredSRSCards());
        setActiveRows(getStoredActiveRows());
      }
    }
    loadData();
  }, [currentUser]);

  // Periodic background reconciliation keeps already-open browser sessions converged.
  useEffect(() => {
    if (!currentUser) return;

    const initialTimeout = setTimeout(() => {
      reconcileOnStartup(currentUser.email).catch((e) => console.warn("Background sync initial reconcile failed", e));
    }, 3000);

    const interval = setInterval(() => {
      reconcileOnStartup(currentUser.email).catch((e) => console.warn("Background sync periodic reconcile failed", e));
    }, 15000);

    return () => {
      clearTimeout(initialTimeout);
      clearInterval(interval);
    };
  }, [currentUser]);

  // Subscribe to remote pull update events
  useEffect(() => {
    const unsubscribe = syncEvents.subscribe(() => {
      console.log("Remote pull sync detected! Refreshing local states...");
      handleForceRefreshDB();
    });
    return unsubscribe;
  }, []);

  // Compute stats whenever cards or active rows change
  useEffect(() => {
    if (cards.length === 0) return;

    // Filter cards in active rows
    const activeCards = cards.filter((c) => isCardActive(c, activeRows));
    const mastered = activeCards.filter((c) => c.box === 5);

    setMasteredCount(mastered.length);
    setTotalActiveCount(activeCards.length);

    if (activeCards.length > 0) {
      setMasteryPercent(Math.round((mastered.length / activeCards.length) * 100));
    } else {
      setMasteryPercent(0);
    }
  }, [cards, activeRows]);

  const handleForceRefreshDB = () => {
    // Force refresh from IndexedDB directly or fallback
    getAllCardsFromDB()
      .then((dbCards) => {
        if (dbCards && dbCards.length > 0) {
          setCards(normalizeSRSCards(dbCards));
        } else {
          setCards(getStoredSRSCards());
        }
      })
      .catch(() => {
        setCards(getStoredSRSCards());
      });

    getSettingFromDB<string[]>("active_rows", [])
      .then((dbRows) => {
        if (dbRows && dbRows.length > 0) {
          setActiveRows(normalizeActiveRows(dbRows));
        } else {
          setActiveRows(getStoredActiveRows());
        }
      })
      .catch(() => {
        setActiveRows(getStoredActiveRows());
      });
  };

  return (
    <div className="min-h-screen bg-zinc-100 text-zinc-900 flex flex-col antialiased p-3 sm:p-6 pb-12 font-sans">
      {/* Visual Navigation Header conforming to Bento Grid */}
      <header className="max-w-7xl w-full mx-auto flex flex-col sm:flex-row items-stretch sm:items-center justify-between mb-6 sm:mb-8 gap-4">
        {/* Logo and title */}
        <div className="flex items-center gap-3 select-none">
          <div className="w-12 h-12 bg-indigo-600 rounded-2xl flex items-center justify-center text-white font-black text-2xl border-2 border-zinc-900 shadow-[4px_4px_0px_0px_rgba(0,0,0,0.95)] shrink-0">
            カ
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-black text-zinc-900 tracking-tight uppercase">
              Kiroku
            </h1>
            <p className="text-xs text-zinc-500 font-bold uppercase tracking-wider block">
              Hiragana, Katakana & Anki Review
            </p>
          </div>
        </div>

        {/* Global Progress & Stats Bento Bar */}
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <div className="bg-white px-4 py-2 rounded-2xl border-2 border-zinc-900 flex items-center gap-3 shadow-[4px_4px_0px_0px_rgba(0,0,0,0.95)] w-full sm:w-auto">
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></div>
            <div className="text-left">
              <span className="text-[9px] font-black uppercase tracking-widest text-zinc-400 block leading-none">Box 5 Mastery</span>
              <span className="text-xs font-black text-zinc-800 leading-none block mt-1">
                {masteredCount} / {totalActiveCount} Kana ({masteryPercent}%)
              </span>
            </div>
            
            {/* Minimalist raw progress bar */}
            <div className="w-16 bg-zinc-100 h-2 rounded-full border border-zinc-350 overflow-hidden">
              <div
                className="bg-emerald-400 h-full transition-all duration-300"
                style={{ width: `${masteryPercent}%` }}
              />
            </div>
          </div>
        </div>
      </header>

      {/* Main Container Wrapper */}
      <main className="flex-1 max-w-7xl w-full mx-auto space-y-6">

        {/* AUTH CENTER CONTROL */}
        <AuthCenter onSessionChange={(user) => setAppStateCurrentUser(user)} />
        
        {/* TAB CONTROLS PANEL - Styled with blocky Bento Neubrutalism */}
        <div className="flex justify-center mb-6">
          <div className="flex bg-white rounded-3xl border-2 border-zinc-900 p-1.5 shadow-[4px_4px_0px_0px_rgba(0,0,0,0.95)] max-w-2xl w-full overflow-x-auto">
            {[
              { id: "speed", label: "Speed Sheets", icon: Zap },
              { id: "srs", label: "Kana SRS", icon: BookOpen },
              { id: "anki", label: "Anki Decks", icon: Layers },
              { id: "dictionary", label: "Glossary & Setups", icon: Settings },
            ].map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => {
                    sound.playTick();
                    setActiveTab(tab.id as any);
                  }}
                  className={`flex-1 min-w-[92px] py-2 sm:py-3 px-1 text-[9px] min-[360px]:text-[10px] sm:text-xs md:text-sm font-black uppercase tracking-wider rounded-2xl transition-all cursor-pointer flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 border-2 ${
                    active
                      ? "bg-indigo-600 text-white border-zinc-900 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                      : "text-zinc-500 hover:text-zinc-900 hover:bg-zinc-50 border-transparent"
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="text-center">{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* ACTIVE MODULE CONTAINER */}
        <div className="w-full">
          {activeTab === "speed" && (
            <motion.div
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.15 }}
            >
              <SpeedSheet
                activeRows={activeRows}
                onSessionComplete={(sess) => {
                  // Speed sheet run completed. Let's refresh our cards db stats to render updated results
                  setCards(getStoredSRSCards());
                }}
              />
            </motion.div>
          )}

          {activeTab === "srs" && (
            <motion.div
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.15 }}
            >
              <SrsQuiz
                cards={cards}
                activeRows={activeRows}
                onCardsUpdate={(updated) => setCards(updated)}
              />
            </motion.div>
          )}

          {activeTab === "dictionary" && (
            <motion.div
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.15 }}
            >
              <CharDictionary
                cards={cards}
                activeRows={activeRows}
                onActiveRowsUpdate={(rows) => setActiveRows(rows)}
                onResetDatabase={handleForceRefreshDB}
              />
            </motion.div>
          )}

          {activeTab === "anki" && (
            <motion.div
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.15 }}
            >
              <AnkiPage />
            </motion.div>
          )}
        </div>
      </main>

      {/* FOOTER */}
      <footer className="mt-12 max-w-7xl w-full mx-auto flex flex-col sm:flex-row justify-between items-center text-xs font-black text-zinc-400 uppercase tracking-widest pt-6 border-t-2 border-zinc-200">
        <div className="flex gap-4">
          <button onClick={() => { sound.playTick(); setActiveTab("speed"); }} className={`transition-colors ${activeTab === "speed" ? "text-zinc-950" : "hover:text-zinc-900"}`}>Speed Quiz</button>
          <button onClick={() => { sound.playTick(); setActiveTab("srs"); }} className={`transition-colors ${activeTab === "srs" ? "text-zinc-950" : "hover:text-zinc-900"}`}>Kana SRS</button>
          <button onClick={() => { sound.playTick(); setActiveTab("anki"); }} className={`transition-colors ${activeTab === "anki" ? "text-zinc-950" : "hover:text-zinc-900"}`}>Anki Decks</button>
          <button onClick={() => { sound.playTick(); setActiveTab("dictionary"); }} className={`transition-colors ${activeTab === "dictionary" ? "text-zinc-950" : "hover:text-zinc-900"}`}>Stats & Config</button>
        </div>
        <div className="mt-2 sm:mt-0 text-center sm:text-right">
          <span>Tap a kana or grid cell to hear pronunciation</span>
        </div>
      </footer>
    </div>
  );
}

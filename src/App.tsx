/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from "react";
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
import { N5CoursePage } from "./components/N5CoursePage";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { sound } from "./utils/audio";
import {
  Zap, BookOpen, Settings, Layers, GraduationCap,
  LogIn, LogOut, User, Volume2, VolumeX, ChevronDown,
  X, Mail, Key, Eye, EyeOff, UserPlus, Check, Sparkles, ShieldCheck,
  Sun, Moon, Monitor,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { getAllCardsFromDB, saveAllCardsToDB, getSettingFromDB, saveSettingToDB } from "./utils/db";
import { getCurrentUser, setCurrentUser, getRegisteredProfiles, saveRegisteredProfiles, User as AppUser } from "./utils/auth";
import { reconcileOnStartup, triggerPushSync, syncEvents } from "./utils/sync";
import { getN5CourseProgress } from "./utils/n5-course";
import { n5Course } from "./content/n5/raw";
import {
  getThemePreference,
  resolveTheme,
  setThemePreference,
  THEME_CHANGED_EVENT,
  type ThemePreference,
} from "./utils/theme";

// ─── Theme toggle (header) ───────────────────────────────────────────────────

function useThemePreference(): ThemePreference {
  const [preference, setPreference] = useState<ThemePreference>(getThemePreference);
  useEffect(() => {
    const onChange = () => setPreference(getThemePreference());
    window.addEventListener(THEME_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(THEME_CHANGED_EVENT, onChange);
  }, []);
  return preference;
}

function ThemeToggle() {
  const preference = useThemePreference();
  const effective = resolveTheme(preference);
  return (
    <button
      onClick={() => { sound.playTick(); setThemePreference(effective === "dark" ? "light" : "dark"); }}
      aria-label={effective === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      title={effective === "dark" ? "Light mode" : "Dark mode"}
      className="w-10 h-10 shrink-0 flex items-center justify-center rounded-2xl border-2 border-zinc-900 bg-white text-zinc-700 hover:bg-zinc-50 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] active:translate-y-0.5 transition-all cursor-pointer"
    >
      {effective === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}

// ─── Kana hub: combines Speed Sheets, SRS, and Characters/Config ────────────

type KanaSubTab = "speed" | "srs" | "characters";

function KanaHub({
  cards,
  activeRows,
  onActiveRowsUpdate,
  onCardsUpdate,
  onResetDatabase,
}: {
  cards: SRSCard[];
  activeRows: string[];
  onActiveRowsUpdate: (rows: string[]) => void;
  onCardsUpdate: (cards: SRSCard[]) => void;
  onResetDatabase: () => void;
}) {
  const [sub, setSub] = useState<KanaSubTab>("speed");

  const subTabs: { id: KanaSubTab; label: string; icon: React.ReactNode }[] = [
    { id: "speed", label: "Speed Sheets", icon: <Zap className="h-3.5 w-3.5" /> },
    { id: "srs", label: "SRS Quiz", icon: <BookOpen className="h-3.5 w-3.5" /> },
    { id: "characters", label: "Characters", icon: <span className="text-base leading-none font-black">あ</span> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex bg-white rounded-2xl border-2 border-zinc-900 p-1 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] self-start w-fit">
        {subTabs.map((t) => (
          <button
            key={t.id}
            onClick={() => { sound.playTick(); setSub(t.id); }}
            className={`flex items-center gap-1.5 py-1.5 px-3 text-[10px] font-black uppercase tracking-wider rounded-xl transition-all cursor-pointer border-2 ${
              sub === t.id
                ? "bg-indigo-600 text-white border-zinc-900 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                : "text-zinc-500 hover:text-zinc-900 hover:bg-zinc-50 border-transparent"
            }`}
          >
            {t.icon}
            <span className="hidden sm:inline">{t.label}</span>
          </button>
        ))}
      </div>

      <motion.div key={sub} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.12 }}>
        {sub === "speed" && (
          <SpeedSheet
            activeRows={activeRows}
            onSessionComplete={() => onCardsUpdate(getStoredSRSCards())}
            onGoToGlossary={() => setSub("characters")}
          />
        )}
        {sub === "srs" && (
          <SrsQuiz
            cards={cards}
            activeRows={activeRows}
            onCardsUpdate={onCardsUpdate}
          />
        )}
        {sub === "characters" && (
          <CharDictionary
            cards={cards}
            activeRows={activeRows}
            onActiveRowsUpdate={onActiveRowsUpdate}
            onResetDatabase={onResetDatabase}
          />
        )}
      </motion.div>
    </div>
  );
}

// ─── Settings tab ───────────────────────────────────────────────────────────

function SettingsTab({ onResetDatabase }: { onResetDatabase: () => void }) {
  const [soundMuted, setSoundMuted] = useState(sound.muted);
  const [batchSize, setBatchSize] = useState<number>(() => {
    return parseInt(localStorage.getItem("kiroku_kana_batch") || "20", 10);
  });
  const [resetConfirm, setResetConfirm] = useState(false);

  function toggleSound() {
    const next = !soundMuted;
    sound.setMuted(next);
    setSoundMuted(next);
    if (!next) sound.playTick();
  }

  function saveBatch(n: number) {
    setBatchSize(n);
    localStorage.setItem("kiroku_kana_batch", String(n));
    sound.playTick();
  }

  function doReset() {
    import("./utils/srs").then(({ resetAllData }) => {
      resetAllData();
      onResetDatabase();
      setResetConfirm(false);
      sound.playIncorrect();
    });
  }

  const themePreference = useThemePreference();
  const themeOptions: { id: ThemePreference; label: string; icon: React.ReactNode }[] = [
    { id: "light", label: "Light", icon: <Sun className="h-3.5 w-3.5" /> },
    { id: "dark", label: "Dark", icon: <Moon className="h-3.5 w-3.5" /> },
    { id: "system", label: "System", icon: <Monitor className="h-3.5 w-3.5" /> },
  ];

  return (
    <div className="space-y-6 max-w-xl">
      {/* Appearance */}
      <div className="bg-white rounded-[28px] border-2 border-zinc-900 p-5 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
        <h3 className="text-sm font-black uppercase tracking-wider text-zinc-800 mb-4 flex items-center gap-2">
          <Moon className="h-4 w-4 text-indigo-500" /> Appearance
        </h3>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-black text-zinc-700 uppercase tracking-wide">Theme</p>
            <p className="text-[10px] text-zinc-400 font-bold mt-0.5">System follows your device preference</p>
          </div>
          <div className="flex items-center gap-1">
            {themeOptions.map((option) => (
              <button
                key={option.id}
                onClick={() => { sound.playTick(); setThemePreference(option.id); }}
                className={`flex items-center gap-1.5 px-3 h-10 rounded-xl border-2 border-zinc-900 text-xs font-black uppercase shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] active:translate-y-0.5 transition-all cursor-pointer ${
                  themePreference === option.id ? "bg-indigo-600 text-white" : "bg-white text-zinc-700 hover:bg-zinc-50"
                }`}
              >
                {option.icon}
                <span className="hidden sm:inline">{option.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Sound */}
      <div className="bg-white rounded-[28px] border-2 border-zinc-900 p-5 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
        <h3 className="text-sm font-black uppercase tracking-wider text-zinc-800 mb-4 flex items-center gap-2">
          <Volume2 className="h-4 w-4 text-indigo-500" /> Audio
        </h3>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-black text-zinc-700 uppercase tracking-wide">Sound Effects</p>
            <p className="text-[10px] text-zinc-400 font-bold mt-0.5">Button clicks, grading feedback, fanfare</p>
          </div>
          <button
            onClick={toggleSound}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl border-2 border-zinc-900 text-xs font-black uppercase tracking-wider shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] active:translate-y-0.5 transition-all cursor-pointer ${
              soundMuted ? "bg-zinc-100 text-zinc-500" : "bg-indigo-600 text-white"
            }`}
          >
            {soundMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            {soundMuted ? "Off" : "On"}
          </button>
        </div>
      </div>

      {/* Kana SRS batch */}
      <div className="bg-white rounded-[28px] border-2 border-zinc-900 p-5 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
        <h3 className="text-sm font-black uppercase tracking-wider text-zinc-800 mb-4 flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-indigo-500" /> Kana SRS
        </h3>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-black text-zinc-700 uppercase tracking-wide">Cards per Session</p>
            <p className="text-[10px] text-zinc-400 font-bold mt-0.5">How many kana cards to quiz in one session</p>
          </div>
          <div className="flex items-center gap-1">
            {[10, 20, 30].map((n) => (
              <button
                key={n}
                onClick={() => saveBatch(n)}
                className={`w-10 h-10 rounded-xl border-2 border-zinc-900 text-xs font-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] active:translate-y-0.5 transition-all cursor-pointer ${
                  batchSize === n ? "bg-indigo-600 text-white" : "bg-white text-zinc-700 hover:bg-zinc-50"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Danger zone */}
      <div className="bg-red-50 border-2 border-zinc-900 rounded-[24px] p-5 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
        <h3 className="text-sm font-black uppercase tracking-wider text-red-800 mb-1 flex items-center gap-2">
          ⚠ Danger Zone
        </h3>
        <p className="text-[10px] text-red-700 font-bold uppercase tracking-wide mb-4">
          Wipes all kana SRS boxes, study streaks, and restores defaults.
        </p>
        {!resetConfirm ? (
          <button
            onClick={() => { sound.playTick(); setResetConfirm(true); }}
            className="py-2 px-4 bg-white hover:bg-red-100 text-red-600 rounded-xl border-2 border-zinc-900 text-xs font-black uppercase tracking-wider transition-all cursor-pointer shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] active:translate-y-0.5"
          >
            Reset Kana Progress
          </button>
        ) : (
          <div className="flex gap-2">
            <button onClick={doReset} className="py-2 px-4 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-black uppercase tracking-wider border-2 border-zinc-900 cursor-pointer shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] active:translate-y-0.5">
              Yes, Reset
            </button>
            <button onClick={() => setResetConfirm(false)} className="py-2 px-4 bg-white border-2 border-zinc-900 text-zinc-900 rounded-xl text-xs font-black uppercase tracking-wider hover:bg-zinc-50 cursor-pointer">
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Compact auth panel ──────────────────────────────────────────────────────

function UserButton({ onSessionChange }: { onSessionChange: (user: AppUser | null) => void }) {
  const [user, setUser] = useState<AppUser | null>(getCurrentUser);
  const [open, setOpen] = useState(false);
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function handleLogout() {
    setCurrentUser(null);
    setUser(null);
    onSessionChange(null);
    setOpen(false);
    sound.playTick();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setSuccess("");
    const targetEmail = email.trim();
    if (!targetEmail || password.length < 4) {
      setError(!targetEmail ? "Email required." : "Password must be ≥ 4 chars.");
      return;
    }
    if (isRegister && password !== confirmPassword) { setError("Passwords don't match."); return; }

    setLoading(true);
    try {
      const profiles = await getRegisteredProfiles();
      let loggedUser: AppUser | null = null;
      let isOffline = false;

      if (isRegister) {
        try {
          const resp = await fetch("/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: targetEmail, password }) });
          if (resp.ok) { const d = await resp.json(); if (d.success) loggedUser = d.data; }
          else { const err = await resp.json().catch(() => ({})); setError(err.error || "Registration failed."); return; }
        } catch { isOffline = true; }

        if (isOffline) {
          if (profiles.some(p => p.email.toLowerCase() === targetEmail.toLowerCase())) { setError("Email already registered."); return; }
          const np = { email: targetEmail, passwordHash: password, joined: Date.now() };
          await saveRegisteredProfiles([...profiles, np]);
          loggedUser = { email: np.email, joined: np.joined };
        }
        setSuccess("Account created!");
        setTimeout(async () => {
          if (loggedUser) {
            setCurrentUser(loggedUser);
            setUser(loggedUser);
            onSessionChange(loggedUser);
            if (!isOffline) await triggerPushSync(loggedUser.email);
          }
          setEmail(""); setPassword(""); setConfirmPassword(""); setSuccess(""); setOpen(false);
        }, 900);
      } else {
        try {
          const resp = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: targetEmail, password }) });
          if (resp.ok) { const d = await resp.json(); if (d.success) loggedUser = d.data; }
          else if (resp.status === 401 || resp.status === 400) { const err = await resp.json().catch(() => ({})); setError(err.error || "Invalid credentials."); return; }
          else throw new Error(`HTTP ${resp.status}`);
        } catch { isOffline = true; }

        if (isOffline) {
          const m = profiles.find(p => p.email.toLowerCase() === targetEmail.toLowerCase() && p.passwordHash === password);
          if (!m) { setError("Invalid credentials."); return; }
          loggedUser = { email: m.email, joined: m.joined };
        }

        if (loggedUser) {
          setCurrentUser(loggedUser);
          if (!isOffline) await reconcileOnStartup(loggedUser.email);
          setUser(loggedUser);
          onSessionChange(loggedUser);
          setEmail(""); setPassword(""); setOpen(false);
          sound.playCorrect();
        }
      }
    } catch { setError("Authentication failed."); }
    finally { setLoading(false); }
  }

  const initials = user?.email?.[0]?.toUpperCase() ?? "?";

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => { sound.playTick(); setOpen((v) => !v); }}
        className={`flex items-center gap-2 px-3 py-2 rounded-2xl border-2 border-zinc-900 text-xs font-black uppercase tracking-wider shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] active:translate-y-0.5 transition-all cursor-pointer ${
          user ? "bg-indigo-600 text-white" : "bg-white text-zinc-700 hover:bg-zinc-50"
        }`}
      >
        {user ? (
          <>
            <span className="w-5 h-5 rounded-full bg-white text-indigo-700 flex items-center justify-center text-[10px] font-black leading-none shrink-0">{initials}</span>
            <span className="max-w-[120px] truncate hidden sm:block">{user.email}</span>
            <ChevronDown className="h-3 w-3 shrink-0" />
          </>
        ) : (
          <>
            <LogIn className="h-3.5 w-3.5" />
            <span>Sign in</span>
          </>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.12 }}
            className="absolute right-0 top-full mt-2 z-50 w-[300px] sm:w-[340px] bg-white border-2 border-zinc-900 rounded-[24px] shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] overflow-hidden"
          >
            {user ? (
              <div className="p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-indigo-600 border-2 border-zinc-900 flex items-center justify-center text-white font-black text-base">{initials}</div>
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Signed in</p>
                      <p className="text-xs font-black text-zinc-900 truncate max-w-[180px]">{user.email}</p>
                    </div>
                  </div>
                  <button onClick={() => setOpen(false)} className="text-zinc-400 hover:text-zinc-900"><X className="h-4 w-4" /></button>
                </div>
                <div className="text-[10px] font-bold text-zinc-400 flex items-center gap-1.5 bg-zinc-50 rounded-xl px-3 py-2 border border-zinc-200">
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" /> Progress isolated to this account
                </div>
                <button
                  onClick={handleLogout}
                  className="w-full py-2.5 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 rounded-xl border-2 border-zinc-900 text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer transition-all"
                >
                  <LogOut className="h-4 w-4" /> Sign out
                </button>
              </div>
            ) : (
              <div className="p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-indigo-500" />
                    <p className="text-xs font-black uppercase tracking-wider text-zinc-800">Kiroku ID</p>
                  </div>
                  <button onClick={() => setOpen(false)} className="text-zinc-400 hover:text-zinc-900"><X className="h-4 w-4" /></button>
                </div>
                <div className="flex bg-zinc-100 border-2 border-zinc-900 p-1 rounded-xl">
                  {["Sign In", "Register"].map((label, i) => (
                    <button
                      key={label}
                      onClick={() => { setIsRegister(i === 1); setError(""); }}
                      className={`flex-1 py-1 px-3 text-[10px] font-black uppercase tracking-wider rounded-lg transition-all cursor-pointer ${
                        isRegister === (i === 1) ? (i === 1 ? "bg-indigo-600 text-white" : "bg-zinc-900 text-white") : "text-zinc-500"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <form onSubmit={handleSubmit} className="space-y-3">
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
                    <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email address" className="w-full bg-white border-2 border-zinc-900 rounded-xl py-2 pl-9 pr-3 text-xs font-bold focus:outline-none placeholder:text-zinc-300" />
                  </div>
                  <div className="relative">
                    <Key className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
                    <input type={showPw ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password (≥ 4 chars)" className="w-full bg-white border-2 border-zinc-900 rounded-xl py-2 pl-9 pr-9 text-xs font-bold focus:outline-none placeholder:text-zinc-300" />
                    <button type="button" onClick={() => setShowPw((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-700 cursor-pointer">
                      {showPw ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                  {isRegister && (
                    <div className="relative">
                      <Key className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
                      <input type={showPw ? "text" : "password"} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Confirm password" className="w-full bg-white border-2 border-zinc-900 rounded-xl py-2 pl-9 pr-3 text-xs font-bold focus:outline-none placeholder:text-zinc-300" />
                    </div>
                  )}
                  {error && <p className="text-[10px] font-bold text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">⚠ {error}</p>}
                  {success && <p className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 flex items-center gap-1.5"><Check className="h-3 w-3" />{success}</p>}
                  <button
                    type="submit"
                    disabled={loading}
                    className={`w-full py-2.5 rounded-xl border-2 border-zinc-900 text-xs font-black uppercase tracking-wider shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] active:translate-y-0.5 cursor-pointer flex items-center justify-center gap-2 transition-all ${
                      isRegister ? "bg-indigo-600 text-white hover:bg-indigo-700" : "bg-zinc-900 text-white hover:bg-zinc-800"
                    } ${loading ? "opacity-50 cursor-not-allowed" : ""}`}
                  >
                    {loading ? <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : isRegister ? <><UserPlus className="h-3.5 w-3.5" /> Create account</> : <><LogIn className="h-3.5 w-3.5" /> Sign in</>}
                  </button>
                </form>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Main app ────────────────────────────────────────────────────────────────

type MainTab = "n5" | "kana" | "anki" | "settings";

export default function App() {
  const [cards, setCards] = useState<SRSCard[]>([]);
  const [activeRows, setActiveRows] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<MainTab>("n5");
  const [currentUser, setAppStateCurrentUser] = useState<AppUser | null>(null);

  // Stats for header
  const [masteryPercent, setMasteryPercent] = useState(0);
  const [masteredCount, setMasteredCount] = useState(0);
  const [totalActiveCount, setTotalActiveCount] = useState(0);
  const [n5Day, setN5Day] = useState(1);
  const [n5Total] = useState(n5Course.days.length);

  useEffect(() => {
    setAppStateCurrentUser(getCurrentUser());
  }, []);

  function getUserPrefixedKey(key: string): string {
    const user = getCurrentUser();
    if (!user) return key;
    return "user_scoped_" + user.email.toLowerCase().replace(/[^a-z0-9]/g, "_") + "_" + key;
  }

  useEffect(() => {
    async function loadData() {
      try {
        if (currentUser && navigator.onLine) {
          await reconcileOnStartup(currentUser.email);
        }

        let dbCards = await getAllCardsFromDB();
        let dbRows = await getSettingFromDB<string[]>("active_rows", []);

        if (!dbCards || dbCards.length === 0) {
          const localCards = getStoredSRSCards();
          await saveAllCardsToDB(localCards);
          dbCards = localCards;
        } else {
          const normalized = normalizeSRSCards(dbCards);
          if (JSON.stringify(normalized) !== JSON.stringify(dbCards)) await saveAllCardsToDB(normalized);
          dbCards = normalized;
        }

        if (!dbRows || dbRows.length === 0) {
          const localRows = getStoredActiveRows();
          await saveSettingToDB("active_rows", localRows);
          dbRows = localRows;
        } else {
          const normalized = normalizeActiveRows(dbRows);
          if (JSON.stringify(normalized) !== JSON.stringify(dbRows)) await saveSettingToDB("active_rows", normalized);
          dbRows = normalized;
        }

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
        console.error("IndexedDB startup load failed", err);
        setCards(getStoredSRSCards());
        setActiveRows(getStoredActiveRows());
      }

      // Load N5 progress for header stat
      try {
        const n5prog = await getN5CourseProgress(n5Course);
        setN5Day(n5prog.currentDay || n5prog.unlockedDay || 1);
      } catch { /* non-critical */ }
    }
    loadData();
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser) return;
    const t = setTimeout(() => reconcileOnStartup(currentUser.email).catch(console.warn), 3000);
    const iv = setInterval(() => reconcileOnStartup(currentUser.email).catch(console.warn), 15000);
    return () => { clearTimeout(t); clearInterval(iv); };
  }, [currentUser]);

  useEffect(() => {
    const unsub = syncEvents.subscribe(() => {
      handleForceRefreshDB();
      getN5CourseProgress(n5Course).then((p) => setN5Day(p.currentDay || p.unlockedDay || 1)).catch(() => {});
    });
    const onN5Saved = () => {
      getN5CourseProgress(n5Course).then((p) => setN5Day(p.currentDay || p.unlockedDay || 1)).catch(() => {});
    };
    window.addEventListener("kiroku:n5-progress-saved", onN5Saved);
    return () => {
      unsub();
      window.removeEventListener("kiroku:n5-progress-saved", onN5Saved);
    };
  }, []);

  useEffect(() => {
    if (!cards.length) return;
    const active = cards.filter((c) => isCardActive(c, activeRows));
    const mastered = active.filter((c) => c.box === 5);
    setMasteredCount(mastered.length);
    setTotalActiveCount(active.length);
    setMasteryPercent(active.length > 0 ? Math.round((mastered.length / active.length) * 100) : 0);
  }, [cards, activeRows]);

  function handleForceRefreshDB() {
    getAllCardsFromDB()
      .then((c) => setCards(c?.length ? normalizeSRSCards(c) : getStoredSRSCards()))
      .catch(() => setCards(getStoredSRSCards()));
    getSettingFromDB<string[]>("active_rows", [])
      .then((r) => setActiveRows(r?.length ? normalizeActiveRows(r) : getStoredActiveRows()))
      .catch(() => setActiveRows(getStoredActiveRows()));
  }

  const mainTabs: { id: MainTab; label: string; icon: React.ReactNode }[] = [
    { id: "n5", label: "N5 Course", icon: <GraduationCap className="h-4 w-4 shrink-0" /> },
    { id: "kana", label: "Kana", icon: <span className="text-base font-black leading-none">あ</span> },
    { id: "anki", label: "Anki Decks", icon: <Layers className="h-4 w-4 shrink-0" /> },
    { id: "settings", label: "Settings", icon: <Settings className="h-4 w-4 shrink-0" /> },
  ];

  return (
    <div className="app-shell min-h-screen bg-zinc-100 text-zinc-900 flex flex-col antialiased p-3 sm:p-6 pb-12 font-sans">
      <header className="max-w-7xl w-full mx-auto flex items-center justify-between mb-6 sm:mb-8 gap-4">
        {/* Logo */}
        <div className="flex items-center gap-3 select-none shrink-0">
          <div className="w-11 h-11 bg-indigo-600 rounded-2xl flex items-center justify-center text-white font-black text-2xl border-2 border-zinc-900 shadow-[3px_3px_0px_0px_rgba(0,0,0,0.95)]">
            カ
          </div>
          <div>
            <h1 className="text-xl font-black text-zinc-900 tracking-tight uppercase leading-none">Kiroku</h1>
            <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">Japanese Study</p>
          </div>
        </div>

        {/* Stats bento */}
        <div className="hidden sm:flex items-center gap-2 flex-1 justify-center">
          {/* N5 */}
          <div className="bg-white border-2 border-zinc-900 rounded-2xl px-3 py-2 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] flex items-center gap-2">
            <GraduationCap className="h-3.5 w-3.5 text-indigo-500 shrink-0" />
            <div>
              <p className="text-[9px] font-black uppercase tracking-widest text-zinc-400 leading-none">N5 Course</p>
              <p className="text-xs font-black text-zinc-800 leading-none mt-0.5">Day {n5Day} / {n5Total}</p>
            </div>
            <div className="w-12 bg-zinc-100 h-1.5 rounded-full border border-zinc-200 overflow-hidden">
              <div className="bg-indigo-500 h-full transition-all" style={{ width: `${Math.round((n5Day / n5Total) * 100)}%` }} />
            </div>
          </div>

          {/* Kana */}
          <div className="bg-white border-2 border-zinc-900 rounded-2xl px-3 py-2 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] flex items-center gap-2">
            <span className="text-base font-black text-zinc-700 leading-none shrink-0">あ</span>
            <div>
              <p className="text-[9px] font-black uppercase tracking-widest text-zinc-400 leading-none">Kana</p>
              <p className="text-xs font-black text-zinc-800 leading-none mt-0.5">{masteredCount}/{totalActiveCount} mastered</p>
            </div>
            <div className="w-12 bg-zinc-100 h-1.5 rounded-full border border-zinc-200 overflow-hidden">
              <div className="bg-emerald-400 h-full transition-all" style={{ width: `${masteryPercent}%` }} />
            </div>
          </div>
        </div>

        {/* Theme + user */}
        <div className="flex items-center gap-2 shrink-0">
          <ThemeToggle />
          <UserButton onSessionChange={setAppStateCurrentUser} />
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto space-y-6">
        {/* Tab bar */}
        <div className="flex justify-center mb-6">
          <div className="flex bg-white rounded-3xl border-2 border-zinc-900 p-1.5 shadow-[4px_4px_0px_0px_rgba(0,0,0,0.95)] max-w-xl w-full">
            {mainTabs.map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => { sound.playTick(); setActiveTab(tab.id); }}
                  className={`flex-1 py-2 sm:py-2.5 px-1 text-[10px] sm:text-xs font-black uppercase tracking-wider rounded-2xl transition-all cursor-pointer flex flex-col items-center justify-center gap-0.5 border-2 ${
                    active
                      ? "bg-indigo-600 text-white border-zinc-900 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                      : "text-zinc-500 hover:text-zinc-900 hover:bg-zinc-50 border-transparent"
                  }`}
                >
                  {tab.icon}
                  <span className="hidden sm:block text-center leading-tight">{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <ErrorBoundary>
          <div className="w-full">
            {activeTab === "n5" && (
              <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.15 }}>
                <N5CoursePage />
              </motion.div>
            )}

            {activeTab === "kana" && (
              <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.15 }}>
                <KanaHub
                  cards={cards}
                  activeRows={activeRows}
                  onActiveRowsUpdate={setActiveRows}
                  onCardsUpdate={setCards}
                  onResetDatabase={handleForceRefreshDB}
                />
              </motion.div>
            )}

            {activeTab === "anki" && (
              <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.15 }}>
                <AnkiPage />
              </motion.div>
            )}

            {activeTab === "settings" && (
              <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.15 }}>
                <SettingsTab onResetDatabase={handleForceRefreshDB} />
              </motion.div>
            )}
          </div>
        </ErrorBoundary>
      </main>

      <footer className="mt-12 max-w-7xl w-full mx-auto flex flex-col sm:flex-row justify-between items-center text-xs font-black text-zinc-400 uppercase tracking-widest pt-6 border-t-2 border-zinc-200">
        <div className="flex gap-4 flex-wrap justify-center">
          {mainTabs.map((t) => (
            <button key={t.id} onClick={() => { sound.playTick(); setActiveTab(t.id); }} className={`transition-colors ${activeTab === t.id ? "text-zinc-950" : "hover:text-zinc-900"}`}>{t.label}</button>
          ))}
        </div>
        <div className="mt-2 sm:mt-0">
          <span>
            {activeTab === "n5" && "Tap any kanji to see its parts & mnemonic"}
            {activeTab === "kana" && "Tap a kana or grid cell to hear pronunciation"}
            {activeTab === "anki" && "Import .apkg files to study your own decks"}
            {activeTab === "settings" && "Settings are saved on this device"}
          </span>
        </div>
      </footer>
    </div>
  );
}

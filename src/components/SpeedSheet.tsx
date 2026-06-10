import React, { useState, useEffect, useRef } from "react";
import { sound } from "../utils/audio";
import { DEFAULT_ACTIVE_GROUP_IDS, KanaCharacter, KANA_DATA } from "../types";
import { normalizeActiveRows } from "../utils/srs";
import { Timer, ArrowRight, Zap, RefreshCw, Volume2, VolumeX, AlertTriangle, Play, CheckCircle2 } from "lucide-react";
import { motion } from "motion/react";

interface SpeedSheetProps {
  activeRows: string[];
  onSessionComplete: (session: {
    cpm: number;
    accuracy: number;
    duration: number;
    total: number;
    correct: number;
  }) => void;
  onGoToGlossary?: () => void;
}

interface CellState {
  id: string;
  charObj: KanaCharacter;
  value: string;
  isCorrect: boolean | null; // null = untouched, true = correct, false = incorrect
}

export const SpeedSheet: React.FC<SpeedSheetProps> = ({
  activeRows,
  onSessionComplete,
  onGoToGlossary,
}) => {
  // Configs
  const [gridSize, setGridSize] = useState<number>(32); // 32 chars per grid (2 rows of 16 as in photos, or flexible)
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [phase, setPhase] = useState<"setup" | "grid1" | "break" | "grid2" | "results">("setup");

  // Grid inventories
  const [grid1Cells, setGrid1Cells] = useState<CellState[]>([]);
  const [grid2Cells, setGrid2Cells] = useState<CellState[]>([]);
  
  // Scoring parameters
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [startTime, setStartTime] = useState<number>(0);
  const [endTime, setEndTime] = useState<number>(0);
  const [elapsedTime, setElapsedTime] = useState<number>(0);
  const [totalKeypresses, setTotalKeypresses] = useState<number>(0);
  const [incorrectAttempts, setIncorrectAttempts] = useState<number>(0);
  
  // Timer support
  const timerIntervalRef = useRef<number | null>(null);
  const [breakLeft, setBreakLeft] = useState<number>(300); // 5 minutes in seconds
  const breakIntervalRef = useRef<number | null>(null);

  // References to input elements for programmatic focus
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Setup grid cells with randomly chosen characters from active rows
  const generateGrid = (size: number): CellState[] => {
    // Collect active characters
    const activeGroupIds = normalizeActiveRows(activeRows);
    let pool = KANA_DATA.filter((c) => activeGroupIds.includes(c.groupId));
    // Fallback in case none selected
    if (pool.length === 0) {
      pool = KANA_DATA.filter((c) => c.groupId === DEFAULT_ACTIVE_GROUP_IDS[0]);
    }

    const cells: CellState[] = [];
    for (let i = 0; i < size; i++) {
      const idx = Math.floor(Math.random() * pool.length);
      cells.push({
        id: `cell-${i}-${Date.now()}-${Math.random()}`,
        charObj: pool[idx],
        value: "",
        isCorrect: null,
      });
    }
    return cells;
  };

  const startSession = () => {
    const size = gridSize;
    const g1 = generateGrid(size);
    const g2 = generateGrid(size);

    setGrid1Cells(g1);
    setGrid2Cells(g2);
    setCurrentIndex(0);
    setTotalKeypresses(0);
    setIncorrectAttempts(0);
    setBreakLeft(300);
    
    // Clear any timers
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    if (breakIntervalRef.current) clearInterval(breakIntervalRef.current);

    setPhase("grid1");
    setIsRunning(true);
    setStartTime(Date.now());
    setElapsedTime(0);

    // Auto-focus first input in the next tick
    setTimeout(() => {
      focusInput(0);
    }, 100);
  };

  // Safe timer updater
  useEffect(() => {
    let interval: any;
    if (isRunning && (phase === "grid1" || phase === "grid2")) {
      interval = setInterval(() => {
        setElapsedTime(Math.floor((Date.now() - startTime) / 1000));
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isRunning, phase, startTime]);

  // Focus utility
  const focusInput = (index: number) => {
    if (inputRefs.current[index]) {
      inputRefs.current[index]?.focus();
      inputRefs.current[index]?.select();
    }
  };

  // Handle keyboard inputs
  const handleCellChange = (
    index: number,
    value: string,
    isGrid2: boolean
  ) => {
    const cells = isGrid2 ? grid2Cells : grid1Cells;
    const setCells = isGrid2 ? setGrid2Cells : setGrid1Cells;
    const cleanVal = value.trim().toLowerCase();
    const cell = cells[index];
    const targetRomaji = cell.charObj.romaji;

    setTotalKeypresses((prev) => prev + value.length);

    // Update current value
    const updated = [...cells];
    updated[index].value = cleanVal;

    // Check correctness instantly as they type (perfect auto-hit)
    if (cleanVal === targetRomaji) {
      if (soundEnabled) {
        sound.playCharacter(cell.charObj.char);
        sound.playCorrect();
      }
      updated[index].isCorrect = true;
      setCells(updated);

      const nextIndex = index + 1;
      if (nextIndex < cells.length) {
        // Advance to next cell
        setCurrentIndex(nextIndex);
        setTimeout(() => {
          focusInput(nextIndex);
        }, 15);
      } else {
        // Current Grid is finished!
        if (!isGrid2) {
          // Transition to Break Phase
          setPhase("break");
          if (soundEnabled) sound.playFanfare();
          startBreakCount();
        } else {
          // Entire speed quiz complete!
          finishSession();
        }
      }
    } else {
      // It is not matching yet. Let's see if what they have typed so far is completely wrong
      // E.g. they typed 'x' for 'ka' (no romaji starts with x) or full syllable typed is incorrect
      const wrongStart = !targetRomaji.startsWith(cleanVal) && cleanVal.length > 0;
      const wrongFull = cleanVal.length >= targetRomaji.length && cleanVal !== targetRomaji;

      if (wrongStart || wrongFull) {
        if (soundEnabled) sound.playIncorrect();
        updated[index].isCorrect = false;
        setIncorrectAttempts((prev) => prev + 1);
        setCells(updated);
      } else {
        // Clear error if they backspaced to an agreeable start
        updated[index].isCorrect = null;
        setCells(updated);
      }
    }
  };

  // Break Countdown Engine
  const startBreakCount = () => {
    setBreakLeft(300); // 5 minutes
    if (breakIntervalRef.current) clearInterval(breakIntervalRef.current);
    breakIntervalRef.current = window.setInterval(() => {
      setBreakLeft((prev) => {
        if (prev <= 1) {
          clearInterval(breakIntervalRef.current!);
          skipBreak();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const skipBreak = () => {
    if (breakIntervalRef.current) clearInterval(breakIntervalRef.current);
    setPhase("grid2");
    setCurrentIndex(0);
    // Reset timer anchor for grid 2, or accumulate time?
    // Let's reset the start time so the elapsed is purely active typing time! (Much fairer CPM scores)
    setStartTime(Date.now());
    setTimeout(() => {
      focusInput(0);
    }, 100);
  };

  const finishSession = () => {
    setIsRunning(false);
    setPhase("results");
    if (soundEnabled) sound.playFanfare();

    const totalChars = gridSize * 2;
    const finalSeconds = Math.max(1, elapsedTime);
    
    // Calculate Speed and Accuracy
    // CPM = (Correct characters entered / minutes)
    const minutes = finalSeconds / 60;
    const cpm = Math.round(totalChars / minutes);

    // Accuracy = (Total Correct Slots / (Total Correct Slots + Incorrect attempts))
    const incorrect = incorrectAttempts;
    const accuracy = Math.round((totalChars / (totalChars + incorrect)) * 100);

    onSessionComplete({
      cpm,
      accuracy,
      duration: finalSeconds,
      total: totalChars,
      correct: totalChars,
    });
  };

  const quitSession = () => {
    setIsRunning(false);
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    if (breakIntervalRef.current) clearInterval(breakIntervalRef.current);
    setPhase("setup");
  };

  // Helper to format break timer (mm:ss)
  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  };

  const safeElapsedTime = Math.max(1, elapsedTime);

  return (
    <div className="w-full bg-white rounded-[28px] sm:rounded-[32px] border-2 border-zinc-900 shadow-[5px_5px_0px_0px_rgba(0,0,0,1)] sm:shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] p-4 sm:p-6" id="speed-sheet-container">
      {/* Top Controller Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between border-b-2 border-zinc-200 pb-5 mb-6 gap-4">
        <div>
          <h2 className="text-xl font-black text-zinc-900 flex items-center gap-2 uppercase">
            <Zap className="h-5 w-5 text-amber-500 fill-amber-500" />
            Kana Speed Sheets
          </h2>
          <p className="text-xs text-zinc-400 font-bold uppercase tracking-wider mt-1">
            Write romaji above each character. Auto-advances instantly on correct hits!
          </p>
        </div>

        <div className="flex items-center gap-2 justify-end">
          {/* Audio toggle button */}
          <button
            onClick={() => {
              sound.playTick();
              setSoundEnabled(!soundEnabled);
            }}
            className={`px-3 py-2 rounded-2xl border-2 border-zinc-900 text-xs font-black uppercase transition-all flex items-center gap-1.5 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] cursor-pointer ${
              soundEnabled
                ? "bg-amber-400 text-zinc-950"
                : "bg-zinc-100 text-zinc-400"
            }`}
            title={soundEnabled ? "Mute sound feedback" : "Enable tactile sound feedback"}
          >
            {soundEnabled ? (
              <>
                <Volume2 className="h-4 w-4" />
                <span>Audio On</span>
              </>
            ) : (
              <>
                <VolumeX className="h-4 w-4" />
                <span>Muted</span>
              </>
            )}
          </button>

          {isRunning && (
            <button
              onClick={() => {
                sound.playTick();
                quitSession();
              }}
              className="px-3 py-2 border-2 border-zinc-900 text-red-650 text-red-600 bg-red-100 font-black uppercase tracking-wider text-xs rounded-2xl shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] transition-colors cursor-pointer"
            >
              Quit
            </button>
          )}
        </div>
      </div>

      {/* SETUP PHASE PANEL */}
      {phase === "setup" && (
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-center py-6 max-w-xl mx-auto"
        >
          <div className="w-16 h-16 bg-amber-400 rounded-3xl flex items-center justify-center mx-auto mb-4 border-2 border-zinc-900 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
            <CheckCircle2 className="h-8 w-8 text-zinc-900" />
          </div>
          <h3 className="text-xl font-black text-zinc-900 uppercase">Speed Run Calibration</h3>
          <p className="text-xs text-zinc-400 font-bold uppercase tracking-wide mt-1 mb-6">
            Practice typing Romaji instantly to supercharge your kana recall. Based on cognitive writing drills.
          </p>

          <div className="bg-zinc-55 bg-indigo-50/50 rounded-[24px] p-4 sm:p-5 border-2 border-zinc-900 text-left mb-6 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
            <h4 className="text-xs font-black uppercase tracking-widest text-zinc-400 mb-3 block">Configure Parameters</h4>
            
            {/* Grid size selection */}
            <div className="mb-4">
              <label className="block text-xs font-black text-zinc-900 uppercase tracking-wider mb-2">Total Characters per Grid:</label>
              <div className="grid grid-cols-3 gap-2">
                {[16, 32, 48].map((size) => (
                  <button
                    key={size}
                    type="button"
                    onClick={() => {
                      sound.playTick();
                      setGridSize(size);
                    }}
                    className={`py-2 px-3 text-xs rounded-xl border-2 border-zinc-900 font-black uppercase tracking-wider transition-all cursor-pointer ${
                      gridSize === size
                        ? "bg-zinc-900 text-white shadow-sm"
                        : "bg-white text-zinc-650 hover:bg-zinc-50"
                    }`}
                  >
                    {size} Chars
                  </button>
                ))}
              </div>
            </div>

            {normalizeActiveRows(activeRows).length === 0 ? (
              <div className="bg-amber-50 border-2 border-amber-300 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-start gap-2.5">
                  <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                  <span className="text-xs font-bold text-amber-900">No kana groups are active. Select groups in Glossary & Setups to start.</span>
                </div>
                {onGoToGlossary && (
                  <button onClick={onGoToGlossary} className="shrink-0 px-3 py-2 rounded-xl border-2 border-zinc-900 bg-amber-300 text-xs font-black uppercase">Go to Glossary</button>
                )}
              </div>
            ) : (
              <div className="text-xs text-zinc-400 font-bold uppercase tracking-wider flex items-start gap-2.5 bg-white rounded-xl p-3.5 border border-zinc-200">
                <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                <span>
                  Cards are drawn from active kana groups checkable in stats view. Active group count: {normalizeActiveRows(activeRows).length}.
                </span>
              </div>
            )}
          </div>

          <button
            onClick={() => {
              sound.playTick();
              startSession();
            }}
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-4 px-6 font-black uppercase tracking-wider rounded-2xl border-2 border-zinc-900 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] transition-transform active:translate-y-0.5 flex items-center justify-center gap-2 cursor-pointer"
          >
            <Play className="h-5 w-5 fill-current" />
            Launch Active Speed Sheet
          </button>
        </motion.div>
      )}

      {/* DRILL GRID 1 PANEL */}
      {phase === "grid1" && (
        <div className="space-y-6">
          <div className="flex flex-col min-[460px]:flex-row min-[460px]:items-center justify-between gap-2 py-2 border-b-2 border-dashed border-zinc-200">
            <div className="bg-amber-400 text-zinc-950 font-black px-3.5 py-1 text-xs rounded-full border-2 border-zinc-900 uppercase tracking-widest flex items-center gap-1 shadow-sm">
              <Zap className="h-3.5 w-3.5 fill-zinc-900 text-zinc-900" /> Grid 1 / Page 1
            </div>
            <div className="text-xs font-black uppercase tracking-wider text-zinc-600 flex items-center gap-2 bg-white border-2 border-zinc-900 px-3 py-1 rounded-xl shadow-sm">
              <Timer className="h-4 w-4 text-indigo-500 animate-pulse" />
              <span>Time: <strong className="font-mono">{elapsedTime}s</strong></span>
              <span className="text-zinc-300">|</span>
              <span>Errors: <strong className="font-mono text-red-600">{incorrectAttempts}</strong></span>
            </div>
          </div>

          {/* Grid Layout conforming to physical sheets */}
          <div className="grid grid-cols-3 min-[380px]:grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-[repeat(16,minmax(0,1fr))] border-2 border-zinc-900 rounded-3xl overflow-hidden bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
            {grid1Cells.map((cell, idx) => {
              const active = currentIndex === idx;
              let inputBorderColor = "border-zinc-200";
              let keyBgColor = "bg-white";
              
              if (cell.isCorrect === true) {
                inputBorderColor = "bg-emerald-400 text-zinc-950 font-black";
                keyBgColor = "bg-emerald-500 text-zinc-950 border-t border-zinc-300 font-extrabold";
              } else if (cell.isCorrect === false) {
                inputBorderColor = "bg-red-400 text-zinc-950 font-black animate-shake";
                keyBgColor = "bg-red-500 text-zinc-950 border-t border-zinc-300 font-extrabold";
              } else if (active) {
                inputBorderColor = "bg-white border-zinc-900 ring-2 ring-indigo-500";
                keyBgColor = "bg-indigo-105 bg-indigo-50 border-t border-zinc-300 font-extrabold";
              }

              return (
                <div key={cell.id} className="flex flex-col border-r border-b last:border-r-0 border-zinc-250 border-zinc-200 h-24 align-stretch">
                  {/* Romaji Input on top */}
                  <div className="flex-1 min-h-0 relative">
                    <input
                      ref={(el) => {
                        inputRefs.current[idx] = el;
                      }}
                      type="text"
                      maxLength={4}
                      value={cell.value}
                      disabled={cell.isCorrect === true}
                      placeholder="..."
                      onChange={(e) => handleCellChange(idx, e.target.value, false)}
                      className={`w-full h-full text-center font-black text-sm select-auto uppercase focus:outline-none focus:ring-0 transition-all ${inputBorderColor}`}
                    />
                  </div>

                  {/* Japanese Character below */}
                  <div className={`p-2.5 text-center font-sans font-black text-lg leading-none border-t border-zinc-200 flex items-center justify-center ${keyBgColor}`}>
                    {cell.charObj.char}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="text-right text-[10px] font-black text-zinc-400 uppercase tracking-widest font-mono">
            Active Focus: Row {currentIndex + 1} of {gridSize}
          </div>
        </div>
      )}

      {/* BREAK COUNTDOWN PANEL */}
      {phase === "break" && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-center py-10 max-w-lg mx-auto bg-zinc-900 text-white border-2 border-zinc-900 rounded-[32px] p-6 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]"
        >
          <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-400 text-zinc-950 text-xs font-black rounded-full mb-4 border border-zinc-900 uppercase tracking-widest heading-none">
            Grid 1 Cleared!
          </div>

          <h3 className="text-2xl font-black uppercase text-white mb-2">Cognitive Consolidation</h3>
          <p className="text-xs text-zinc-400 font-bold uppercase tracking-wider mb-6">
            Cognitive rest strengthens motor memory encoding. Let your brain lock in!
          </p>

          <div className="py-6 relative flex items-center justify-center">
            {/* Visual countdown ring representation */}
            <div className="w-36 h-36 rounded-full border-4 border-zinc-700 flex flex-col items-center justify-center">
              <span className="text-3xl font-mono font-black text-[#818cf8] block leading-none mb-1">
                {formatTime(breakLeft)}
              </span>
              <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Rest Left</span>
            </div>
          </div>

          <div className="mt-4 flex flex-col sm:flex-row items-stretch gap-2.5 justify-center">
            <button
              onClick={() => {
                sound.playTick();
                setBreakLeft((prev) => Math.max(10, prev - 60));
              }}
              className="py-3 px-4 bg-zinc-800 hover:bg-zinc-700 text-white rounded-2xl border border-zinc-700 font-black text-xs uppercase tracking-wider cursor-pointer"
            >
              -1 Min Rest
            </button>
            <button
              onClick={() => {
                sound.playTick();
                skipBreak();
              }}
              className="py-3 px-6 bg-emerald-400 hover:bg-emerald-500 text-zinc-950 rounded-2xl font-black text-xs uppercase tracking-wider flex items-center justify-center gap-1 cursor-pointer shadow-sm"
            >
              Skip rest & start Grid 2
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </motion.div>
      )}

      {/* DRILL GRID 2 PANEL */}
      {phase === "grid2" && (
        <div className="space-y-6">
          <div className="flex flex-col min-[460px]:flex-row min-[460px]:items-center justify-between gap-2 py-2 border-b-2 border-dashed border-zinc-200">
            <div className="bg-emerald-400 text-zinc-950 font-black px-3 py-1 text-xs rounded-full border-2 border-zinc-900 uppercase tracking-widest flex items-center gap-1 shadow-sm">
              <Zap className="h-3 w-3 fill-zinc-950 text-zinc-950" /> Grid 2 / Page 2
            </div>
            <div className="text-xs font-black uppercase tracking-wider text-zinc-650 text-zinc-700 flex items-center gap-2 bg-white border-2 border-zinc-900 px-3 py-1 rounded-xl shadow-sm">
              <Timer className="h-4 w-4 text-indigo-500 animate-pulse" />
              <span>Time: <strong className="font-mono">{elapsedTime}s</strong></span>
              <span className="text-zinc-350">|</span>
              <span>Errors: <strong className="font-mono text-red-650 text-red-600">{incorrectAttempts}</strong></span>
            </div>
          </div>

          {/* Grid Layout same as sheet */}
          <div className="grid grid-cols-3 min-[380px]:grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-[repeat(16,minmax(0,1fr))] border-2 border-zinc-900 rounded-3xl overflow-hidden bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
            {grid2Cells.map((cell, idx) => {
              const active = currentIndex === idx;
              let inputBorderColor = "border-zinc-200";
              let keyBgColor = "bg-white";
              
              if (cell.isCorrect === true) {
                inputBorderColor = "bg-emerald-400 text-zinc-950 font-black";
                keyBgColor = "bg-emerald-500 text-zinc-950 border-t border-zinc-300 font-extrabold";
              } else if (cell.isCorrect === false) {
                inputBorderColor = "bg-red-400 text-zinc-950 font-black animate-shake";
                keyBgColor = "bg-red-500 text-zinc-950 border-t border-zinc-300 font-extrabold";
              } else if (active) {
                inputBorderColor = "bg-white border-zinc-900 ring-2 ring-indigo-500";
                keyBgColor = "bg-indigo-50 border-t border-zinc-300 font-extrabold";
              }

              return (
                <div key={cell.id} className="flex flex-col border-r border-b boundary-zinc border-zinc-250 border-zinc-200 h-24 align-stretch">
                  <div className="flex-1 min-h-0 relative">
                    <input
                      ref={(el) => {
                        inputRefs.current[idx] = el;
                      }}
                      type="text"
                      maxLength={4}
                      value={cell.value}
                      disabled={cell.isCorrect === true}
                      placeholder="..."
                      onChange={(e) => handleCellChange(idx, e.target.value, true)}
                      className={`w-full h-full text-center font-black text-sm uppercase focus:outline-none focus:ring-0 transition-all ${inputBorderColor}`}
                    />
                  </div>

                  <div className={`p-2.5 text-center font-sans font-black text-lg leading-none border-t border-zinc-200 flex items-center justify-center ${keyBgColor}`}>
                    {cell.charObj.char}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="text-right text-[10px] font-black text-zinc-400 uppercase tracking-widest font-mono">
            Active Focus: Row {currentIndex + 1} of {gridSize}
          </div>
        </div>
      )}

      {/* RESULTS DISPLAY PANEL */}
      {phase === "results" && (
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          className="py-6 max-w-xl mx-auto space-y-6"
        >
          <div className="text-center mb-6">
            <div className="w-16 h-16 bg-zinc-900 border-2 border-zinc-950 text-white rounded-3xl flex items-center justify-center mx-auto mb-4 border border-slate-850 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
              <Zap className="h-8 w-8 fill-amber-400 text-amber-400" />
            </div>
            <h3 className="text-2xl font-black text-zinc-900 tracking-tight uppercase">Drill Scorecard</h3>
            <p className="text-xs text-zinc-400 font-bold uppercase tracking-wider mt-1">Excellent speed typing work on both grids</p>
          </div>

          {/* Core Stat Rings - Bento Style */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-orange-400 text-zinc-950 border-2 border-zinc-900 rounded-3xl p-5 text-center shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
              <span className="text-[10px] font-black uppercase tracking-widest text-zinc-900/60 block mb-1">CPM Speed</span>
              <span className="text-4xl font-extrabold font-mono block tracking-tight">
                {Math.round(gridSize * 2 / (safeElapsedTime / 60))}
              </span>
              <span className="text-[10px] font-bold uppercase tracking-wider opacity-60">Chars / Minute</span>
            </div>

            <div className="bg-zinc-900 text-white rounded-3xl p-5 text-center border-2 border-zinc-900 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
              <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400 block mb-1">Accuracy Goal</span>
              <span className="text-4xl font-extrabold text-indigo-400 font-mono block tracking-tight">
                {Math.round((gridSize * 2 / (gridSize * 2 + incorrectAttempts)) * 100)}%
              </span>
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block">Total keystrokes</span>
            </div>
          </div>

          <div className="border-2 border-zinc-900 rounded-3xl p-5 bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] space-y-3 text-xs uppercase font-bold tracking-wider text-zinc-550 text-zinc-500">
            <div className="flex items-center justify-between">
              <span>Characters Completed:</span>
              <span className="font-mono text-zinc-900 font-black text-sm">{gridSize * 2} keys</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Mistakes Logged:</span>
              <span className="font-mono text-red-650 text-red-650 text-red-600 font-black text-sm">{incorrectAttempts} misses</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Active typing time:</span>
              <span className="font-mono text-zinc-900 font-black text-sm">{safeElapsedTime}s elapsed</span>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={() => {
                sound.playTick();
                startSession();
              }}
              className="flex-1 bg-zinc-900 hover:bg-zinc-800 text-white font-black uppercase tracking-wider py-4 px-5 rounded-2xl text-xs border-2 border-zinc-900 shadow-[4px_4px_0px_0px_rgba(0,0,0,0.95)] transition-transform active:translate-y-0.5 cursor-pointer flex items-center justify-center gap-1.5"
            >
              <RefreshCw className="h-4 w-4" />
              Retake Speed Test
            </button>
            <button
              onClick={() => {
                sound.playTick();
                setPhase("setup");
              }}
              className="flex-1 bg-white hover:bg-zinc-55 hover:bg-zinc-100 text-zinc-800 font-black uppercase tracking-wider py-4 px-5 rounded-2xl text-xs border-2 border-zinc-900 shadow-[4px_4px_0px_0px_rgba(0,0,0,0.95)] transition-transform active:translate-y-0.5 cursor-pointer"
            >
              Configure Params
            </button>
          </div>
        </motion.div>
      )}
    </div>
  );
};
export default SpeedSheet;

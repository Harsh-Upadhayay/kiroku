import type { N5GrammarPoint } from "../content/n5/parser";
import type { N5DayProgress } from "./n5-course";

export type CellState = "current" | "learnt" | "skipped" | "none";

export function vocabCellState(
  entry: { id: string },
  i: number,
  state: N5DayProgress,
  learnedVocab: Set<string>,
  deferredVocab: Set<string>,
): CellState {
  if (state.stage === "vocab" && state.vocabIndex === i) return "current";
  if (deferredVocab.has(entry.id)) return "skipped";
  if (learnedVocab.has(entry.id)) return "learnt";
  if (state.stagesCompleted?.vocab) return "learnt";
  return "none";
}

export function kanjiCellState(
  entry: { kanji: string; id: string },
  i: number,
  state: N5DayProgress,
  learnedKanji: Set<string>,
  deferredKanji: Set<string>,
): CellState {
  if (state.stage === "kanji" && state.kanjiIndex === i) return "current";
  if (deferredKanji.has(entry.kanji)) return "skipped";
  if (learnedKanji.has(entry.kanji)) return "learnt";
  if (state.stagesCompleted?.kanji) return "learnt";
  return "none";
}

export function grammarCellState(
  point: N5GrammarPoint,
  i: number,
  state: N5DayProgress,
  learnedGrammar: Set<string>,
): CellState {
  if (state.stage === "grammar" && state.grammarIndex === i) return "current";
  if (learnedGrammar.has(point.id)) return "learnt";
  if (state.stagesCompleted?.grammar) return "learnt";
  return state.grammarIndex > i ? "learnt" : "none";
}

export function reviewCellState(state: N5DayProgress, dueCardCount: number): CellState {
  if (state.stage === "review") return "current";
  if (state.stagesCompleted?.review) return "learnt";
  return dueCardCount === 0 ? "learnt" : "none";
}

export function produceCellState(state: N5DayProgress): CellState {
  if (state.stage === "produce") return "current";
  if (state.stagesCompleted?.produce) return "learnt";
  return "none";
}

export function doneCellState(state: N5DayProgress): CellState {
  if (state.stage === "done") return "current";
  if (state.stagesCompleted?.done) return "learnt";
  return "none";
}

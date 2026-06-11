/**
 * Pure functions extracted from component inline logic so they can be unit-tested.
 * Each function is annotated with the bug it covers.
 */

import {
  N5_STAGE_ORDER,
  getN5DayState,
  updateN5DayState,
  type N5CourseProgress,
  type N5DayProgress,
  type N5Stage,
} from "./n5-course";

// ---------------------------------------------------------------------------
// BUG-02: Minimap navigation guard
// ---------------------------------------------------------------------------

/**
 * Returns whether the minimap is allowed to navigate to targetStage.
 * "Done" must not be reachable directly unless Produce is complete.
 * BUG-02: current handleMinimapNavigate has no guard at all.
 */
export function canMinimapNavigate(
  targetStage: N5Stage,
  stagesCompleted: Partial<Record<N5Stage, boolean>>,
): boolean {
  if (targetStage === "done" && !stagesCompleted.produce) return false;
  return true;
}

// ---------------------------------------------------------------------------
// BUG-03: Silent-reload day-state preservation
// ---------------------------------------------------------------------------

/**
 * When a sync event triggers a silent reload, keep the in-memory day state
 * if it is newer than what came off disk, to avoid overwriting the user's
 * in-progress lesson with a stale server snapshot.
 *
 * BUG-03: in the component the `reload` closure captures `activeDayNumber`
 * at mount time (usually 1). If the user has navigated to day 5, the wrong
 * day's state is compared and day-5 progress is silently discarded.
 * Fix: pass the CURRENT activeDayNumber (via ref or effect deps) to this
 * function instead of a stale closure value.
 */
export function selectPreservedProgress(
  current: N5CourseProgress,
  trended: N5CourseProgress,
  activeDayNumber: number,
): N5CourseProgress {
  const memState = getN5DayState(current, activeDayNumber);
  const diskState = getN5DayState(trended, activeDayNumber);
  if (memState.updatedAt && (!diskState.updatedAt || memState.updatedAt >= diskState.updatedAt)) {
    return updateN5DayState(trended, activeDayNumber, memState);
  }
  return trended;
}

// ---------------------------------------------------------------------------
// BUG-04: MC review keyboard handler
// ---------------------------------------------------------------------------

/**
 * Returns true when Enter/Space should submit a grade.
 * BUG-04: current code guards with `pickedIndex !== null`, which is false
 * after "Show Answer" (answer revealed without picking an option).
 * Fix: `revealed` alone is sufficient — the user has seen the answer.
 */
export function mcEnterKeyGrades(revealed: boolean, _pickedIndex: number | null): boolean {
  return revealed;
}

/**
 * Full keyboard action resolver for the MC review panel.
 * Returns what action the keypress should trigger, or null if no action.
 */
export type McKeyAction =
  | { type: "showAnswer" }
  | { type: "grade" }
  | { type: "pick"; idx: number }
  | null;

export function mcKeyAction(
  key: string,
  revealed: boolean,
  pickedIndex: number | null,
  optionCount: number,
): McKeyAction {
  if (!revealed) {
    if (key === " " || key === "Enter") return { type: "showAnswer" };
    const n = Number(key);
    if (n >= 1 && n <= 4 && n - 1 < optionCount) return { type: "pick", idx: n - 1 };
    return null;
  }
  // Revealed: Enter/Space grade regardless of how the answer was shown.
  if (key === "Enter" || key === " ") return { type: "grade" };
  if (["1", "2", "3", "4"].includes(key)) return { type: "grade" };
  return null;
}

// ---------------------------------------------------------------------------
// BUG-05: Display position counter
// ---------------------------------------------------------------------------

/**
 * Returns the 1-based position label for the current vocab item.
 * BUG-05: current code uses `vocabIndex + deferredCount + 1`, which
 * overcounts once any items are deferred mid-queue.
 */
export function vocabDisplayPos(vocabIndex: number, queueLength: number): number {
  return Math.min(vocabIndex + 1, queueLength);
}

export function kanjiDisplayPos(kanjiIndex: number, queueLength: number): number {
  return Math.min(kanjiIndex + 1, queueLength);
}

// ---------------------------------------------------------------------------
// BUG-08: In-flight grade guard
// ---------------------------------------------------------------------------

/**
 * Returns true when grading is allowed: not already in-flight and card exists.
 * BUG-08: current code has no isGrading guard, so rapid double-tap can
 * grade the same card twice before the async persist resolves.
 */
export function canGradeCard(isGrading: boolean, card: { id: string } | null): boolean {
  return !isGrading && card !== null;
}

// ---------------------------------------------------------------------------
// BUG-09: ReadOnly stage advance
// ---------------------------------------------------------------------------

/**
 * Returns the next stage after completing `stage`, skipping any stages
 * already marked complete in stagesCompleted.
 * BUG-09: the readOnly completeStage path in N5CoursePage does a naive
 * +1 advance without checking stagesCompleted, so it can land on an
 * already-completed stage instead of skipping ahead.
 */
export function nextStageAfterComplete(
  stage: N5Stage,
  stagesCompleted: Partial<Record<N5Stage, boolean>>,
): N5Stage {
  const updatedCompleted = { ...stagesCompleted, [stage]: true };
  const currentIndex = N5_STAGE_ORDER.indexOf(stage);
  let next: N5Stage = N5_STAGE_ORDER[Math.min(N5_STAGE_ORDER.length - 1, currentIndex + 1)];
  for (let i = currentIndex + 1; i < N5_STAGE_ORDER.length; i++) {
    if (!updatedCompleted[N5_STAGE_ORDER[i]]) {
      next = N5_STAGE_ORDER[i];
      break;
    }
  }
  return next;
}

// ---------------------------------------------------------------------------
// BUG-14: "Finish section" visibility
// ---------------------------------------------------------------------------

/**
 * Returns true when the "Finish section (N skipped)" button should be shown.
 * Conditions: current item is NOT itself deferred, and every item after it is.
 *
 * BUG-14: current tailAllSkipped uses `queue.slice(vocabIndex)` which
 * includes the current item. When the last deferred item is current,
 * tailAllSkipped=true even though the primary button already handles it,
 * causing two simultaneous completion actions to appear.
 */
export function shouldShowFinishSection(
  currentIndex: number,
  queue: { id: string }[],
  deferredIds: string[],
): boolean {
  const deferredSet = new Set(deferredIds);
  if (deferredSet.size === 0) return false;
  const currentItem = queue[currentIndex];
  if (!currentItem) return false;
  if (deferredSet.has(currentItem.id)) return false;
  const after = queue.slice(currentIndex + 1);
  return after.length > 0 && after.every((e) => deferredSet.has(e.id));
}

// ---------------------------------------------------------------------------
// BUG-16: "Due now" stat tile accent colour
// ---------------------------------------------------------------------------

/**
 * Returns the Tailwind accent class for the "Due now" stat tile.
 * BUG-16: current code hardcodes "text-amber-700" regardless of count,
 * so "Due now · 0" appears in orange (urgency colour) when nothing is overdue.
 */
export function dueStatAccent(dueCount: number): string {
  return dueCount > 0 ? "text-amber-700" : "text-zinc-400";
}

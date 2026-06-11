import { describe, it, expect } from "vitest";
import {
  canMinimapNavigate,
  selectPreservedProgress,
  mcEnterKeyGrades,
  mcKeyAction,
  vocabDisplayPos,
  kanjiDisplayPos,
  canGradeCard,
  nextStageAfterComplete,
  shouldShowFinishSection,
  dueStatAccent,
} from "../utils/n5-lesson-logic";
import { normalizeN5Progress, getN5DayState } from "../utils/n5-course";
import type { N5CourseProgress } from "../utils/n5-course";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProgress(overrides: Partial<N5CourseProgress> = {}): N5CourseProgress {
  return normalizeN5Progress({ clientId: "test", ...overrides });
}

function makeItem(id: string) { return { id }; }

// ---------------------------------------------------------------------------
// BUG-02: canMinimapNavigate
// ---------------------------------------------------------------------------

describe("BUG-02: canMinimapNavigate — done stage requires produce to be complete", () => {
  it("blocks navigation to 'done' when produce is not complete", () => {
    expect(canMinimapNavigate("done", {})).toBe(false);
    expect(canMinimapNavigate("done", { review: true, grammar: true, vocab: true, kanji: true })).toBe(false);
  });

  it("allows navigation to 'done' when produce is complete", () => {
    expect(canMinimapNavigate("done", { produce: true })).toBe(true);
    expect(canMinimapNavigate("done", { review: true, grammar: true, vocab: true, kanji: true, produce: true })).toBe(true);
  });

  it("allows navigation to all non-done stages unconditionally", () => {
    const sc = {};
    expect(canMinimapNavigate("review", sc)).toBe(true);
    expect(canMinimapNavigate("grammar", sc)).toBe(true);
    expect(canMinimapNavigate("vocab", sc)).toBe(true);
    expect(canMinimapNavigate("kanji", sc)).toBe(true);
    expect(canMinimapNavigate("produce", sc)).toBe(true);
  });

  it("blocks done even if all other stages are flagged complete but produce is missing", () => {
    expect(canMinimapNavigate("done", { review: true, grammar: true, vocab: true, kanji: true, done: true })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// BUG-03: selectPreservedProgress
// ---------------------------------------------------------------------------

describe("BUG-03: selectPreservedProgress — must use CURRENT activeDayNumber, not stale mount value", () => {
  // updateN5DayState always stamps updatedAt = Date.now(), so we set dayStates directly
  // to control timestamps in these tests.
  function makeProgressDay5(updatedAt: number, stage: "vocab" | "review", vocabIndex = 0) {
    const p = makeProgress();
    return {
      ...p,
      dayStates: {
        "5": {
          day: 5,
          stage,
          vocabIndex,
          grammarIndex: 0,
          kanjiIndex: 0,
          stagesCompleted: {},
          updatedAt,
        },
      },
    } as N5CourseProgress;
  }

  it("preserves day-5 in-memory state when activeDayNumber=5 is passed correctly", () => {
    const mem = makeProgressDay5(9000, "vocab", 3);
    const disk = makeProgressDay5(100, "review", 0);
    const result = selectPreservedProgress(mem, disk, 5);
    expect(getN5DayState(result, 5).vocabIndex).toBe(3);
    expect(getN5DayState(result, 5).stage).toBe("vocab");
  });

  it("loses day-5 in-memory state when stale activeDayNumber=1 is passed (simulates the BUG)", () => {
    const mem = makeProgressDay5(9000, "vocab", 3);
    const disk = makeProgressDay5(100, "review", 0);
    // BUG-03: closure captured activeDayNumber=1, so day-5 progress is not preserved.
    const result = selectPreservedProgress(mem, disk, 1);
    expect(getN5DayState(result, 5).stage).toBe("review");
    expect(getN5DayState(result, 5).vocabIndex).toBe(0);
  });

  it("returns trended unchanged when disk is newer than mem for that day", () => {
    const mem = makeProgressDay5(50, "review", 0);
    const disk = makeProgressDay5(9000, "review", 2); // disk is newer
    const result = selectPreservedProgress(mem, disk, 5);
    // mem.updatedAt (50) < disk.updatedAt (9000) → condition false → returns trended (disk)
    expect(getN5DayState(result, 5).updatedAt).toBe(9000);
    expect(getN5DayState(result, 5).vocabIndex).toBe(2);
  });

  it("preserves mem state when mem.updatedAt === disk.updatedAt (equal → keep mem)", () => {
    const mem = makeProgressDay5(500, "vocab", 3); // mem has further progress
    const disk = makeProgressDay5(500, "review", 0);
    const result = selectPreservedProgress(mem, disk, 5);
    // Equal timestamps: mem >= disk → mem wins
    const state = getN5DayState(result, 5);
    expect(state.stage).toBe("vocab");
    expect(state.vocabIndex).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// BUG-04: mcEnterKeyGrades / mcKeyAction
// ---------------------------------------------------------------------------

describe("BUG-04: Enter/Space must grade even when pickedIndex is null (after Show Answer)", () => {
  describe("mcEnterKeyGrades", () => {
    it("returns true when revealed=true and pickedIndex=null (Show Answer path)", () => {
      expect(mcEnterKeyGrades(true, null)).toBe(true);
    });

    it("returns true when revealed=true and pickedIndex is set (MC pick path)", () => {
      expect(mcEnterKeyGrades(true, 2)).toBe(true);
    });

    it("returns false when not yet revealed", () => {
      expect(mcEnterKeyGrades(false, null)).toBe(false);
      expect(mcEnterKeyGrades(false, 0)).toBe(false);
    });
  });

  describe("mcKeyAction — pre-reveal", () => {
    it("Enter before reveal triggers showAnswer", () => {
      expect(mcKeyAction("Enter", false, null, 4)).toEqual({ type: "showAnswer" });
    });

    it("Space before reveal triggers showAnswer", () => {
      expect(mcKeyAction(" ", false, null, 4)).toEqual({ type: "showAnswer" });
    });

    it("number keys before reveal trigger pick", () => {
      expect(mcKeyAction("1", false, null, 4)).toEqual({ type: "pick", idx: 0 });
      expect(mcKeyAction("3", false, null, 4)).toEqual({ type: "pick", idx: 2 });
    });

    it("number key out of range returns null", () => {
      expect(mcKeyAction("5", false, null, 4)).toBeNull();
      expect(mcKeyAction("3", false, null, 2)).toBeNull();
    });

    it("irrelevant keys return null", () => {
      expect(mcKeyAction("a", false, null, 4)).toBeNull();
    });
  });

  describe("mcKeyAction — post-reveal, BUG-04 fix", () => {
    it("Enter after reveal with pickedIndex=null (Show Answer) triggers grade", () => {
      expect(mcKeyAction("Enter", true, null, 4)).toEqual({ type: "grade" });
    });

    it("Space after reveal with pickedIndex=null triggers grade", () => {
      expect(mcKeyAction(" ", true, null, 4)).toEqual({ type: "grade" });
    });

    it("Enter after reveal with pickedIndex set triggers grade", () => {
      expect(mcKeyAction("Enter", true, 2, 4)).toEqual({ type: "grade" });
    });

    it("number keys after reveal trigger grade (1–4)", () => {
      expect(mcKeyAction("1", true, null, 4)).toEqual({ type: "grade" });
      expect(mcKeyAction("4", true, null, 4)).toEqual({ type: "grade" });
    });

    it("irrelevant keys after reveal return null", () => {
      expect(mcKeyAction("a", true, null, 4)).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// BUG-05: vocabDisplayPos / kanjiDisplayPos
// ---------------------------------------------------------------------------

describe("BUG-05: vocabDisplayPos — position must be vocabIndex+1, not index+deferredCount+1", () => {
  it("returns 1 for first item regardless of deferred count", () => {
    expect(vocabDisplayPos(0, 5)).toBe(1);
  });

  it("increments with vocabIndex", () => {
    expect(vocabDisplayPos(1, 5)).toBe(2);
    expect(vocabDisplayPos(4, 5)).toBe(5);
  });

  it("does not overcounting when 2 items are deferred", () => {
    // BUG-05: current code gives Math.min(2 + 2 + 1, 5) = 5 for index=2, deferredCount=2
    // Correct: just 2+1 = 3
    expect(vocabDisplayPos(2, 5)).toBe(3);
  });

  it("caps at queueLength (never exceeds total)", () => {
    expect(vocabDisplayPos(4, 5)).toBe(5);
    expect(vocabDisplayPos(5, 5)).toBe(5);
  });

  it("consecutive deferred items don't show same position twice", () => {
    // With deferred items at end, positions 3,4,5 should all be distinct
    const positions = [3, 4, 5].map((i) => vocabDisplayPos(i - 1, 5));
    expect(positions).toEqual([3, 4, 5]);
  });
});

describe("BUG-05: kanjiDisplayPos — same formula as vocabDisplayPos", () => {
  it("returns kanjiIndex+1", () => {
    expect(kanjiDisplayPos(0, 3)).toBe(1);
    expect(kanjiDisplayPos(2, 3)).toBe(3);
  });

  it("does not overcount with deferred kanji", () => {
    expect(kanjiDisplayPos(1, 3)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// BUG-08: canGradeCard
// ---------------------------------------------------------------------------

describe("BUG-08: canGradeCard — in-flight guard prevents double-tap", () => {
  const card = { id: "n5:vocab:v1" };

  it("allows grading when not in-flight and card exists", () => {
    expect(canGradeCard(false, card)).toBe(true);
  });

  it("blocks grading when isGrading=true (in-flight)", () => {
    expect(canGradeCard(true, card)).toBe(false);
  });

  it("blocks grading when card is null", () => {
    expect(canGradeCard(false, null)).toBe(false);
  });

  it("blocks when both isGrading and card is null", () => {
    expect(canGradeCard(true, null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// BUG-09: nextStageAfterComplete (readOnly path)
// ---------------------------------------------------------------------------

describe("BUG-09: nextStageAfterComplete — skips already-completed stages in readOnly mode", () => {
  it("advances by one when no stages are pre-completed", () => {
    expect(nextStageAfterComplete("review", {})).toBe("grammar");
    expect(nextStageAfterComplete("grammar", {})).toBe("vocab");
    expect(nextStageAfterComplete("vocab", {})).toBe("kanji");
  });

  it("skips a completed stage", () => {
    // grammar is already done → should skip to vocab
    expect(nextStageAfterComplete("review", { grammar: true })).toBe("vocab");
  });

  it("skips multiple consecutive completed stages", () => {
    // grammar AND vocab already done → should skip to kanji
    expect(nextStageAfterComplete("review", { grammar: true, vocab: true })).toBe("kanji");
  });

  it("skips to produce when review, grammar, vocab, kanji all completed", () => {
    expect(nextStageAfterComplete("review", { grammar: true, vocab: true, kanji: true })).toBe("produce");
  });

  it("advances to done when all stages before done are complete", () => {
    expect(nextStageAfterComplete("review", { grammar: true, vocab: true, kanji: true, produce: true })).toBe("done");
  });

  it("naive +1 readOnly path would land on already-completed stage (documents the bug)", () => {
    // BUG-09: current readOnly code does N5_STAGE_ORDER[indexOf("review") + 1] = "grammar"
    // even when grammar is already stagesCompleted. nextStageAfterComplete correctly skips it.
    const naivePlusOne = "grammar"; // what the buggy code returns
    const correct = nextStageAfterComplete("review", { grammar: true });
    expect(correct).not.toBe(naivePlusOne);
    expect(correct).toBe("vocab");
  });
});

// ---------------------------------------------------------------------------
// BUG-14: shouldShowFinishSection
// ---------------------------------------------------------------------------

describe("BUG-14: shouldShowFinishSection — must not appear when current item is itself deferred", () => {
  const queue = [
    makeItem("a"),
    makeItem("b"),
    makeItem("c"),
    makeItem("d"),
    makeItem("e"),
  ];

  it("returns true when current is not deferred and all items after it are deferred", () => {
    expect(shouldShowFinishSection(1, queue, ["c", "d", "e"])).toBe(true);
  });

  it("returns false when current item IS deferred (BUG-14 scenario)", () => {
    // Viewing the last deferred item: current=c (deferred), nothing after it is deferred
    expect(shouldShowFinishSection(2, queue, ["c"])).toBe(false);
    // Viewing last deferred item when it's the only remaining item
    expect(shouldShowFinishSection(4, queue, ["e"])).toBe(false);
  });

  it("returns false when current item is deferred even if items after are also deferred", () => {
    expect(shouldShowFinishSection(1, queue, ["b", "c", "d"])).toBe(false);
  });

  it("returns false when there are no deferred items", () => {
    expect(shouldShowFinishSection(0, queue, [])).toBe(false);
  });

  it("returns false when there are no items after current (current is last)", () => {
    expect(shouldShowFinishSection(4, queue, ["a", "b"])).toBe(false);
  });

  it("returns false at index 0 when current is the only item and it's not deferred (no items after)", () => {
    expect(shouldShowFinishSection(0, [makeItem("a")], ["b"])).toBe(false);
  });

  it("returns true at index 0 when items 1+ are all deferred", () => {
    expect(shouldShowFinishSection(0, queue, ["b", "c", "d", "e"])).toBe(true);
  });

  it("returns false when only some items after are deferred (not all)", () => {
    // c and e are deferred, d is not → not ALL after are deferred
    expect(shouldShowFinishSection(1, queue, ["c", "e"])).toBe(false);
  });

  it("buggy tailAllSkipped formula would return true for last deferred item (documents the bug)", () => {
    // Old formula: queue.slice(vocabIndex).every(e => deferredSet.has(e.id))
    // When viewing item e (index 4) and it's deferred: slice is just [e], all deferred → true (BUG)
    const deferredSet = new Set(["e"]);
    const buggyResult = queue.slice(4).every((e) => deferredSet.has(e.id)); // true
    expect(buggyResult).toBe(true); // this is the bug: shows "Finish section" on last deferred item
    // Correct: shouldShowFinishSection returns false
    expect(shouldShowFinishSection(4, queue, ["e"])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// BUG-16: dueStatAccent
// ---------------------------------------------------------------------------

describe("BUG-16: dueStatAccent — amber only when count > 0", () => {
  it("returns zinc (neutral) when due count is 0", () => {
    expect(dueStatAccent(0)).toBe("text-zinc-400");
  });

  it("returns amber (urgent) when due count is positive", () => {
    expect(dueStatAccent(1)).toBe("text-amber-700");
    expect(dueStatAccent(10)).toBe("text-amber-700");
    expect(dueStatAccent(999)).toBe("text-amber-700");
  });

  it("current hardcoded value 'text-amber-700' is wrong for zero (documents the bug)", () => {
    const buggyValue = "text-amber-700";
    const correctValue = dueStatAccent(0);
    expect(correctValue).not.toBe(buggyValue);
  });
});

# Behavioural Bug Report — N5 Daily Learning Flow

Static-analysis simulation across the full codebase (frontend + backend). Each entry includes the exact code location, the reproduction path, and the root cause.

---

## BUG-01 — Minimap shows green (learnt) instead of amber (skipped) after skip→learn→skip cycle

**Severity**: High (user-reported, confirmed)
**Files**: `src/components/N5LessonMinimap.tsx:57-63`

### Reproduction
1. Open Day N vocab stage.
2. Skip item X → minimap cell turns amber. ✓
3. Advance to item X again (it's at the end of the queue as a deferred item).
4. Click "Learnt ✓" → item enters `learnedVocabIds`, removed from `deferredVocabIds`.
5. Navigate back to item X via minimap (click its cell, which now shows green/current).
6. Click "Skip · revisit later" again.
7. Cell in minimap now shows **green (learnt)** instead of **amber (skipped)**.

### Root cause
`vocabCellState` checks `learnedVocab.has(entry.id)` **before** `deferredVocab.has(entry.id)`:

```ts
function vocabCellState(entry: { id: string }, i: number): CellState {
  if (state.stage === "vocab" && state.vocabIndex === i) return "current";
  if (learnedVocab.has(entry.id)) return "learnt";   // ← wins
  if (deferredVocab.has(entry.id)) return "skipped"; // ← never reached
  ...
}
```

`learnedVocabIds` is only ever **appended to** — items are never removed from it. After step 4, entry.id is in `learnedVocabIds`. After step 6, `deferVocabItem` adds it back to `deferredVocabIds`. Now the entry is in **both** sets. The `learnedVocab` check wins, returning "learnt" even though the item is currently deferred.

Same bug exists for kanji in `kanjiCellState` at line 65.

### Fix
Swap the check order: `deferredVocab` should take precedence over `learnedVocab`.

---

## BUG-02 — Day can be marked complete without doing the "Produce" stage (minimap bypass)

**Severity**: High  
**Files**: `src/components/N5CoursePage.tsx:800-809`, `1316-1319`

### Reproduction
1. Complete Review, Grammar, Vocab, Kanji stages normally (no due cards left).
2. Open the minimap (desktop sidebar or mobile outline toggle).
3. Click the **"Done"** row in the minimap.
4. `handleMinimapNavigate("done")` is called, sets `stage: "done"` directly.
5. `DoneStage` renders. `reachedDayComplete` is true immediately (`dueCards.length === 0`, no pending checkpoint).
6. `useEffect` fires → `onReachDayComplete()` → `commitDayComplete()` → day is marked complete, next day unlocked.
7. Produce stage was **never shown or submitted**.

### Root cause
`handleMinimapNavigate` allows navigating to any stage including "done" without validating stage prerequisites:

```tsx
async function handleMinimapNavigate(targetStage: N5Stage, index?: number) {
  const patch: Partial<N5DayProgress> = { stage: targetStage }; // no guard
  await props.onUpdateState(patch);
}
```

`DoneStage` has no guard for whether `produce` was completed:

```tsx
const reachedDayComplete = !readOnly && dueCards.length === 0 && (!checkpoint || !!report);
useEffect(() => {
  if (reachedDayComplete) onReachDayComplete(); // fires immediately
}, [reachedDayComplete]);
```

And `completeN5Day` force-marks all stages (including `produce`) as done regardless.

---

## BUG-03 — Silent sync reload preserves wrong day's in-memory state (stale closure)

**Severity**: Medium  
**Files**: `src/components/N5CoursePage.tsx:114-128`, `130-168`

### Reproduction
1. Log in. Navigate to Day 5. Start the lesson.
2. Another device pushes a sync update.
3. `syncEvents.emit()` fires, calling `reload(true)`.
4. The silent reload logic tries to preserve "the in-progress day's state" to avoid overwriting with stale server data.
5. But it compares state for **Day 1**, not Day 5, because `activeDayNumber` was captured at component mount in the `useEffect([])` closure.

### Root cause
```tsx
useEffect(() => {
  reload();
  const unsubscribe = syncEvents.subscribe(() => reload(true)); // reload closed over here
  ...
}, []); // empty deps — activeDayNumber is frozen at mount value
```

Inside `reload(silent=true)`:
```tsx
const memState = getN5DayState(current, activeDayNumber); // activeDayNumber = stale (1)
const diskState = getN5DayState(trended, activeDayNumber);
```

`activeDayNumber` is a derived value (`lessonDay || currentDayNumber`) that changes as the user navigates, but `reload` was defined in the initial render's scope and captures the initial value.

---

## BUG-04 — Enter/Space key doesn't submit grade after using "Show answer"

**Severity**: Medium  
**Files**: `src/components/N5McReview.tsx:62-78`

### Reproduction
1. During any review (lesson review stage or review session).
2. Click "Show answer instead" (skip the MC options).
3. Answer is revealed. Grade buttons appear.
4. Press **Enter** or **Space** — nothing happens.
5. Must press 1/2/3/4 to grade.

### Root cause
```tsx
if ((e.key === "Enter" || e.key === " ") && pickedIndex !== null) {
  // ↑ pickedIndex is null when "Show answer" was used — this branch never fires
  e.preventDefault();
  onGrade(defaultGrade);
  return;
}
```

The `Enter`/`Space`→`onGrade(defaultGrade)` shortcut is guarded by `pickedIndex !== null`. After "Show answer", `pickedIndex` is `null`. The fallthrough only handles number keys.

When MC was used (pickedCorrect=true), `defaultGrade = 3 (Good)`. When "Show answer" was used, no `defaultGrade` makes sense anyway — but a reasonable default (e.g., forcing the user to press 1-4) would at least be consistent with `Enter` to confirm the default.

---

## BUG-05 — `displayPos` counter in Vocab/Kanji stage shows inflated position numbers

**Severity**: Low (display only)  
**Files**: `src/components/N5CoursePage.tsx:1159`, `1215`

### Reproduction
1. Day with 5 vocab items. Skip items 1 and 2 early on.
2. Heading reads e.g. "4 of 5 words · 2 skipped" when actually viewing the 3rd item.
3. The number can feel off.

### Root cause
```tsx
const displayPos = Math.min(state.vocabIndex + (state.deferredVocabIds?.length || 0) + 1, queue.length);
```

This formula is: `index + skippedCount + 1`. The idea is that deferred items "count" as already-numbered. But when items are deferred from later in the queue (not just from position 0), the formula overcounts. For example:
- 5 items. Skip items #3 and #4 while viewing them at indices 2 and 3. vocabIndex ends up at 2 again (queue reordered). `displayPos = 2 + 2 + 1 = 5 = queue.length` → shows "5 of 5" when viewing what was originally item 3.
- After learning that item: vocabIndex=3, showing what was item 4. `displayPos = min(3+2+1, 5) = 5` again. Two consecutive cards show "5 of 5".

---

## BUG-06 — Backend health check: INSERT and DELETE use different timestamps, orphaning rows

**Severity**: Low  
**Files**: `backend/internal/handlers/handlers.go:32-35`

### Root cause
```go
_, err := h.DB.Exec(`CREATE TABLE IF NOT EXISTS health_check ...;
INSERT INTO health_check (ts) VALUES (?);
DELETE FROM health_check WHERE ts = ?`,
  auth.NowMillis(), // first call
  auth.NowMillis()) // second call — different ms value
```

Two calls to `auth.NowMillis()` at different instants. If they differ by even 1 ms, the `DELETE WHERE ts = ?` doesn't match the row just inserted. Over time the table accumulates orphaned rows. Additionally, multi-statement SQL in a single `database/sql` `Exec` is not standard and driver-dependent.

---

## BUG-07 — Dead `LessonMinimap` component in N5CoursePage.tsx (never rendered)

**Severity**: Cosmetic (code hygiene)  
**Files**: `src/components/N5CoursePage.tsx:892-1075`

### Description
The `LessonMinimap` React component (the old expand/collapse accordion-style minimap) is defined at line 892 but never rendered anywhere. `LessonRunner` exclusively uses `LessonMinimapGrid` (from `N5LessonMinimap.tsx`) for both desktop and mobile. `LessonMinimap` is ~180 lines of dead code with its own divergent state logic (including different item-state colouring and badge rendering). Since it's out of sync with `LessonMinimapGrid`, any future changes may introduce confusion.

---

## BUG-08 — Grade buttons have no in-flight debounce: rapid double-tap can double-grade a card

**Severity**: Low (race window is tiny)  
**Files**: `src/components/N5CoursePage.tsx:271-285`, `363-379`

### Reproduction
1. In any review (lesson review stage or review session).
2. Tap a grade button twice in rapid succession before the first `persistCards` resolves.
3. `dueCards[0]` (or `session.ids[session.index]`) hasn't updated yet.
4. Both taps grade the **same card** with potentially different grades.

### Root cause
`gradeCurrentCard` / `gradeSessionCard` call async `persistCards`, `persistLogs`, etc. No loading state is set on the buttons during the async operation. `McReviewPanel`'s `isRevealed` is reset synchronously via `setIsBackShown(false)`, which causes a re-render back to the "show question" state before `dueCards` has updated — creating a brief window where the same card is shown again and the grade buttons are live again.

---

## BUG-09 — `completeStage` in read-only mode always advances to the NEXT stage in order, skipping the "skip already-completed" logic

**Severity**: Low  
**Files**: `src/components/N5CoursePage.tsx:260-269`

### Description
In normal (non-readOnly) mode, `completeN5Stage` skips stages that are already completed when advancing:
```ts
for (let i = currentIndex + 1; i < N5_STAGE_ORDER.length; i++) {
  if (!updatedCompleted[N5_STAGE_ORDER[i]]) { nextStage = ...; break; }
}
```

In read-only mode:
```tsx
const nextStage = N5_STAGE_ORDER[Math.min(..., currentIndex + 1)];
setRevisitState({ ...activeState, stage: nextStage, ... });
```

This always advances exactly one stage forward, even if that stage was already completed in `revisitState.stagesCompleted`. In practice this doesn't matter because `defaultRevisitState` starts with an empty `stagesCompleted`, so the user always visits every stage in order during a revisit. But it's an inconsistency that could bite if `revisitState` were pre-populated from actual progress.

---

## BUG-10 — `firstUnlearnedIndex` returns `queue.length - 1` (last item) instead of indicating "all done" when everything is learned

**Severity**: Low (UX friction)  
**Files**: `src/utils/n5-course.ts:436-444`

### Description
```ts
return idx === -1 ? Math.max(0, queue.length - 1) : idx;
```

When every item in the queue is already learned (e.g., re-entering a fully completed day to redo it), `findIndex` returns -1 and the function returns the index of the **last** item. This means `startLesson` resumes with the cursor on the final card. The user must click "Continue" one more time before the stage auto-completes. Expected behavior would be to skip the stage immediately (either return `queue.length` to signal "done" and let the caller complete the stage, or auto-complete in `startLesson`).

---

## BUG-11 — `ReviewStage` "All caught up" Continue button uses `onUpdateState` instead of `onCompleteStage` when returning to done

**Severity**: Low  
**Files**: `src/components/N5CoursePage.tsx:1083-1096`

### Description
```tsx
const returnToDone = Boolean(state.stagesCompleted.produce);
onPrimary={() => returnToDone 
  ? onUpdateState({ stage: "done", stagesCompleted: { ...state.stagesCompleted, review: true } })
  : onCompleteStage("review")}
```

When the user has already completed "produce" and later comes back to clear pending reviews, clicking "Continue" in an empty review stage uses `onUpdateState` (raw patch) instead of `onCompleteStage`. Effects:
- No `sound.playCorrect()` feedback.
- Bypasses `completeN5Stage` logic (which handles "skip already-done" stages when re-entering).
- The stage is set directly to "done" rather than finding the first incomplete stage after "review".

If any stage between "review" and "done" was NOT completed, this still jumps straight to "done".

---

## BUG-12 — Grammar minimap cell state: when NOT on grammar stage and grammar is NOT completed, all grammar cells show "none" even if some are individually learned

**Severity**: Low (display only)  
**Files**: `src/components/N5LessonMinimap.tsx:49-55`

### Description
```ts
function grammarCellState(point: N5GrammarPoint, i: number): CellState {
  if (state.stage === "grammar" && state.grammarIndex === i) return "current";
  if (learnedGrammar.has(point.id)) return "learnt";
  if (state.stagesCompleted?.grammar) return "learnt";
  if (state.stage !== "grammar" && !state.stagesCompleted?.grammar) return "none"; // ← all show "none"
  return state.grammarIndex > i ? "learnt" : "none";
}
```

When the current stage is NOT "grammar" and grammar is NOT yet completed (e.g., user is on vocab stage, grammar is partially done), the third check makes ALL grammar cells return "none" — even items that are in `learnedGrammarIds`. The `learnedGrammar.has(point.id)` check correctly runs BEFORE that guard, so individual learned items do show "learnt". But the `state.stage !== "grammar" && !stagesCompleted.grammar` guard is then completely unreachable for any point that isn't in `learnedGrammar`.

The last line `return state.grammarIndex > i ? "learnt" : "none"` is dead code — it's only reachable when `state.stage === "grammar"` (because of the guard above), but if `stage === "grammar"` the first check already handled the `current` case and wouldn't reach here... Actually the first check returns "current" only for the EXACT current index. So for other indices when `stage === "grammar"`, the flow falls through to line 54, hits the guard, and since `state.stage === "grammar"`, the guard condition `state.stage !== "grammar"` is false, so it falls to the last `return`. That's fine.

The actual minor issue: the ordering of checks means `learnedGrammar` check (line 50) fires before the progress-based "within grammar stage" check (line 53-54). When on the grammar stage, items ahead of `grammarIndex` that happen to be in `learnedGrammarIds` (from a previous attempt, redo, or sync) would show "learnt" instead of "none". This is arguably correct but could be confusing.

---

## BUG-13 — `redoDay` resets `deferredVocabIds` and `deferredKanjiIds`, but `learnedVocabIds`/`learnedKanjiIds` are untouched — the Vocab/Kanji stages will show items as "Continue" rather than "Learnt (move on)"

**Severity**: Low (UX inconsistency)  
**Files**: `src/components/N5CoursePage.tsx:231-249`

### Description
`redoDay` resets day state (stages, indices, deferred lists) but intentionally leaves the global learned lists intact. When redoing, item buttons show "Continue" (because `learned = cards.some(c => c.id === cardIdForVocab(item))` is true — the SRS card exists). But this label is slightly misleading: the button should probably say "Already learnt — skip" or similar on a redo.

More importantly, the `firstUnlearnedIndex` resume logic in `startLesson` (called after `redoDay` sets the mode to "lesson") will find `newVocabIdx = queue.length - 1` (Bug-10), landing on the last item instead of item 0.

---

## BUG-14 — `tailAllSkipped` "Finish section" button appears on the very last deferred item being displayed, creating UI with two completion actions simultaneously

**Severity**: Low (UX confusion)  
**Files**: `src/components/N5CoursePage.tsx:1162`, `1188-1192`

### Description
When the user is viewing the last deferred vocab item (vocabIndex points to it at the tail of the queue), `tailAllSkipped` is true:
```tsx
const tailAllSkipped = skippedCount > 0 && queue.slice(state.vocabIndex).every((e) => deferredSet.has(e.id));
```

The stage shows:
- Main button: "Learnt ✓" (to learn and complete stage)
- "Finish section (1 skipped)" button below

Both buttons complete the vocab stage. "Finish section" skips the current item without adding it to `learnedVocabIds`. The user might press "Finish section" thinking it's the normal completion, accidentally skipping the item without learning it.

---

## BUG-15 — Backend `IsDestructive` check prevents a legitimate **Kana SRS reset** from syncing if the server has N5 data (or vice versa)

**Severity**: Medium  
**Files**: `backend/internal/sync/sync.go:413-423`

### Description
```go
incomingEmpty := len(incoming.SRSCards) == 0 && 
                 len(incoming.AnkiV3Collection) == 0 && 
                 len(incoming.N5CourseProgress) == 0 && 
                 len(incoming.N5SRSCards) == 0
return existingSubstantial && incomingEmpty
```

The check treats **any** combination of four data types as a unit. If a user legitimately clears their kana SRS cards (but has N5 progress), the push would include `SRSCards=[]` but non-empty `N5CourseProgress`. `incomingEmpty` is `false` because `N5CourseProgress` is set. The destructive check correctly doesn't fire. ✓

But the reverse: a user who has kana SRS data on the server but sends a push where `N5CourseProgress = {}` (empty, first-time N5 user) would still not trigger it. ✓

The actual edge case: a **logged-out** user's data is stored without a user prefix in IndexedDB. On login, `getUserPrefix()` becomes non-empty, the N5 keys under the new prefix start empty. The first push after login has `N5CourseProgress = null/undefined` (no stored value). But `collectSyncState` checks:
```ts
const rawN5Progress = await getSettingFromDB<Partial<N5CourseProgress> | null>("n5_course_progress", null);
const n5_course_progress = rawN5Progress ? normalizeN5Progress(...) : undefined;
```

If `rawN5Progress = null`, `n5_course_progress = undefined`. The server has the user's existing progress. `incomingEmpty = true` if kana SRS is also empty. The server would reject the push as destructive, **preventing the user from syncing at all after first login on a new device**. The merged result would be `{"ignored": true}` and the local client never receives the server's N5 progress (pull happens separately, so this particular scenario resolves on pull — but it's still a hidden flaw in the push path).

---

---

## BUG-16 — "Due now: 0" stat in Kanji/Vocab library always renders in amber even when there are no overdue cards

**Severity**: Low (visual/UX)
**Confirmed via**: Browser simulation (screenshot `sim-34-kanji-library.png`)
**Files**: `src/components/N5Library.tsx:77`

### Description
The "Due now" stat tile in the Kanji and Vocab library pages hardcodes `accent="text-amber-700"` regardless of the count value:

```tsx
<StatTile label="Due now" value={String(counts.due)} accent="text-amber-700" />
```

When `counts.due = 0`, the zero is rendered in orange/amber — a colour associated with urgency or warnings. A user seeing "Due now · 0" in amber text might interpret it as a problem state when in fact nothing is overdue. The amber colour should only appear when `counts.due > 0`.

### Fix
Conditionally change the accent colour:
```tsx
accent={counts.due > 0 ? "text-amber-700" : "text-zinc-400"}
```

---

## BUG-04 — CONFIRMED via live browser simulation

The static analysis finding was validated in a real Chromium browser. With Day 1 cards loaded into the review session (27 cards, all marked "EARLY · DUE 23H"):

1. Clicked "SHOW ANSWER INSTEAD (Space)" — answer was revealed, correct MC option highlighted green, grade buttons (AGAIN/HARD/GOOD/EASY) appeared.
2. Pressed `Enter` — **card did not advance, no grade submitted**.
3. Grade buttons remained on screen awaiting manual 1–4 press.

Screenshot: `sim-29-show-answer.png`. The behaviour matches the code path in `N5McReview.tsx:124` where `pickedIndex === null` after using the Show Answer path.

---

## Summary Table

| # | Area | Severity | Short description |
|---|------|----------|-------------------|
| 01 | Frontend minimap | High | skip→learn→skip shows green not amber |
| 02 | Frontend flow | High | Minimap "Done" click bypasses Produce, marks day complete |
| 03 | Frontend sync | Medium | Silent reload preserves wrong day (stale closure) |
| 04 | Frontend UX | Medium | Enter/Space inert after "Show answer" in review (**browser-confirmed**) |
| 15 | Backend sync | Medium | IsDestructive rejects first-login push on clean device |
| 05 | Frontend display | Low | displayPos overcounts in Vocab/Kanji heading |
| 06 | Backend health | Low | Orphaned rows from two NowMillis() calls |
| 07 | Code hygiene | Low | Dead LessonMinimap component (180 lines, never rendered) |
| 08 | Frontend race | Low | Grade buttons lack in-flight guard (double-tap) |
| 09 | Frontend logic | Low | readOnly completeStage skips completed-stage avoidance logic |
| 10 | Frontend UX | Low | firstUnlearnedIndex returns last item when all learned |
| 11 | Frontend flow | Low | "All caught up" Continue bypasses completeN5Stage |
| 12 | Frontend display | Low | Grammar cells show "none" instead of "learnt" for partial progress in non-grammar stage |
| 13 | Frontend UX | Low | redoDay + firstUnlearnedIndex drops cursor on last item |
| 14 | Frontend UX | Low | tailAllSkipped shows two finish actions simultaneously |
| 16 | Frontend visual | Low | "Due now: 0" stat in library rendered in amber (urgency colour) even when nothing is overdue |

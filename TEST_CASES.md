# N5 Daily Learning Flow — Simulation Test Cases

Exhaustive test case list from simulating a user going through the N5 course day by day, trying every meaningful interaction. Organized by feature area. Each case has an ID, preconditions, steps, and expected result. Cases that exposed a bug reference the bug ID.

---

## TC-SETUP: Prerequisites / Reset

| ID | Description | Steps | Expected |
|----|-------------|-------|----------|
| S-01 | Fresh start, no account | Open app, visit N5 course | Day 1 unlocked, no SRS cards, streak = 0 |
| S-02 | Reset course mid-progress | Complete 3 days, use "Reset course" | All days locked except 1, SRS cards cleared, streak = 0 |
| S-03 | Login with existing account | Register, do Day 1, logout, login again | Progress persists via sync |
| S-04 | Login on second device with progress | Progress exists on server | Pull sync restores progress on new device |
| S-05 | Register and push (first push, clean state) | New account on device with no local N5 data | Server stores progress; server state not clobbered |

---

## TC-HOME: Course Home Screen

| ID | Description | Steps | Expected |
|----|-------------|-------|----------|
| H-01 | New user home | Open N5 course home | Shows "Day 1 · [title]", Start button, no Review button, streak = 0 |
| H-02 | Home with due reviews | Have SRS cards due | "Review (N due)" button appears on both Start and Review cards |
| H-03 | Home with no due reviews but learned cards | All cards reviewed | "Practice all (N)" button appears |
| H-04 | Streak display after 1 day | Complete Day 1 | Streak shows 1 day |
| H-05 | Streak display after gap | Complete Day 3, skip a day, complete Day 5 | Streak resets to 1 |
| H-06 | Streak on same-day redo | Complete day, redo day on same calendar day | Streak stays, not doubled |
| H-07 | learnedCardCount in home | After learning 5 vocab and 3 kanji | learnedCardCount = 8 shown correctly |
| H-08 | Practice decks panel visibility | learnedCardCount = 0 | Practice decks section not shown |
| H-09 | Practice decks panel visibility | learnedCardCount > 0 | Shows Kanji, Vocab, Grammar, All deck buttons |
| H-10 | Review load trend sparkline | After multiple days | Sparkline shows trend upward |
| H-11 | DaySegments (30-cell bar) | Complete Day 1, current = Day 2 | Day 1 emerald, Day 2 indigo, rest grey |

---

## TC-MAP: Course Map

| ID | Description | Steps | Expected |
|----|-------------|-------|----------|
| M-01 | Map opens | Click Map button | Shows 30-day grid |
| M-02 | Completed day styling | Day 1 completed | Day 1 shows emerald + checkmark |
| M-03 | Current day styling | Current day not completed | Shows indigo "Current" |
| M-04 | Locked day styling | Day > unlockedDay | Shows grey with lock icon |
| M-05 | Click completed day | Click Day 1 from Map | Opens in read-only mode (readOnly=true) |
| M-06 | Click locked day | Click Day 5 when only Day 2 is unlocked | Opens in read-only "Preview" mode |
| M-07 | Click current day | Click current day from Map | Opens in write mode |
| M-08 | currentDay vs unlockedDay | Partially worked Day 3, complete Day 2 | unlockedDay = 3, currentDay = 3, map correct |

---

## TC-LESSON-ENTRY: Starting a Lesson

| ID | Description | Steps | Expected |
|----|-------------|-------|----------|
| LE-01 | First-ever lesson | Day 1, nothing learned | Opens at Grammar stage (review skipped, no cards due) |
| LE-02 | Resume mid-lesson grammar | Close mid-grammar, reopen | Resumes at first unlearned grammar point |
| LE-03 | Resume mid-lesson vocab | Close mid-vocab, reopen | Resumes at first unlearned vocab item |
| LE-04 | Resume when all of stage is done | All vocab learned, reopen | vocabIndex set to last item; one "Continue" advances to next stage (**Bug-10**) |
| LE-05 | Day 2+ lesson start | Some reviews due | Opens at Review stage (not Grammar skip) |
| LE-06 | StageRail shows correct state | Mid-lesson | Active stage highlighted, completed stages show green pills, future stages grey |
| LE-07 | StageRail navigation | Click completed grammar pill | Navigates to grammar stage |
| LE-08 | StageRail: future stage not clickable | Click future "produce" pill | Button disabled, no navigation |

---

## TC-REVIEW-STAGE: Review Stage in Lesson

| ID | Description | Steps | Expected |
|----|-------------|-------|----------|
| R-01 | No reviews due | Enter Review stage with 0 due | "All caught up" screen |
| R-02 | Reviews present | Enter Review stage with N due | Shows first due card with MC options |
| R-03 | Grade card — correct pick | Pick correct MC option | Option highlights green, "Correct" shown, grade buttons [Hard, Good, Easy] |
| R-04 | Grade card — wrong pick | Pick wrong option | Wrong turns red, correct turns green, "Not quite" shown, grade buttons [Again, Hard] |
| R-05 | Grade card — Show answer | Click "Show answer instead" | Answer revealed, all 4 grade buttons shown |
| R-06 | Enter key to advance after MC pick | Pick option, press Enter | Grades with defaultGrade (Good if correct, Again if wrong) |
| R-07 | Enter key after Show answer | Click Show answer, press Enter | **Nothing happens — no grade submitted** (**Bug-04**) |
| R-08 | Space key before reveal | Focused on card, press Space | Reveals answer |
| R-09 | Number keys 1-4 select MC options | Press 2 before revealing | Picks option 2 |
| R-10 | Number keys 1-4 grade after reveal | Press 3 after revealing | Grades as "Good" |
| R-11 | Wrong answer: pressing 4 (Easy) blocked | Pick wrong answer, press 4 | Ignored (4 not in allowedGrades=[1,2]) |
| R-12 | All reviews cleared | Grade last due card | Review stage auto-advances to Grammar |
| R-13 | Defer reviews, start lesson | Click "Defer reviews and start lesson" | Navigates to grammar, `reviewDeferred=true` |
| R-14 | "All caught up" on return from produce | All stages done except review cleared later | Continue goes to "done" directly (**Bug-11** if non-completeStage path used) |
| R-15 | `reviewStartedAt` resets per card | Grade card, next card shows | `answerSeconds` computed correctly for second card |
| R-16 | Review stage in read-only | Open completed day from map | "Read-only revisit" screen, no cards shown |

---

## TC-GRAMMAR-STAGE: Grammar Stage

| ID | Description | Steps | Expected |
|----|-------------|-------|----------|
| G-01 | Grammar card display | Enter grammar stage | Shows structure, explanation, examples, common mistake |
| G-02 | Advance through grammar | Click "Learnt (move on)" | Moves to next grammar point; item added to learnedGrammarIds; SRS card created |
| G-03 | Last grammar item | Click "Learnt (move on)" on last | Stage marked complete, advances to Vocab |
| G-04 | Prev button | On grammar item 2+ | ← Prev button shows; clicking goes back one item |
| G-05 | No prev on first item | Grammar index = 0 | No ← Prev button shown |
| G-06 | Enter key advances | Focus not on button/input | Enter clicks "Learnt (move on)" |
| G-07 | Read-only grammar | Open completed day | Shows "Next Grammar" / "Finish Grammar" instead of "Learnt" |
| G-08 | Grammar with no entries | Day with empty grammar | "No grammar listed" screen with Continue |
| G-09 | Grammar SRS card created | After marking grammar learned | `n5:grammar:{id}` card exists in SRS cards |
| G-10 | grammarIndex saved on close | Close mid-grammar | Reopen resumes at saved index |

---

## TC-VOCAB-STAGE: Vocab Stage

| ID | Description | Steps | Expected |
|----|-------------|-------|----------|
| V-01 | Vocab card display | Enter vocab stage | Shows word, reading, romaji, type, meaning, example, kanji strip |
| V-02 | Mark as learned | Click "Learnt (move on)" | Adds to learnedVocabIds, creates SRS card, advances index |
| V-03 | Last vocab item | Learn last item | Stage completes, advances to Kanji |
| V-04 | Already-learned item | Re-enter lesson, item previously learned | Button shows "Continue" |
| V-05 | Prev button | On index ≥ 1 | ← Prev button shown |
| V-06 | Enter key advances | Press Enter | Same as clicking main button |
| V-07 | Speak button | Click Mic icon | Browser TTS plays example/word in Japanese |
| V-08 | Read-only vocab | Completed day revisit | "Next" button, no Skip button, no Learnt button |
| V-09 | **Skip / defer** | Click "Skip · revisit later" | Item moved to deferredVocabIds, queue reorders (deferred to end), next item shown |
| V-10 | Skip then learn deferred item | Skip X, advance to end, click "Learnt ✓" on X | X removed from deferredVocabIds, added to learnedVocabIds, stage advances |
| V-11 | Skip then skip all → tailAllSkipped | Skip all remaining items | "Finish section (N skipped)" button appears |
| V-12 | Skip all and finish | Click "Finish section (N skipped)" | Stage completes; skipped items NOT in learnedVocabIds |
| V-13 | **Skip→Learn→Skip again** | Skip X → learn X → skip X again | Skip button reappears ✓; minimap cell shows **amber** (skipped) — currently shows green (**Bug-01**) |
| V-14 | Skip → no advance (index stays) | Skip item at index 2 | Queue reorders; index 2 now shows NEXT non-deferred item |
| V-15 | displayPos when 2 items skipped | Skip items 1 and 3, now at index 0 | Heading shows "2 of N · 2 skipped" when viewing what was item 2 (**Bug-05**) |
| V-16 | "Skipped item — revisiting" label | Viewing deferred item | Shows amber "Skipped item — revisiting" label |
| V-17 | Skip button hidden on deferred item | Viewing a deferred item | "Skip · revisit later" button NOT shown |
| V-18 | Skip button reappears after learning deferred | Skip X → learn X → navigate back to X | Skip button shown again (X is in learned but not deferred) |
| V-19 | Vocab SRS card created exactly once | Mark learned twice (navigate back and re-learn) | Only one SRS card per contentId |

---

## TC-KANJI-STAGE: Kanji Stage

| ID | Description | Steps | Expected |
|----|-------------|-------|----------|
| K-01 | Kanji card display | Enter kanji stage | Shows kanji glyph, readings, meaning, mnemonic, components |
| K-02 | Break it down | Click kanji glyph or "Break it down" button | KanjiBreakdownModal opens |
| K-03 | Mark as learned | Click "Learnt (move on)" | Adds to learnedKanjiIds, creates SRS card, advances |
| K-04 | Skip kanji | Click "Skip · revisit later" | Same defer behavior as vocab |
| K-05 | **Kanji skip→learn→skip minimap** | Same as V-13 for kanji | Minimap cell should show amber after re-skip — currently shows green (**Bug-01**) |
| K-06 | Read-only kanji | Completed day | "Next" button, no Skip, no Learnt |
| K-07 | Kanji with no entries | Day with no kanji | "No new kanji listed" screen with Continue |
| K-08 | Enter key advances | Press Enter | Advances / marks learned (when breakdown modal not open) |
| K-09 | Enter disabled when modal open | Open breakdown, press Enter | Enter does NOT advance (action is null when breakdownChar set) |
| K-10 | "Finish section" when all remaining are skipped | Skip all tail kanji | "Finish section (N skipped)" appears |

---

## TC-PRODUCE-STAGE: Produce Stage

| ID | Description | Steps | Expected |
|----|-------------|-------|----------|
| P-01 | Production tasks shown | Enter produce stage | Shows prompts from `produceTasks` or `extraLines` |
| P-02 | Submit button disabled when empty | No text in any textarea | "Submit Practice" button disabled |
| P-03 | Submit enabled after filling | Fill all textareas | "Submit Practice" active |
| P-04 | Submit stage | Click "Submit Practice" | Stage marked complete, advances to Done |
| P-05 | "Show example sentences" toggle | Click toggle | Example sentences from grammar/vocab shown inline |
| P-06 | Textarea disabled in read-only | Open completed day | textarea has `disabled` prop |
| P-07 | Production answer persisted | Type answer, close, reopen | Answer still in textarea |
| P-08 | Production answer in sync | Type answer, sync | Other device sees answer on pull |
| P-09 | **Bypass produce via minimap** | Complete review/grammar/vocab/kanji (no due), click "Done" in minimap | Day completes without produce being submitted (**Bug-02**) |
| P-10 | Produce with 0 tasks | Day with no produce tasks | Fallback task from `day.raw` is shown |

---

## TC-DONE-STAGE: Done Stage

| ID | Description | Steps | Expected |
|----|-------------|-------|----------|
| D-01 | Done stage, reviews pending | Navigate to done with due cards | "Reviews remain" screen, "Back to Reviews" button |
| D-02 | Done stage, clear reviews | Grade all due cards | Transitions to completion screen |
| D-03 | Day completion screen | All stages done, no due | Shows "Day N complete", streak, upcoming review count |
| D-04 | Return Home | Click "Return Home" | Returns to course home; next day unlocked |
| D-05 | commitDayComplete fires on enter | Navigate to done with conditions met | Day marked complete in progress immediately (before Return Home) |
| D-06 | commitDayComplete idempotent | Re-enter done stage on already-completed day | No second entry in completedDays |
| D-07 | Checkpoint gating | Day with checkpoint | Shows checklist before completion screen |
| D-08 | Checkpoint "Ready" | Check all items, click Ready | Checkpoint report saved, proceeds to completion |
| D-09 | Checkpoint "Not Ready" | Click "Not Ready" | Saved, redirected to course map |
| D-10 | Redo Day button | Open completed day (readOnly), click "Redo Day" | Resets stage state, opens day in write mode |
| D-11 | Read-only Done | Open completed day from map | Shows "Read-only review complete", Return Home |
| D-12 | predictedStreak display | Day 3 being completed, streak was 2 | Shows "3 day streak" on completion card |
| D-13 | upcomingReviewCount | After learning 10 cards today | Shows approximate review count due within 36h |

---

## TC-MINIMAP: Minimap Grid (LessonMinimapGrid)

| ID | Description | Steps | Expected |
|----|-------------|-------|----------|
| MM-01 | Desktop minimap always visible | Viewport ≥ lg breakpoint | Right sidebar shows minimap continuously |
| MM-02 | Mobile minimap toggle | Viewport < lg, click "Outline" | Minimap replaces stage content |
| MM-03 | Mobile minimap close | Click X in minimap | Returns to stage content |
| MM-04 | Review cell — due cards present | dueCardCount > 0 | Review row shows white/none cell |
| MM-05 | Review cell — completed | After review stage done | Review row shows emerald/green |
| MM-06 | Grammar cell — current | Current grammar index = i | Cell shows indigo |
| MM-07 | Grammar cell — learnt | Grammar point in learnedGrammarIds | Cell shows emerald |
| MM-08 | Vocab cell — current | Current vocab index = i | Cell shows indigo |
| MM-09 | Vocab cell — learnt | Vocab in learnedVocabIds | Cell shows emerald |
| MM-10 | Vocab cell — skipped | Vocab in deferredVocabIds (never learned) | Cell shows amber ✓ |
| MM-11 | **Vocab cell — skip→learn→skip** | Add to learned then re-defer | Cell should show amber — **shows emerald** (**Bug-01**) |
| MM-12 | Kanji cell — skipped (never learned) | Kanji in deferredKanjiIds only | Cell shows amber ✓ |
| MM-13 | **Kanji cell — skip→learn→skip** | Same as MM-11 for kanji | Same bug (**Bug-01**) |
| MM-14 | Navigate via minimap | Click a vocab cell | Stage jumps to that vocab item |
| MM-15 | Navigate to Done via minimap | Click Done row | Stage jumps to Done — day can auto-complete (**Bug-02**) |
| MM-16 | Legend always shown | Render minimap | Current/Learnt/Skipped/Not yet legend visible |
| MM-17 | Produce cell state | Before produce stage | White/none |
| MM-18 | Produce cell state | After produce completed | Emerald |
| MM-19 | Done cell state | Stage = done | Indigo |

---

## TC-REVIEW-SESSION: Standalone Review Sessions

| ID | Description | Steps | Expected |
|----|-------------|-------|----------|
| RS-01 | Launch cumulative review | Click "Review now" from home | Opens review session with all due cards, sorted by retrievability |
| RS-02 | Launch practice all | No due cards, click "Practice all" | Opens review session with all learned cards |
| RS-03 | Launch deck review — vocab | Click Vocab deck Practice | Only vocab cards in session |
| RS-04 | Launch deck review — kanji | Click Kanji deck Practice | Only kanji cards |
| RS-05 | Launch deck review — grammar | Click Grammar deck Practice | Only grammar cards |
| RS-06 | Launch deck review — all | Click All deck Practice | All learned cards |
| RS-07 | Launch day practice | From lesson Done stage, "Redo Day N reviews" | Only cards from that day |
| RS-08 | Empty session | Start session with no cards | Button disabled / session doesn't open |
| RS-09 | Progress bar | Grade cards one by one | Progress fills from 0% to 100% |
| RS-10 | Counter X / N | Progress through session | Counter updates correctly |
| RS-11 | Session complete screen | Grade last card | "Session complete" with card count |
| RS-12 | Return Home from session | Click Return Home | Returns to course home |
| RS-13 | Escape exits session | Press Escape | Returns to course home |
| RS-14 | Card not found in session | Card ID in session.ids missing from cards | Session skips that index gracefully |
| RS-15 | Per-card grade saves | Grade 3 cards, close app, reopen | All 3 grades persisted in SRS cards |
| RS-16 | Forgotten-first ordering | Open review with mix of overdue + fresh cards | Overdue shown first, then by ascending retrievability |
| RS-17 | "Early" label | Card due tomorrow opened today | Shows "early · due Xh" label |
| RS-18 | Session preserves logs | Grade 5 cards | 5 new review log entries in n5_review_logs |
| RS-19 | MC question for vocab | Vocab SRS card | Shows masked sentence or English meaning prompt |
| RS-20 | MC question for kanji — odd reps | Kanji card with reps=1 | Shows reading question |
| RS-21 | MC question for kanji — even reps | Kanji card with reps=0 | Shows meaning question |
| RS-22 | MC question for grammar — blank | Grammar card with blankable structure | Shows fill-in-the-blank |
| RS-23 | MC question for grammar — meaning | Grammar card with no blankable token | Shows translation/meaning prompt |
| RS-24 | Distractors from learned pool first | Review card with learned peers | Distractors prioritize from learnedVocabIds |
| RS-25 | No duplicate options | Build question | All option texts are unique |
| RS-26 | Deterministic options per (card.id, card.reps) | Same card same reps | Same options in same order every time |

---

## TC-SRS: FSRS Algorithm Behaviour

| ID | Description | Steps | Expected |
|----|-------------|-------|----------|
| SRS-01 | New card gets initial due | Mark vocab as learned | `due` is 20-44h from now (based on stableHash) |
| SRS-02 | Grade Again reschedules soon | Grade card Again (1) | `due` is within minutes/hours (FSRS learning step) |
| SRS-03 | Grade Easy pushes far | Grade new card Easy (4) | `due` is several days out |
| SRS-04 | State progression | New → Learning → Review | `state` field increments correctly |
| SRS-05 | Lapse on Again in Review state | Grade Review-state card Again | Lapses increments, rescheduled |
| SRS-06 | ensureN5CardsForLearned backfill | Open app with learned ids but missing cards | Missing cards created with initial state |
| SRS-07 | backfillLearnedGrammarForCompletedDays | Old user with completed days before grammar tracking | Grammar ids added to learnedGrammarIds on load |

---

## TC-SYNC: Sync Behavior

| ID | Description | Steps | Expected |
|----|-------------|-------|----------|
| SY-01 | Push on save | Save progress | syncDirty set to true; push debounce fires |
| SY-02 | Sync pill — synced | Push completes | Pill shows "synced" |
| SY-03 | Sync pill — offline | Go offline | Pill shows "offline-saved" |
| SY-04 | Pull on login | Login with existing account | Pull restores server state |
| SY-05 | Push+pull merge | Two devices, each add different vocab | Both sets of learnedVocabIds merged (union) |
| SY-06 | Newer dayState wins on conflict | Two devices edit same day | Higher updatedAt wins |
| SY-07 | reset survives sync | Reset on device A, push | Device B pulls and sees reset (resetAt used) |
| SY-08 | Sync during lesson — correct day preserved | Sync event fires while on Day 5 | Day 5's in-progress state preserved — **currently preserves Day 1 state** (**Bug-03**) |
| SY-09 | IsDestructive blocks empty push | Client has no N5 data, server has progress | Server returns `{"ignored": true}`, no data loss |
| SY-10 | First-login push on clean device | New device, no local N5 progress, server has progress | Push not blocked (Bug-15 edge case), pull recovers server state |
| SY-11 | Concurrent push guard | Two push calls in flight simultaneously | `reconcileInFlight` guard prevents interleaving |

---

## TC-STREAK: Streak Logic

| ID | Description | Steps | Expected |
|----|-------------|-------|----------|
| ST-01 | First day completed | Complete Day 1 | streak.current = 1, lastCompletedDate = today |
| ST-02 | Consecutive days | Complete Day 1 today, Day 2 tomorrow | streak.current = 2 |
| ST-03 | Gap in days | Complete Day 1, skip a day, complete Day 2 | streak.current resets to 1 |
| ST-04 | Same-day duplicate | Complete day, redo day same day | streak.current unchanged |
| ST-05 | Highest streak tracked | streak.current was 5, broken, now 3 | streak.highest remains 5 |
| ST-06 | predictedStreak on first ever completion | streak.current=0, lastCompletedDate=undefined | Shows "1 day streak" (fallback returns 1) |
| ST-07 | Streak merge across devices | Device A records streak 3, Device B records 4 (same updatedAt tie breaks to incoming) | Higher updatedAt wins in mergeN5Streak |

---

## TC-NAVIGATION: Inter-stage Navigation Edge Cases

| ID | Description | Steps | Expected |
|----|-------------|-------|----------|
| N-01 | Back to Home mid-lesson | Click Home in header | Returns to course home, lessonDay cleared |
| N-02 | Back to Home from review session | Click Exit in session | Returns home, session cleared |
| N-03 | Navigate to map from home | Click Map | Shows 30-day map |
| N-04 | Navigate to kanji library | Click Kanji → Browse | Opens KanjiLibrary with learned/due display |
| N-05 | Navigate to vocab library | Click Vocab → Browse | Opens VocabLibrary |
| N-06 | Navigate stage via StageRail | Click a completed stage pill | Navigates there; lesson state updates |
| N-07 | StageRail does not allow forward nav | Click future stage | Button is disabled |
| N-08 | Minimap nav to earlier stage | During kanji stage, click grammar cell | Jumps to grammar at that index |
| N-09 | Minimap nav to future stage | Click "Done" before completing produce | Navigates to done, can trigger day completion (**Bug-02**) |
| N-10 | Lesson progress bar | Advance through stages | % increases from 0 to 100 |
| N-11 | Progress bar at 100% | All stages done | Shows 100% |
| N-12 | redoDay resets stage but keeps SRS | Click Redo Day | Stage resets to review, SRS cards unchanged |

---

## TC-EDGE: Edge Cases and Boundary Conditions

| ID | Description | Steps | Expected |
|----|-------------|-------|----------|
| E-01 | Day with 0 vocab | Open a day with no vocab | "No vocab listed" screen with Continue |
| E-02 | Day with 0 kanji | Open a day with no kanji | "No new kanji listed" screen with Continue |
| E-03 | Day with 0 grammar | Open a day with no grammar | "No grammar listed" screen with Continue |
| E-04 | Day 30 completion | Complete Day 30 | unlockedDay stays at 30, no Day 31 reference |
| E-05 | Review session with 0 cards | Call startDeckReview with no learned cards | Session doesn't open |
| E-06 | Grade card offline | Grade while navigator.onLine=false | Card saved locally, push queued |
| E-07 | Multiple deferred items, learn in deferred order | Skip A, B; learn A then B | Stage completes correctly after B |
| E-08 | Multiple deferred items, finish section | Skip A, B; click "Finish section" | Stage completes; A, B not in learnedVocabIds |
| E-09 | Redo day after full completion | Day with all items learned, redo | Resumes at last item (Bug-10) rather than first |
| E-10 | Sync with resetAt older than existing updatedAt | Device A resets; Device B has newer progress | Device B's progress wins (resetAt < updatedAt) |
| E-11 | Enter key in textarea (Produce) | Press Enter in produce textarea | Does NOT advance stage (tag === TEXTAREA guard) |
| E-12 | Enter key when button has focus | Press Enter with grade button focused | Clicks the button (native click, not the keydown handler) |
| E-13 | Long session — review logs capped at 500 | Review > 500 cards | Logs sliced to most recent 500 |
| E-14 | cardIdForVocab / cardIdForKanji determinism | Same entry | Always produces `n5:vocab:{id}` / `n5:kanji:{char}` |
| E-15 | firstDueDelayMs range | Multiple vocab items | All due times are in range [20h, 44h] from now |
| E-16 | buildMcQuestion with very few learned items | Only 1 other learned card | Question may have fewer than 4 options (2 minimum) |
| E-17 | Grammar question when grammar point has no examples | | Returns null, McReviewPanel renders nothing |
| E-18 | Kanji SRS card for kanji with no readings | forceReading check, reps%2=1 | Falls back to meaning question since readings empty |
| E-19 | NowMillis health check orphaned rows | Repeated health checks over time | `health_check` table grows with un-deleted rows (**Bug-06**) |
| E-20 | Dead LessonMinimap in codebase | Read N5CoursePage.tsx | Component at line 892 never imported or rendered (**Bug-07**) |
| E-21 | Double-tap grade button | Tap grade button twice quickly | Second tap may double-grade same card (**Bug-08**) |

---

## TC-BROWSER: Browser Simulation Findings (live Playwright run)

Cases added after running a full Playwright simulation against `http://localhost:3333`. These complement the static-analysis cases above with observations from the actual running app.

### Day 1 Full Flow (end-to-end)

| ID | Description | Steps | Expected |
|----|-------------|-------|----------|
| BR-01 | Day 1 opens at Grammar (no reviews) | Fresh user, click Start on Day 1 | Review stage is NOT shown; lesson opens directly on Grammar stage |
| BR-02 | Grammar progress bar at 20% | Just opened Grammar (first stage) | Progress bar shows 20% |
| BR-03 | Grammar "Learnt (move on)" advances | Click button on each grammar point | Counter increments (e.g. "1 of 2" → "2 of 2") |
| BR-04 | Vocab heading format | Enter Vocab stage | Heading is "N of M words" (e.g. "1 of 20 words") |
| BR-05 | Skip appears after first render | On first vocab item | "Skip · revisit later" button is visible |
| BR-06 | Skip shows "N skipped" in heading | Skip 1 item | Heading updates to "N of M words · 1 skipped" |
| BR-07 | Amber cell appears after skip | Skip any vocab item | Minimap sidebar shows at least 1 amber cell |
| BR-08 | "Skipped item — revisiting" label | Navigate to deferred item at end of queue | Amber label "Skipped item — revisiting" appears above card |
| BR-09 | Skip button hidden on deferred item | View a deferred vocab item | "Skip · revisit later" button is NOT visible |
| BR-10 | Kanji skip works same as vocab skip | Skip kanji item | Minimap shows amber cell; queue reordered |
| BR-11 | Produce: submit disabled when empty | Enter Produce stage | "Submit Practice" button has `disabled` attribute |
| BR-12 | Produce: submit enabled after fill | Type text in all textareas | "Submit Practice" button becomes active |
| BR-13 | Produce: "Show example sentences" toggle | Click the toggle link | `SourceExamples` renders "Verbatim source examples" section |
| BR-14 | Done stage completion screen | Complete all stages | "Day N complete", "Next unlock: Day N+1", streak count, and "~N reviews tomorrow" all visible |
| BR-15 | Progress persists after reload | Complete Day 1, hard-reload page | Home screen shows Day 2 as current; streak preserved |
| BR-16 | Day 2 unlocked after Day 1 done | Complete Day 1 | Course map shows Day 2 as "CURRENT", Days 3-30 locked |

### Course Map

| ID | Description | Steps | Expected |
|----|-------------|-------|----------|
| BR-17 | 30-day map grid | Click Map | All 30 days shown in grid; Day 1 emerald+checkmark, current day indigo, others grey+lock |
| BR-18 | Completed day click → read-only | Click Day 1 from map | Opens lesson with readOnly=true; "Redo Day" button visible |
| BR-19 | Locked day click → preview | Click Day 5 (locked) | Opens with "PREVIEW" label; content visible but locked |
| BR-20 | Map back button | Click "Course Home" | Returns to N5 course home |

### Home Screen (after Day 1 completion)

| ID | Description | Steps | Expected |
|----|-------------|-------|----------|
| BR-21 | Practice Decks section visible | After learning ≥1 card | "PRACTICE DECKS" section shows Kanji/Vocab/Grammar/All cards with learned counts |
| BR-22 | N5 Kanji widget | After learning 5 kanji | Shows "5 / 102 learned · No reviews due" (or due count if any are due) |
| BR-23 | N5 Vocab widget | After learning 20 vocab | Shows "20 / 800 learned · No reviews due" |
| BR-24 | "All caught up" + PRACTICE ALL coexist | No due reviews but learned cards exist | N5 REVIEWS section shows "All caught up" and "PRACTICE ALL (N)" simultaneously |
| BR-25 | Sync pill visible on home | After login/after progress | Sync pill shows "SYNCED" or "SYNCING" |

### Review Session (live)

| ID | Description | Steps | Expected |
|----|-------------|-------|----------|
| BR-26 | "EARLY · DUE Xh" badge | Review cards less than 24h after creation | Badge shows "EARLY · DUE Xh" in top-right of card |
| BR-27 | **BUG-04 confirmed**: Enter after Show Answer | Click "SHOW ANSWER INSTEAD", press Enter | Card does NOT advance — grade buttons remain, Enter is inert (**Bug-04**) |
| BR-28 | Space bar = Show Answer | Press Space on MC card before picking | Triggers "Show Answer Instead" flow, reveals correct answer |
| BR-29 | Escape exits session | Press Escape mid-session | Returns to course home; cards graded so far are saved |
| BR-30 | Session header label | Launch session from Practice All | Header shows "CUMULATIVE REVIEW" |
| BR-31 | Deck-specific session label | Click "PRACTICE" on Vocab deck | Header shows "VOCAB DECK PRACTICE" (not "CUMULATIVE REVIEW") |

### Kanji / Vocab Library

| ID | Description | Steps | Expected |
|----|-------------|-------|----------|
| BR-32 | Library opens from home | Click BROWSE next to N5 Kanji | Opens library with all 102 kanji, stat tiles, filter chips |
| BR-33 | Library stat tiles | View library | Shows "LEARNED N/102", "DUE NOW N", "LEARNING N", "MASTERED N" |
| BR-34 | **BUG-16**: "Due now: 0" amber colour | Open library when nothing is due | "Due now" value "0" renders in amber/orange (`text-amber-700`) even though 0 overdue is a non-urgent state (**Bug-16**) |
| BR-35 | Library filter: LEARNING | Click "LEARNING N" chip | Only cards in FSRS Learning state shown |
| BR-36 | Library search | Type a reading or meaning | Matching kanji/vocab cards filtered in real time |
| BR-37 | Library card due badge | Card with `dueNow: true` | Shows amber "DUE NOW" chip on the card |

### Kana Tab

| ID | Description | Steps | Expected |
|----|-------------|-------|----------|
| BR-38 | Kana tab navigation | Click KANA in nav | Shows three sub-tabs: Speed Sheets, SRS Quiz, Characters |
| BR-39 | Speed Sheets sub-tab | Default on KANA | Shows KANA SPEED SHEETS with grid-size options (16/32/48 chars) and "Launch Active Speed Sheet" button |
| BR-40 | Speed Sheets: active group count | No kana groups enabled | Shows warning "Active group count: N" |
| BR-41 | SRS Quiz sub-tab | Click "SRS Quiz" | Shows kana flashcard interface (or "no cards due" if none) |
| BR-42 | Characters sub-tab | Click "Characters" | Shows kana reference chart |
| BR-43 | "0/5 mastered" header counter | Fresh user on Kana | Header shows "0/5 mastered" pill |
| BR-44 | Kana SRS card reveal + grade | Click Show Answer in SRS quiz | Grade buttons (Again/Hard/Good/Easy) appear; Enter key advances |

### Anki Decks Tab

| ID | Description | Steps | Expected |
|----|-------------|-------|----------|
| BR-45 | Anki tab navigation | Click ANKI DECKS in nav | Shows empty state with upload icon, "Import a deck to get started" |
| BR-46 | Import button in empty state | No decks loaded | "IMPORT .APKG/.COLPKG" button visible in both toolbar and empty-state area |
| BR-47 | Export JSON button | Click Export JSON | Downloads deck data as JSON |

### Settings Tab

| ID | Description | Steps | Expected |
|----|-------------|-------|----------|
| BR-48 | Settings navigation | Click SETTINGS tab | Shows Appearance, Audio, Kana SRS, App Updates, and Danger Zone sections |
| BR-49 | Theme toggle | Click LIGHT / DARK / SYSTEM | Page theme changes; preference stored in DB |
| BR-50 | Sound effects toggle | Click ON/OFF | Disables/enables button click and grading audio feedback |
| BR-51 | Kana SRS cards per session | Select 10 / 20 / 30 | Setting persisted; affects number of cards shown in SRS Quiz |
| BR-52 | Check for Updates | Click "CHECK FOR UPDATES" | Fetches latest asset version from server; forces reload if newer |
| BR-53 | Reset Kana Progress | Click button in Danger Zone | Confirmation shown; clears kana SRS data on confirm |
| BR-54 | Reset N5 Course Progress | Click button in Danger Zone | Confirmation shown; clears all N5 progress, SRS cards, and review logs; Kana/Anki data untouched |

### Auth Modal (Kiroku ID)

| ID | Description | Steps | Expected |
|----|-------------|-------|----------|
| BR-55 | Sign In modal opens | Click SIGN IN in header | Popover appears with SIGN IN / REGISTER tabs, Email + Password fields |
| BR-56 | Empty submit shows error | Click SIGN IN with empty fields | "Email is required." error message shown inline |
| BR-57 | Short password shows error | Enter email, leave password empty or < 4 chars | Validation error shown |
| BR-58 | Wrong credentials error | Fill valid email + wrong password, submit | "Invalid email or password." error shown; modal stays open |
| BR-59 | Register tab | Click REGISTER | Form adds "Repeat password" field |
| BR-60 | Escape closes modal | Press Escape | Auth popover closes |
| BR-61 | Successful login | Enter valid credentials | Modal closes; header shows user email; sync pulls server state |

### Mobile Viewport

| ID | Description | Steps | Expected |
|----|-------------|-------|----------|
| BR-62 | Outline toggle within lesson | Viewport 375px, inside a lesson | "Outline" button appears in lesson header (not on course home) |
| BR-63 | Outline shows minimap | Click Outline on mobile | Full-screen minimap overlay shown with legend (Current/Learnt/Skipped/Not yet) |
| BR-64 | Outline closes | Click Outline again | Returns to lesson stage content |
| BR-65 | Desktop sidebar not shown on mobile | Viewport < lg | Right sidebar with minimap is hidden; lg:hidden button shown instead |

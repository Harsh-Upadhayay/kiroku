# Vocab Section — Bug Report

Focused analysis of the Vocab tab (`VocabSheetPage`), the image-import → OCR/Ollama
→ dictionary-match pipeline, the dictionary search overlay (`DictionaryLookup`),
and the lookup SRS deck (`lookup-deck`).

Design intent (per product owner), used as the baseline for what counts as a bug:
- Imported words **map to internal dictionary cards** and are **strictly
  deduplicated**.
- Source-image provenance does **not** need to be preserved.
- Rows that don't match the dictionary are **dropped** (correct as-is — not a bug).
- An uploaded-image **preview is not required** (so the unused preview code is
  cleanup, not a feature gap).

> A separate, older `BUGS.md` (uppercase) covers the N5 course flow. This file is
> scoped to Vocab only.

---

## VOCAB-01 — All / 語 (words) / 字 (kanji) segment toggle does nothing useful

**Severity**: High (user-reported, confirmed)
**Files**: `src/components/VocabSheetPage.tsx:97-104, 108-121, 292-304`

### Reproduction
1. Import a vocabulary page (or add words via search). Words appear.
2. Click **語** (words) — list is identical to **All**.
3. Click **字** (kanji) — list goes empty even though the words contain kanji.
   The toggle appears to do nothing / be broken.

### Root cause
The filter *wiring* is fine:
```ts
if (segment === "words") rows = rows.filter((r) => r.rowKind === "vocab");
if (segment === "kanji") rows = rows.filter((r) => r.rowKind === "kanji");
```
The problem is **classification**: every imported word is hard-coded as a word,
and nothing ever produces a `"kanji"` row except a kanji added through the search
overlay:
```ts
const enrichedWords: DisplayRow[] = words.map((r) => {
  ...
  return { ...r, rowKind: "vocab" as const, deckCard };   // ← always "vocab"
});
```
So for the normal import flow:
- `字` (`rowKind === "kanji"`) is **always empty** — the kanji inside imported
  words are never surfaced as kanji rows, and even a word that *is* a single
  kanji stays classified as `"vocab"`.
- `語` is identical to `All` (everything is `"vocab"`).

The three-way toggle therefore has no observable effect in the common case.

### Fix direction
Decide what 字 should mean and make it real: either derive kanji rows from the
distinct kanji contained in imported words (each linkable to its kanji card), or
classify single-character entries as `"kanji"`. If the kanji segment can't be
populated, hide/disable it instead of showing an always-empty tab.

---

## VOCAB-02 — Clicking a word/kanji row doesn't open its card

**Severity**: High (user-reported, confirmed)
**Files**: `src/components/VocabSheetPage.tsx:390-440`, `src/components/KanjiBreakdown.tsx:186-207`

### Reproduction
1. Open the Vocab tab with some entries.
2. Click a **word** — nothing opens (expected: its vocab card — reading,
   meanings, example, kanji breakdown).
3. Click a **kanji** entry — nothing opens at the row level (expected: its kanji
   card).

### Root cause
Rows are not interactive. The only clickable thing in a row is an individual
kanji *glyph* rendered by `KanjiText`, which opens the kanji **breakdown modal**:
```tsx
<button onClick={() => setOpenChar(char)} ...>{char}</button>
```
There is:
- no row/word click handler that opens the **vocab card** detail, and
- no row-level handler for a kanji entry to open its **kanji card**.

This is feasible exactly as you noted: imported entries are all dictionary-backed
vocab cards, so a word row can open its vocab card; a kanji entry can open its
kanji card.

### Fix direction
Make the word cell (or row) open a vocab-card detail view (reuse
`ResultDetail` / the review-card layout), and make a kanji entry open its kanji
card. Keep the inner per-kanji breakdown affordance if desired, but the row as a
whole should open the corresponding card.

---

## VOCAB-03 — Grading a card during review instantly exits the review session

**Severity**: Critical
**Files**: `src/App.tsx:886-887`, `src/components/VocabSheetPage.tsx:198-212`

### Reproduction
1. Have due cards → open Vocab → click **Review N**.
2. Reveal a card and tap any grade.
3. You're dumped back to the table after a single card.

### Root cause
`App.tsx` mounts the page with `key={lookupDeckVersion}`. Every grade calls
`handleReviewDone → onDeckChange?.()`, which bumps `lookupDeckVersion`, changing
the `key` and **remounting** `VocabSheetPage`. The fresh instance starts with
`reviewing = false`, so `ReviewSession` unmounts mid-session. (Card schedules are
saved; the session is destroyed.)

### Fix direction
Don't remount the page on deck changes — refresh state in place (re-read
`getLookupCards()` / `getVocabWords()`), or don't fire `onDeckChange` for
in-session grades.

---

## VOCAB-04 — Importing a second image drops distinct words from earlier imports (wrong dedup key)

**Severity**: High (data loss)
**Files**: `backend/internal/vocab/normalize.go:23`, `src/utils/vocab-words.ts:97-109, 174-180`, `src/components/VocabSheetPage.tsx:163-167`

Dedup itself is intended — but it's keyed on the wrong thing, so it removes
*different* words instead of identical ones.

### Reproduction
1. Import image A, confirm ~10 rows.
2. Import image B (a different page), confirm.
3. Several unrelated words from image A disappear.

### Root cause
The backend re-numbers rows from scratch on every request (both OCR and Ollama
paths funnel through `normalizeImportedRows`):
```go
row.ID = fmt.Sprintf("row-%03d", len(out)+1)   // row-001, row-002, ... every import
```
`createVocabWordsFromImport` keeps that id, and the merge dedupes by id, keeping
the first occurrence:
```ts
const nextWords = normalizeVocabWords([...rowsToSave, ...words]);
// normalizeVocabWords: if (seenIds.has(w.id)) continue;
```
So image B's `row-003` collides with image A's unrelated `row-003`, and the older
word is dropped.

### Fix direction
Dedup by **dictionary card identity** (e.g. `lookupCardId("vocab", word, reading)`
/ `dictMatch.id`), which matches the intent ("map to internal dictionary cards,
strictly deduplicated"). Stop using the backend's sequential `row-NNN` as a
persistent identity — mint a fresh id per imported word, or key purely on the
matched card.

---

## VOCAB-05 — Removing a word leaves a permanent, un-deletable orphan row

**Severity**: Medium-High
**Files**: `src/components/VocabSheetPage.tsx:97-104, 192-196, 426-435`

### Reproduction
1. Import + confirm a word (shows an SRS chip).
2. Hover → click the trash icon.
3. The SRS chip vanishes but the row remains — and now has no trash icon, so it
   can't be removed again.

### Root cause
`handleRemove` only deletes the lookup **deck** card, never the backing
`VocabWord`:
```ts
const next = await removeLookupCard(id);   // deck only — words[] untouched
```
The `VocabWord` stays in `words`, so `enrichedWords` keeps rendering it with
`deckCard === undefined`, and the trash button is gated on `row.deckCard`. No code
path removes a `VocabWord` from `words` at all.

### Fix direction
Row delete should remove the deck card **and** the backing `VocabWord` (persist
via `saveVocabWords`), and a delete control should render for every row.

---

## VOCAB-06 — Adding a word from search remounts the page, destroying an open import modal / notice

**Severity**: Medium
**Files**: `src/App.tsx:884-922`, `src/components/VocabSheetPage.tsx:52-54`

Any deck mutation from anywhere (including the global Search overlay) bumps
`lookupDeckVersion`, which is the page's `key`, remounting `VocabSheetPage` and
discarding its local state (`importReview`, `notice`, `segment`, `query`,
`reviewing`). So adding a word via search while an import-review modal is open
wipes the modal and its selection. Same root cause as VOCAB-03.

---

## VOCAB-07 — Reading column shows noisy OCR text instead of the clean dictionary reading

**Severity**: Medium
**Files**: `src/utils/vocab-dict-match.ts:190-211`, `src/components/VocabSheetPage.tsx:390-395`

Since words map to dictionary cards, the displayed surface form swapping to the
dictionary form is intended — but the **reading** should follow the dictionary
too, and it doesn't:
```tsx
const reading = row.furigana || match?.reading || "";   // ← OCR furigana wins
```
`row.furigana` is set to the OCR'd Japanese line during enrichment, and for
textbook pages with furigana ruby that text is frequently garbled by Tesseract
(PSM 6 merges ruby into the line). So a noisy reading is shown in preference to
the correct dictionary reading.

### Fix direction
For matched rows, prefer `match.reading` for the Reading column.

---

## VOCAB-08 — Import confirm has no error handling and sets state after unmount

**Severity**: Medium
**Files**: `src/components/VocabSheetPage.tsx:163-185, 473-477`

```ts
async function handleConfirm() {
  setConfirming(true);
  await onConfirm(rows, selected);   // no try/catch
  setConfirming(false);              // parent already unmounted the modal on success
}
```
- `handleConfirmImport` awaits `saveVocabWords` + multiple `addLookupCard` writes
  with no try/catch. If any reject (storage quota, DB error), the modal spins
  forever and state can be left partially persisted (words saved, deck not, or
  vice-versa).
- On success the parent unmounts the modal, then `setConfirming(false)` runs on
  an unmounted component → React state-update-on-unmounted warning.

### Fix direction
Wrap the confirm path in try/catch with an error notice; guard the trailing
`setConfirming(false)`.

---

## VOCAB-09 — Dead uploaded-image preview code (object-URL churn/leak)

**Severity**: Low (cleanup)
**Files**: `src/components/VocabSheetPage.tsx:53, 62-66, 150-151`

A preview isn't required, but the preview plumbing was left in: `handleImport`
creates `URL.createObjectURL(file)` and stores `previewURL`, which is never passed
to or rendered by the modal. The cleanup effect also closes over a stale value:
```ts
useEffect(() => {
  return () => { if (importReview) URL.revokeObjectURL(importReview.previewURL); };
}, []);   // empty deps → captures the initial null; revoke never runs on real unmount
```
So the object URL leaks on the `key`-driven remount.

### Fix direction
Remove the `previewURL` machinery entirely.

---

## VOCAB-10 — Dictionary load failure makes import a silent no-op

**Severity**: Low
**Files**: `src/utils/vocab-dict-match.ts:176-188`, `src/components/VocabSheetPage.tsx:147-152`

Dropping unmatched rows is intended, but if `loadDictionary()` *fails*, every row
becomes unmatched and is dropped, so a successful OCR yields zero saved words with
no explanation of why. Worth a distinct "dictionary unavailable" message rather
than a generic empty result.

---

## VOCAB-11 — Header miscounts and empty columns (minor)

**Severity**: Low
**Files**: `src/components/VocabSheetPage.tsx:220-224, 79-94, 420-422`

- `{allRows.length} words` counts kanji entries and search-added deck entries too.
- Deck-only rows set `romaji: ""` (and kanji rows set `furigana: ""`), so the
  Romaji column is blank for everything added via search and the Reading column is
  blank for kanji entries — large stretches of empty cells.

---

## Summary

| # | Area | Severity | Short description |
|---|------|----------|-------------------|
| 01 | Filter toggle | High | All/語/字 toggle does nothing (imported words never classified as kanji) |
| 02 | Interaction | High | Clicking a word/kanji row doesn't open its card |
| 03 | Review session | Critical | Grading one card remounts the page and exits review |
| 04 | Import / dedup | High | Second import drops distinct words (dedup keyed on reused `row-NNN`) |
| 05 | Deletion | Med-High | Trash strips SRS but leaves a permanent, un-deletable row |
| 06 | State / wiring | Medium | Search-add remounts page, destroying open import modal/notice |
| 07 | Display | Medium | Noisy OCR reading shown instead of dictionary reading |
| 08 | Import confirm | Medium | No error handling; setState after unmount |
| 09 | Cleanup | Low | Dead preview-URL code + object-URL leak |
| 10 | Import | Low | Dictionary load failure → silent empty import |
| 11 | Display | Low | "{n} words" miscount; empty Romaji/Reading columns |

### Dropped from the earlier draft (intended behavior, per design intent)
- Discarding unmatched rows — **intended** (drop non-matches).
- Missing uploaded-image preview — **not required** (reclassified as dead-code cleanup, VOCAB-09).
- "Word silently swapped to dictionary surface form" — **intended** (words map to dictionary cards); only the *reading* discrepancy remains a bug (VOCAB-07).

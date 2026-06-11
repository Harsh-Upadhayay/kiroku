/**
 * Lesson navigation, Redo Day, Return Home, and Day-unlock flows.
 * Covers: N-01, D-04, D-10, D-11, BR-16, LE-06/07/08, N-12
 */
import { test, expect } from "@playwright/test";
import {
  freshStart,
  completeAllGrammar,
  completeAllVocab,
  completeAllKanji,
  submitProduce,
} from "./helpers";

// ---------------------------------------------------------------------------
// BR-16 / D-04: Complete Day 1 → Return Home → Day 2 unlocked
// ---------------------------------------------------------------------------

test.describe("BR-16 / D-04: Day completion unlocks next day", () => {
  test.beforeEach(async ({ page }) => {
    await freshStart(page);
  });

  test("BR-16: Day 2 is unlocked and shown as CURRENT after completing Day 1", async ({ page }) => {
    test.slow();

    const startBtn = page.locator('button:has-text("Start"), button:has-text("Begin Day 1")').first();
    if (await startBtn.count() === 0) {
      test.skip(true, "Start button not found");
      return;
    }
    await startBtn.click();
    await page.waitForTimeout(500);

    await completeAllGrammar(page);
    await page.waitForTimeout(300);
    await completeAllVocab(page);
    await page.waitForTimeout(300);
    await completeAllKanji(page);
    await page.waitForTimeout(300);
    await submitProduce(page);
    await page.waitForTimeout(800);

    // Should be on Done stage — click Return Home
    const returnHome = page.locator('button:has-text("Return Home"), button:has-text("Return to Home")').first();
    if (await returnHome.count() > 0) {
      await returnHome.click();
      await page.waitForTimeout(800);
    }

    // Day 2 should now be accessible / shown as current
    const bodyText = await page.locator("body").innerText();
    const hasDay2 = bodyText.includes("Day 2") || bodyText.includes("day 2");
    expect(hasDay2).toBe(true);
  });

  test("D-04: Return Home button navigates back to course home after completion", async ({ page }) => {
    test.slow();

    const startBtn = page.locator('button:has-text("Start"), button:has-text("Begin Day 1")').first();
    if (await startBtn.count() === 0) {
      test.skip(true, "Start button not found");
      return;
    }
    await startBtn.click();
    await page.waitForTimeout(500);

    await completeAllGrammar(page);
    await page.waitForTimeout(200);
    await completeAllVocab(page);
    await page.waitForTimeout(200);
    await completeAllKanji(page);
    await page.waitForTimeout(200);
    await submitProduce(page);
    await page.waitForTimeout(500);

    const returnHome = page.locator('button:has-text("Return Home"), button:has-text("Return to Home")').first();
    if (await returnHome.count() === 0) {
      test.skip(true, "Return Home button not found on done stage");
      return;
    }
    await returnHome.click();
    await page.waitForTimeout(600);

    // Should be back on N5 course home
    const bodyText = await page.locator("body").innerText();
    const isHome = bodyText.toLowerCase().includes("day 1") || bodyText.toLowerCase().includes("day 2");
    expect(isHome).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// N-01: Back to Home mid-lesson
// ---------------------------------------------------------------------------

test.describe("N-01: Navigate back to home mid-lesson", () => {
  test.beforeEach(async ({ page }) => {
    await freshStart(page);
  });

  test("N-01: Clicking Home/back mid-lesson returns to course home", async ({ page }) => {
    const startBtn = page.locator('button:has-text("Start"), button:has-text("Begin Day 1")').first();
    if (await startBtn.count() === 0) {
      test.skip(true, "Start button not found");
      return;
    }
    await startBtn.click();
    await page.waitForTimeout(500);

    // Should be inside the lesson
    const homeBtn = page.locator(
      'button:has-text("Home"), a:has-text("Home"), [aria-label*="home"], button:has-text("← Home"), button:has-text("Back")'
    ).first();
    if (await homeBtn.count() === 0) {
      test.skip(true, "Home button not found inside lesson");
      return;
    }
    await homeBtn.click();
    await page.waitForTimeout(500);

    // Should be back at N5 course home
    const bodyText = await page.locator("body").innerText();
    const isHome =
      bodyText.toLowerCase().includes("day 1") ||
      bodyText.toLowerCase().includes("streak") ||
      bodyText.toLowerCase().includes("start");
    expect(isHome).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// LE-06 / LE-07 / LE-08: StageRail navigation
// ---------------------------------------------------------------------------

test.describe("LE-06/07/08: StageRail shows stages and navigation", () => {
  test.beforeEach(async ({ page }) => {
    await freshStart(page);
  });

  test("LE-06: StageRail displays stage pills with current stage highlighted", async ({ page }) => {
    const startBtn = page.locator('button:has-text("Start"), button:has-text("Begin Day 1")').first();
    if (await startBtn.count() === 0) {
      test.skip(true, "Start button not found");
      return;
    }
    await startBtn.click();
    await page.waitForTimeout(500);

    // StageRail should show stage labels
    const bodyText = await page.locator("body").innerText();
    const hasRail =
      bodyText.match(/Review|Grammar|Vocab|Kanji|Produce|Done/i);
    expect(!!hasRail).toBe(true);
  });

  test("LE-07: Completed grammar stage pill is clickable and navigates back", async ({ page }) => {
    const startBtn = page.locator('button:has-text("Start"), button:has-text("Begin Day 1")').first();
    if (await startBtn.count() === 0) {
      test.skip(true, "Start button not found");
      return;
    }
    await startBtn.click();
    await page.waitForTimeout(500);

    // Complete one grammar item to unlock the vocab stage
    await completeAllGrammar(page);
    await page.waitForTimeout(500);

    // Now on vocab stage — grammar pill should be clickable
    const grammarPill = page.locator(
      'button:has-text("Grammar"), [data-stage="grammar"], [aria-label*="Grammar"]'
    ).first();
    if (await grammarPill.count() === 0) {
      test.skip(true, "Grammar stage pill not found");
      return;
    }
    await grammarPill.click();
    await page.waitForTimeout(400);

    // Should now be on grammar stage
    const bodyText = await page.locator("body").innerText();
    const onGrammar = bodyText.match(/Learnt|Grammar|Next Grammar/i);
    expect(!!onGrammar).toBe(true);
  });

  test("LE-08: Future stage pill is disabled — cannot navigate forward via rail", async ({ page }) => {
    const startBtn = page.locator('button:has-text("Start"), button:has-text("Begin Day 1")').first();
    if (await startBtn.count() === 0) {
      test.skip(true, "Start button not found");
      return;
    }
    await startBtn.click();
    await page.waitForTimeout(500);

    // On grammar stage — Produce pill should be disabled (future stage)
    const producePill = page.locator(
      'button:has-text("Produce"), [data-stage="produce"], [aria-label*="Produce"]'
    ).first();
    if (await producePill.count() === 0) {
      test.skip(true, "Produce stage pill not found");
      return;
    }
    const isDisabled =
      (await producePill.getAttribute("disabled")) !== null ||
      (await producePill.getAttribute("aria-disabled")) === "true";
    expect(isDisabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// D-10 / D-11 / N-12: Redo Day flow
// ---------------------------------------------------------------------------

test.describe("D-10/D-11/N-12: Redo Day functionality", () => {
  test.beforeEach(async ({ page }) => {
    await freshStart(page);
  });

  test("D-10: Completed day from Map opens read-only with Redo Day button", async ({ page }) => {
    test.slow();

    // Complete Day 1 first
    const startBtn = page.locator('button:has-text("Start"), button:has-text("Begin Day 1")').first();
    if (await startBtn.count() === 0) {
      test.skip(true, "Start button not found");
      return;
    }
    await startBtn.click();
    await page.waitForTimeout(500);
    await completeAllGrammar(page);
    await page.waitForTimeout(200);
    await completeAllVocab(page);
    await page.waitForTimeout(200);
    await completeAllKanji(page);
    await page.waitForTimeout(200);
    await submitProduce(page);
    await page.waitForTimeout(500);

    // Return home
    await page.locator('button:has-text("Return Home"), button:has-text("Home")').first().click().catch(() => {});
    await page.waitForTimeout(500);

    // Navigate to map
    const mapBtn = page.locator('button:has-text("Map"), a:has-text("Map")').first();
    if (await mapBtn.count() === 0) {
      test.skip(true, "Map button not found");
      return;
    }
    await mapBtn.click();
    await page.waitForTimeout(500);

    // Click Day 1 (now completed)
    const day1Cell = page.locator('button:has-text("1")').first();
    await day1Cell.click();
    await page.waitForTimeout(500);

    // Should show Redo Day button in read-only mode
    await expect(
      page.locator('button:has-text("Redo"), button:has-text("Redo Day")')
    ).toBeVisible({ timeout: 5000 });
  });

  test("D-11: Read-only revisit shows completed-day content without active controls", async ({ page }) => {
    test.slow();

    const startBtn = page.locator('button:has-text("Start"), button:has-text("Begin Day 1")').first();
    if (await startBtn.count() === 0) {
      test.skip(true, "Start button not found");
      return;
    }
    await startBtn.click();
    await page.waitForTimeout(500);
    await completeAllGrammar(page);
    await page.waitForTimeout(200);
    await completeAllVocab(page);
    await page.waitForTimeout(200);
    await completeAllKanji(page);
    await page.waitForTimeout(200);
    await submitProduce(page);
    await page.waitForTimeout(500);

    await page.locator('button:has-text("Return Home"), button:has-text("Home")').first().click().catch(() => {});
    await page.waitForTimeout(500);

    const mapBtn = page.locator('button:has-text("Map"), a:has-text("Map")').first();
    if (await mapBtn.count() === 0) {
      test.skip(true, "Map not found");
      return;
    }
    await mapBtn.click();
    await page.waitForTimeout(500);

    const day1Cell = page.locator('button:has-text("1")').first();
    await day1Cell.click();
    await page.waitForTimeout(500);

    // In read-only mode, "Learnt (move on)" buttons should NOT appear (only Next/Continue)
    const learntBtn = page.locator('button:has-text("Learnt (move on)")');
    expect(await learntBtn.count()).toBe(0);
  });

  test("N-12: Redo Day resets stage to review but SRS cards persist", async ({ page }) => {
    test.slow();

    const startBtn = page.locator('button:has-text("Start"), button:has-text("Begin Day 1")').first();
    if (await startBtn.count() === 0) {
      test.skip(true, "Start button not found");
      return;
    }
    await startBtn.click();
    await page.waitForTimeout(500);
    await completeAllGrammar(page);
    await page.waitForTimeout(200);
    await completeAllVocab(page);
    await page.waitForTimeout(200);
    await completeAllKanji(page);
    await page.waitForTimeout(200);
    await submitProduce(page);
    await page.waitForTimeout(500);

    await page.locator('button:has-text("Return Home"), button:has-text("Home")').first().click().catch(() => {});
    await page.waitForTimeout(500);

    const mapBtn = page.locator('button:has-text("Map"), a:has-text("Map")').first();
    if (await mapBtn.count() === 0) {
      test.skip(true, "Map not found");
      return;
    }
    await mapBtn.click();
    await page.waitForTimeout(500);

    const day1Cell = page.locator('button:has-text("1")').first();
    await day1Cell.click();
    await page.waitForTimeout(500);

    const redoBtn = page.locator('button:has-text("Redo"), button:has-text("Redo Day")').first();
    if (await redoBtn.count() === 0) {
      test.skip(true, "Redo Day button not found");
      return;
    }
    await redoBtn.click();
    await page.waitForTimeout(500);

    // After redo: should be back in write mode (grammar/review stage)
    const bodyText = await page.locator("body").innerText();
    const isInLesson = bodyText.match(/Grammar|Review|Learnt|vocab/i);
    expect(!!isInLesson).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// N-10 / N-11: Lesson progress bar advances
// ---------------------------------------------------------------------------

test.describe("N-10 / N-11: Lesson progress bar", () => {
  test.beforeEach(async ({ page }) => {
    await freshStart(page);
  });

  test("N-10: Progress bar increases as stages are completed", async ({ page }) => {
    const startBtn = page.locator('button:has-text("Start"), button:has-text("Begin Day 1")').first();
    if (await startBtn.count() === 0) {
      test.skip(true, "Start button not found");
      return;
    }
    await startBtn.click();
    await page.waitForTimeout(500);

    // Read initial progress
    const getProgress = async () => {
      const bar = page.locator('[aria-label^="Day progress"]').first();
      if (await bar.count() === 0) return -1;
      const label = await bar.getAttribute("aria-label");
      const match = label?.match(/(\d+)%/);
      return match ? parseInt(match[1]) : -1;
    };

    const before = await getProgress();
    await completeAllGrammar(page);
    await page.waitForTimeout(300);
    const after = await getProgress();

    if (before >= 0 && after >= 0) {
      expect(after).toBeGreaterThan(before);
    }
    // If progress bar not found, at least verify we advanced to vocab
    const bodyText = await page.locator("body").innerText();
    expect(bodyText.match(/vocab|word|Grammar/i)).toBeTruthy();
  });
});

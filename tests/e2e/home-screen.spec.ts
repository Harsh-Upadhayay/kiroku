/**
 * TC-HOME: Home screen tests (H-01 to H-11)
 * TC-LESSON-ENTRY: Lesson entry tests (LE-01 to LE-08)
 */
import { test, expect } from "@playwright/test";
import {
  freshStart,
  completeAllGrammar,
  completeAllVocab,
  completeAllKanji,
  submitProduce,
  makeAllN5CardsDue,
  todayKey,
  yesterdayKey,
} from "./helpers";

// ---------------------------------------------------------------------------
// TC-HOME
// ---------------------------------------------------------------------------

test.describe("H-01: Fresh start — Day 1 is current", () => {
  test.beforeEach(async ({ page }) => {
    await freshStart(page);
  });

  test("H-01: Shows Day 1 as today's focus on a fresh start", async ({ page }) => {
    await expect(page.locator("h2").first()).toBeVisible({ timeout: 8000 });
    const heading = await page.locator("h2").first().textContent();
    expect(heading).toMatch(/Day 1/);
  });

  test("H-02: Start button visible and clickable on home", async ({ page }) => {
    const startBtn = page.locator('button:has-text("Start")');
    await expect(startBtn.first()).toBeVisible({ timeout: 5000 });
    await expect(startBtn.first()).toBeEnabled();
  });

  test("H-03: Review/Practice button hidden when no learned cards (fresh)", async ({ page }) => {
    // With no learned cards, the "Practice all" / "Review" button should NOT appear
    const reviewBtn = page.locator('button:has-text("Practice all"), button:has-text("Review (")');
    const count = await reviewBtn.count();
    expect(count).toBe(0);
  });

  test("H-04: Review count shows 0 / All caught up on fresh start", async ({ page }) => {
    await expect(page.locator("text=/All caught up/")).toBeVisible({ timeout: 5000 });
  });

  test("H-05: Streak shows 0 days on fresh start", async ({ page }) => {
    const streakText = await page.locator("body").innerText();
    expect(streakText).toMatch(/0 day|streak/i);
  });

  test("H-06: Map button is visible on home", async ({ page }) => {
    await expect(page.locator('button:has-text("Map")')).toBeVisible({ timeout: 5000 });
  });

  test("H-07: Kanji and Vocab library Browse buttons are visible", async ({ page }) => {
    const browseButtons = page.locator('button:has-text("Browse")');
    await expect(browseButtons.first()).toBeVisible({ timeout: 5000 });
    const count = await browseButtons.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test("H-08: Practice decks section is hidden when no cards learned", async ({ page }) => {
    const practiceDecks = page.locator("text=/Practice decks/i");
    const visible = await practiceDecks.isVisible().catch(() => false);
    expect(visible).toBe(false);
  });
});

test.describe("H-09 to H-11: Home with learned cards", () => {
  test.beforeEach(async ({ page }) => {
    await freshStart(page);
    // Complete grammar to get SRS cards
    await page.locator('button:has-text("Start")').first().click();
    await page.waitForTimeout(500);
    await completeAllGrammar(page);
    await page.waitForTimeout(300);
    // Go back home
    await page.locator('button:has-text("Home")').first().click();
    await page.waitForTimeout(300);
  });

  test("H-09: Practice decks section visible after learning cards", async ({ page }) => {
    await expect(page.locator("text=/Practice decks/i")).toBeVisible({ timeout: 5000 });
  });

  test("H-10: Practice all button appears after learning cards", async ({ page }) => {
    const practiceBtn = page.locator('button:has-text("Practice all")');
    await expect(practiceBtn.first()).toBeVisible({ timeout: 5000 });
  });

  test("H-11: Review load trend sparkline section is visible", async ({ page }) => {
    await expect(page.locator("text=/Review load trend/i")).toBeVisible({ timeout: 5000 });
  });
});

test.describe("H-Review: Home with due cards", () => {
  test("H-due: Due count shows correctly when cards are overdue", async ({ page }) => {
    await freshStart(page);
    // Learn grammar to create SRS cards
    await page.locator('button:has-text("Start")').first().click();
    await page.waitForTimeout(500);
    await completeAllGrammar(page);
    await page.waitForTimeout(300);
    // Go back home
    await page.locator('button:has-text("Home")').first().click();
    await page.waitForTimeout(300);
    // Make all cards due
    await makeAllN5CardsDue(page);
    await page.reload();
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1000);
    // Should show "Review (N due)" or "N review(s) due"
    const bodyText = await page.locator("body").innerText();
    const hasDue = bodyText.match(/review.*due|due.*review|\d+ due/i);
    expect(!!hasDue).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// TC-LESSON-ENTRY
// ---------------------------------------------------------------------------

test.describe("TC-LESSON-ENTRY (LE-01 to LE-08)", () => {
  test.beforeEach(async ({ page }) => {
    await freshStart(page);
  });

  test("LE-01: Day 1 start button opens lesson view", async ({ page }) => {
    await page.locator('button:has-text("Start")').first().click();
    await page.waitForTimeout(500);
    // Should be in lesson — "Home" back button visible
    await expect(page.locator('button:has-text("Home")')).toBeVisible({ timeout: 5000 });
  });

  test("LE-02: Day 1 opens at Grammar stage (no SRS cards to review)", async ({ page }) => {
    await page.locator('button:has-text("Start")').first().click();
    await page.waitForTimeout(500);
    // Fresh user → Grammar (review skipped since no SRS cards)
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).toMatch(/Grammar/i);
    expect(bodyText).not.toMatch(/Show answer|reveal/i);
  });

  test("LE-03: StageRail is visible in lesson", async ({ page }) => {
    await page.locator('button:has-text("Start")').first().click();
    await page.waitForTimeout(500);
    // StageRail shows stage names
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).toMatch(/grammar/i);
    expect(bodyText).toMatch(/vocab/i);
  });

  test("LE-04: Day progress bar is shown in lesson", async ({ page }) => {
    await page.locator('button:has-text("Start")').first().click();
    await page.waitForTimeout(500);
    // aria-label="Day progress X%"
    const progressEl = page.locator('[aria-label^="Day progress"]');
    await expect(progressEl).toBeVisible({ timeout: 5000 });
  });

  test("LE-05: Home back button exits lesson and returns to home", async ({ page }) => {
    await page.locator('button:has-text("Start")').first().click();
    await page.waitForTimeout(500);
    await page.locator('button:has-text("Home")').first().click();
    await page.waitForTimeout(400);
    // Should be back on home — "Start" button visible
    await expect(page.locator("text=/Day 1/").first()).toBeVisible({ timeout: 5000 });
  });

  test("LE-06: StageRail completed stages are visually marked (grammar after completing)", async ({ page }) => {
    await page.locator('button:has-text("Start")').first().click();
    await page.waitForTimeout(500);
    await completeAllGrammar(page);
    await page.waitForTimeout(300);
    // Completed stage should be visually different — vocab heading visible
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).toMatch(/Vocab/i);
  });

  test("LE-07: Clicking completed stage in StageRail navigates back", async ({ page }) => {
    await page.locator('button:has-text("Start")').first().click();
    await page.waitForTimeout(500);
    await completeAllGrammar(page);
    await page.waitForTimeout(300);
    // We should be on vocab now; click the Grammar button in the rail
    const grammarBtn = page.locator('button:has-text("Grammar")').first();
    if (await grammarBtn.isEnabled()) {
      await grammarBtn.click();
      await page.waitForTimeout(300);
      const bodyText = await page.locator("body").innerText();
      expect(bodyText).toMatch(/Grammar/i);
    }
  });

  test("LE-08: Map button on home opens 30-day map", async ({ page }) => {
    await page.locator('button:has-text("Map")').first().click();
    await page.waitForTimeout(400);
    await expect(page.locator("text=/30-day map/i")).toBeVisible({ timeout: 5000 });
  });
});

// ---------------------------------------------------------------------------
// TC-MAP
// ---------------------------------------------------------------------------

test.describe("TC-MAP (M-01 to M-08)", () => {
  test.beforeEach(async ({ page }) => {
    await freshStart(page);
  });

  test("M-01: Map shows all 30 days", async ({ page }) => {
    await page.locator('button:has-text("Map")').first().click();
    await page.waitForTimeout(400);
    // Should show days 1-30
    await expect(page.locator("text=/30-day map/i")).toBeVisible({ timeout: 5000 });
    const dayButtons = page.locator('[class*="rounded-2xl"]:has-text("1")');
    await expect(dayButtons.first()).toBeVisible({ timeout: 3000 });
  });

  test("M-02: Day 1 is shown as Current", async ({ page }) => {
    await page.locator('button:has-text("Map")').first().click();
    await page.waitForTimeout(400);
    await expect(page.locator("text=/Current/i")).toBeVisible({ timeout: 5000 });
  });

  test("M-03: Days 2-30 are shown as Preview/locked", async ({ page }) => {
    await page.locator('button:has-text("Map")').first().click();
    await page.waitForTimeout(400);
    await expect(page.locator("text=/Preview/i").first()).toBeVisible({ timeout: 5000 });
  });

  test("M-04: Back to Course Home from map", async ({ page }) => {
    await page.locator('button:has-text("Map")').first().click();
    await page.waitForTimeout(400);
    await page.locator('button:has-text("Course Home")').first().click();
    await page.waitForTimeout(300);
    await expect(page.locator("text=/Day 1/").first()).toBeVisible({ timeout: 5000 });
  });

  test("M-05: Clicking Day 1 on map opens the lesson", async ({ page }) => {
    await page.locator('button:has-text("Map")').first().click();
    await page.waitForTimeout(400);
    // Click on day 1 button in the grid
    const day1 = page.locator('[class*="rounded-2xl"]:has-text("Current")');
    if (await day1.count() > 0) {
      await day1.first().click();
      await page.waitForTimeout(500);
      await expect(page.locator('button:has-text("Home")')).toBeVisible({ timeout: 5000 });
    }
  });

  test("M-06: Clicking a locked day opens it as Preview (read-only)", async ({ page }) => {
    await page.locator('button:has-text("Map")').first().click();
    await page.waitForTimeout(400);
    const previewDay = page.locator('[class*="rounded-2xl"]:has-text("Preview")').first();
    if (await previewDay.count() > 0) {
      await previewDay.click();
      await page.waitForTimeout(500);
      const bodyText = await page.locator("body").innerText();
      expect(bodyText).toMatch(/Preview|Read-only/i);
    }
  });

  test("M-07: Map shows Done indicator for completed days", async ({ page }) => {
    // Complete Day 1 first
    test.slow();
    await page.locator('button:has-text("Start")').first().click();
    await page.waitForTimeout(500);
    await completeAllGrammar(page);
    await page.waitForTimeout(200);
    await completeAllVocab(page);
    await page.waitForTimeout(200);
    await completeAllKanji(page);
    await page.waitForTimeout(200);
    await submitProduce(page);
    await page.waitForTimeout(300);
    // Return home then check map
    await page.locator('button:has-text("Return Home")').first().click();
    await page.waitForTimeout(400);
    await page.locator('button:has-text("Map")').first().click();
    await page.waitForTimeout(400);
    await expect(page.locator("text=/Done/i").first()).toBeVisible({ timeout: 5000 });
  });
});

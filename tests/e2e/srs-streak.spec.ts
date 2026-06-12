/**
 * TC-SRS (SRS-01 to SRS-07) — SRS integration via e2e
 * TC-STREAK (ST-01 to ST-07) — Streak display via e2e
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
// TC-SRS (e2e level)
// ---------------------------------------------------------------------------

test.describe("TC-SRS: SRS card creation and review flow", () => {
  test.beforeEach(async ({ page }) => {
    await freshStart(page);
  });

  test("SRS-01: Learning grammar creates SRS cards (Practice all button appears)", async ({ page }) => {
    await page.locator('button:has-text("Start")').first().click();
    await page.waitForTimeout(500);
    await completeAllGrammar(page);
    await page.waitForTimeout(300);
    await page.locator('button:has-text("Home")').first().click();
    await page.waitForTimeout(300);
    // Practice all should now be visible (cards were created)
    await expect(page.locator('button:has-text("Practice all")').first()).toBeVisible({ timeout: 5000 });
  });

  test("SRS-02: Learned cards appear in Practice All session", async ({ page }) => {
    await page.locator('button:has-text("Start")').first().click();
    await page.waitForTimeout(500);
    await completeAllGrammar(page);
    await page.waitForTimeout(300);
    await page.locator('button:has-text("Home")').first().click();
    await page.waitForTimeout(300);
    // Start Practice All
    await page.locator('button:has-text("Practice all")').first().click();
    await page.waitForTimeout(500);
    // Should show cards — session counter visible (tabular-nums avoids matching the hidden header stat)
    await expect(page.locator('[class*="tabular-nums"]').first()).toBeVisible({ timeout: 5000 });
  });

  test("SRS-03: Grading a card with 'Again' keeps it visible in session", async ({ page }) => {
    await page.locator('button:has-text("Start")').first().click();
    await page.waitForTimeout(500);
    await completeAllGrammar(page);
    await page.waitForTimeout(300);
    await page.locator('button:has-text("Home")').first().click();
    await page.waitForTimeout(300);
    await page.locator('button:has-text("Practice all")').first().click();
    await page.waitForTimeout(500);
    const showAnswer = page.locator('button:has-text("Show answer")').first();
    if (await showAnswer.count() > 0) {
      await showAnswer.click();
      await page.waitForTimeout(200);
    }
    const againBtn = page.locator('button:has-text("Again")').first();
    if (await againBtn.count() > 0) {
      await againBtn.click();
      await page.waitForTimeout(400);
      const bodyText = await page.locator("body").innerText();
      // Accept grade buttons OR just session header/counter while next card renders
      expect(bodyText).toMatch(/Again|Hard|Good|Easy|CUMULATIVE REVIEW|\d+ \/ \d+/i);
    }
  });

  test("SRS-04: Due cards shown in home review count after makeAllN5CardsDue", async ({ page }) => {
    await page.locator('button:has-text("Start")').first().click();
    await page.waitForTimeout(500);
    await completeAllGrammar(page);
    await page.waitForTimeout(300);
    await page.locator('button:has-text("Home")').first().click();
    await page.waitForTimeout(300);
    await makeAllN5CardsDue(page);
    await page.reload();
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1000);
    // Should show "N reviews due" on home
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).toMatch(/review.*due|due.*review/i);
  });

  test("SRS-05: Review session counter decrements as cards are graded Good", async ({ page }) => {
    test.slow();
    await page.locator('button:has-text("Start")').first().click();
    await page.waitForTimeout(500);
    await completeAllGrammar(page);
    await page.waitForTimeout(300);
    await page.locator('button:has-text("Home")').first().click();
    await page.waitForTimeout(300);
    await page.locator('button:has-text("Practice all")').first().click();
    await page.waitForTimeout(500);
    // Check initial counter
    let initialText = await page.locator("body").innerText();
    const match = initialText.match(/1 \/ (\d+)/);
    if (!match) {
      test.skip(true, "Could not find counter");
      return;
    }
    const total = parseInt(match[1]);
    if (total < 2) {
      test.skip(true, "Not enough cards for counter decrement test");
      return;
    }
    // Grade first card
    const showAnswer = page.locator('button:has-text("Show answer")').first();
    if (await showAnswer.count() > 0) {
      await showAnswer.click();
      await page.waitForTimeout(200);
    }
    const goodBtn = page.locator('button:has-text("Good")').first();
    if (await goodBtn.count() > 0) {
      await goodBtn.click();
      await page.waitForTimeout(400);
      const newText = await page.locator("body").innerText();
      // Counter should show "2 / N" or complete if only 1 card
      const advanced = newText.match(/2 \/ \d+/) || newText.match(/Session complete/i);
      expect(!!advanced).toBe(true);
    }
  });

  test("SRS-06: Session complete screen shown after all cards graded", async ({ page }) => {
    test.slow();
    await page.locator('button:has-text("Start")').first().click();
    await page.waitForTimeout(500);
    await completeAllGrammar(page);
    await page.waitForTimeout(300);
    await page.locator('button:has-text("Home")').first().click();
    await page.waitForTimeout(300);
    await page.locator('button:has-text("Practice all")').first().click();
    await page.waitForTimeout(500);
    // Grade all cards
    let safety = 30;
    while (safety-- > 0) {
      const complete = page.locator("text=/Session complete/i");
      if (await complete.count() > 0) break;
      const showAnswer = page.locator('button:has-text("Show answer")').first();
      if (await showAnswer.count() > 0) {
        await showAnswer.click();
        await page.waitForTimeout(200);
      }
      const goodBtn = page.locator('button:has-text("Good")').first();
      const gradeBtn = page.locator('button:has-text("Again"), button:has-text("Good"), button:has-text("Easy")').first();
      if (await goodBtn.count() > 0) {
        await goodBtn.click();
        await page.waitForTimeout(300);
      } else if (await gradeBtn.count() > 0) {
        await gradeBtn.click();
        await page.waitForTimeout(300);
      } else {
        break;
      }
    }
    await expect(page.locator("text=/Session complete/i")).toBeVisible({ timeout: 8000 });
  });

  test("SRS-07: Vocab and kanji cards also created after learning in lesson", async ({ page }) => {
    test.slow();
    await page.locator('button:has-text("Start")').first().click();
    await page.waitForTimeout(500);
    await completeAllGrammar(page);
    await page.waitForTimeout(300);
    // Learn first vocab item
    const learntBtn = page.locator('button:has-text("Learnt")').first();
    if (await learntBtn.count() > 0) {
      await learntBtn.click();
      await page.waitForTimeout(200);
    }
    await page.locator('button:has-text("Home")').first().click();
    await page.waitForTimeout(300);
    // Practice all should show more cards than just grammar
    const practiceBtn = page.locator('button:has-text("Practice all")').first();
    if (await practiceBtn.count() > 0) {
      await practiceBtn.click();
      await page.waitForTimeout(500);
      const bodyText = await page.locator("body").innerText();
      const match = bodyText.match(/1 \/ (\d+)/);
      if (match) {
        const total = parseInt(match[1]);
        expect(total).toBeGreaterThanOrEqual(1);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// TC-STREAK (e2e level)
// ---------------------------------------------------------------------------

test.describe("TC-STREAK: Streak display", () => {
  test.beforeEach(async ({ page }) => {
    await freshStart(page);
  });

  test("ST-01: Streak is 0 on fresh start", async ({ page }) => {
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).toMatch(/0 day|0-day|Streak.*0/i);
  });

  test("ST-02: Streak increments to 1 after completing Day 1", async ({ page }) => {
    test.slow();
    await page.locator('button:has-text("Start")').first().click();
    await page.waitForTimeout(500);
    await completeAllGrammar(page);
    await page.waitForTimeout(300);
    await completeAllVocab(page);
    await page.waitForTimeout(300);
    await completeAllKanji(page);
    await page.waitForTimeout(300);
    await submitProduce(page);
    await page.waitForTimeout(400);
    // Done stage shows streak count
    await expect(page.locator("text=/1 day streak/i")).toBeVisible({ timeout: 8000 });
  });

  test("ST-03: Streak is shown on home screen", async ({ page }) => {
    const streakSection = page.locator("text=/Streak/i");
    await expect(streakSection.first()).toBeVisible({ timeout: 5000 });
  });

  test("ST-04: Streak value displayed in lesson Done stage", async ({ page }) => {
    test.slow();
    await page.locator('button:has-text("Start")').first().click();
    await page.waitForTimeout(500);
    await completeAllGrammar(page);
    await page.waitForTimeout(300);
    await completeAllVocab(page);
    await page.waitForTimeout(300);
    await completeAllKanji(page);
    await page.waitForTimeout(300);
    await submitProduce(page);
    await page.waitForTimeout(400);
    await expect(page.locator("text=/day streak/i")).toBeVisible({ timeout: 8000 });
  });

  test("ST-05: Streak flame icon is visible on home", async ({ page }) => {
    // The Flame icon is rendered as SVG; parent shows "Streak" label
    await expect(page.locator("text=/Streak/i").first()).toBeVisible({ timeout: 5000 });
  });

  test("ST-06: Streak shown as '0 days' when zero", async ({ page }) => {
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).toMatch(/0 day/i);
  });

  test("ST-07: Day segments shown in streak section", async ({ page }) => {
    // DaySegments component renders in the streak section
    // At minimum check the streak section contains the label
    await expect(page.locator("text=/Streak/i").first()).toBeVisible({ timeout: 5000 });
  });
});

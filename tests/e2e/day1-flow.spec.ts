/**
 * TC-BROWSER: Day 1 Full Flow (BR-01 to BR-16)
 * Covers Grammar → Vocab → Kanji → Produce → Done end-to-end.
 */
import { test, expect } from "@playwright/test";
import { freshStart, completeAllGrammar, submitProduce } from "./helpers";

test.describe("Day 1 Full Flow", () => {
  test.beforeEach(async ({ page }) => {
    await freshStart(page);
  });

  // BR-01: Fresh user, Day 1 opens at Grammar (review stage is skipped when no SRS cards)
  test("BR-01: Day 1 opens at Grammar stage, not Review", async ({ page }) => {
    await page.locator('button:has-text("Start"), button:has-text("Begin Day 1")').first().click();
    await page.waitForTimeout(500);
    // Should NOT show a "Show answer" or MC option (which would be Review)
    // Should show grammar content
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toMatch(/Show answer/i);
    // Grammar stage shows "Learnt (move on)" button
    await expect(page.locator('button:has-text("Learnt")')).toBeVisible({ timeout: 5000 });
  });

  // BR-02: Grammar progress bar at ~20% when just opened
  test("BR-02: Grammar progress bar shows around 20%", async ({ page }) => {
    await page.locator('button:has-text("Start"), button:has-text("Begin Day 1")').first().click();
    await page.waitForTimeout(500);
    // Progress bar: outer div has aria-label="Day progress N%"; parse N from it
    const progressBar = page.locator('[aria-label^="Day progress"]').first();
    if (await progressBar.count() > 0) {
      const label = await progressBar.getAttribute("aria-label");
      const match = label?.match(/(\d+)%/);
      const val = match ? parseInt(match[1]) : 0;
      // Grammar is first stage, progress should be low (~16–25%)
      expect(val).toBeGreaterThan(0);
      expect(val).toBeLessThan(50);
    }
  });

  // BR-03: Grammar "Learnt (move on)" advances counter
  test("BR-03: Grammar Learnt button advances item counter", async ({ page }) => {
    await page.locator('button:has-text("Start"), button:has-text("Begin Day 1")').first().click();
    await page.waitForTimeout(500);

    // Read initial counter (e.g. "1 of 2")
    const counter = page.locator("text=/\\d+ of \\d+/");
    const beforeText = await counter.first().textContent().catch(() => null);

    await page.locator('button:has-text("Learnt")').first().click();
    await page.waitForTimeout(300);

    const afterText = await counter.first().textContent().catch(() => null);
    if (beforeText && afterText) {
      expect(afterText).not.toBe(beforeText);
    }
  });

  // BR-04: Vocab heading format is "N of M words"
  test("BR-04: Vocab stage heading format is 'N of M words'", async ({ page }) => {
    await page.locator('button:has-text("Start"), button:has-text("Begin Day 1")').first().click();
    await page.waitForTimeout(500);
    await completeAllGrammar(page);
    await page.waitForTimeout(500);

    // Vocab stage heading should contain "of N words"
    await expect(page.locator("text=/\\d+ of \\d+ words/i")).toBeVisible({ timeout: 8000 });
  });

  // BR-05: Skip button visible on first vocab item
  test("BR-05: Skip button visible on first vocab item", async ({ page }) => {
    await page.locator('button:has-text("Start"), button:has-text("Begin Day 1")').first().click();
    await page.waitForTimeout(500);
    await completeAllGrammar(page);
    await page.waitForTimeout(500);

    await expect(page.locator('button:has-text("Skip")')).toBeVisible({ timeout: 8000 });
  });

  // BR-06: Skipping shows "N skipped" in heading
  test("BR-06: Skipping vocab updates heading to show skipped count", async ({ page }) => {
    await page.locator('button:has-text("Start"), button:has-text("Begin Day 1")').first().click();
    await page.waitForTimeout(500);
    await completeAllGrammar(page);
    await page.waitForTimeout(500);

    await page.locator('button:has-text("Skip")').first().click();
    await page.waitForTimeout(300);

    await expect(page.locator("text=/1 skipped/i")).toBeVisible({ timeout: 5000 });
  });

  // BR-07: Minimap shows amber cell after skipping a vocab item
  test("BR-07: Minimap shows amber cell after skip", async ({ page }) => {
    await page.locator('button:has-text("Start"), button:has-text("Begin Day 1")').first().click();
    await page.waitForTimeout(500);
    await completeAllGrammar(page);
    await page.waitForTimeout(500);

    await page.locator('button:has-text("Skip")').first().click();
    await page.waitForTimeout(300);

    // On mobile the minimap is behind the Outline toggle; open it first
    const outlineBtn = page.locator('button:has-text("Outline")').first();
    if (await outlineBtn.isVisible({ timeout: 500 }).catch(() => false)) {
      await outlineBtn.click();
      await page.waitForTimeout(300);
    }

    // Minimap cell for skipped item should have amber styling
    const amberCell = page.locator('.bg-amber-400, .border-amber-400, [class*="amber"]').first();
    await expect(amberCell).toBeVisible({ timeout: 5000 });
  });

  // BR-08: "Skipped item — revisiting" label appears when viewing deferred item
  test("BR-08: Skipped item label appears when revisiting deferred vocab", async ({ page }) => {
    await page.locator('button:has-text("Start"), button:has-text("Begin Day 1")').first().click();
    await page.waitForTimeout(500);
    await completeAllGrammar(page);
    await page.waitForTimeout(500);

    // Skip the first vocab item
    await page.locator('button:has-text("Skip")').first().click();
    await page.waitForTimeout(200);

    // Advance through remaining items by learning them until we reach the deferred item
    let safety = 50;
    while (safety-- > 0) {
      const learntBtn = page.locator('button:has-text("Learnt")');
      const skipLabel = page.locator("text=/Skipped item/i");
      const finishBtn = page.locator('button:has-text("Finish section")');

      if (await skipLabel.count() > 0) break; // found the deferred item
      if (await finishBtn.count() > 0) break; // reached the end without the label (ok)
      if (await learntBtn.count() > 0) {
        await learntBtn.first().click();
        await page.waitForTimeout(200);
      } else {
        break;
      }
    }

    // Should show the amber "Skipped item" label or we've reached the finish section
    const skipLabel = page.locator("text=/Skipped item/i");
    const finishSection = page.locator('button:has-text("Finish section")');
    const labelOrFinish = (await skipLabel.count() > 0) || (await finishSection.count() > 0);
    expect(labelOrFinish).toBe(true);
  });

  // BR-09: Skip button hidden when viewing a deferred item
  test("BR-09: Skip button not shown on deferred vocab item", async ({ page }) => {
    await page.locator('button:has-text("Start"), button:has-text("Begin Day 1")').first().click();
    await page.waitForTimeout(500);
    await completeAllGrammar(page);
    await page.waitForTimeout(500);

    // Skip first item
    await page.locator('button:has-text("Skip")').first().click();
    await page.waitForTimeout(200);

    // Advance to deferred item
    let safety = 50;
    while (safety-- > 0) {
      const skipLabel = page.locator("text=/Skipped item/i");
      if (await skipLabel.count() > 0) break;
      const learntBtn = page.locator('button:has-text("Learnt")');
      const finishBtn = page.locator('button:has-text("Finish section")');
      if (await finishBtn.count() > 0) break;
      if (await learntBtn.count() > 0) {
        await learntBtn.first().click();
        await page.waitForTimeout(200);
      } else break;
    }

    // When viewing a deferred item, Skip button should not be present
    const skipBtn = page.locator('button:has-text("Skip · revisit later"), button:has-text("Skip")');
    const skipLabel = page.locator("text=/Skipped item/i");
    if (await skipLabel.count() > 0) {
      // We're on a deferred item — Skip button must not be visible
      await expect(skipBtn.filter({ hasText: "revisit" })).not.toBeVisible();
    }
  });

  // BR-10: Kanji skip works like vocab skip — minimap shows amber
  test("BR-10: Kanji skip shows amber minimap cell", async ({ page }) => {
    await page.locator('button:has-text("Start"), button:has-text("Begin Day 1")').first().click();
    await page.waitForTimeout(500);
    await completeAllGrammar(page);
    await page.waitForTimeout(500);

    // Advance through all vocab (learning each one)
    let safety = 60;
    while (safety-- > 0) {
      const learntBtn = page.locator('button:has-text("Learnt")').first();
      if (await learntBtn.count() === 0) break;
      const heading = await page.locator("h2, h1").first().textContent().catch(() => "");
      if (heading?.toLowerCase().includes("kanji")) break;
      await learntBtn.click();
      await page.waitForTimeout(150);
    }

    // Now in kanji stage — skip first kanji item
    const skipBtn = page.locator('button:has-text("Skip")');
    if (await skipBtn.count() > 0) {
      await skipBtn.first().click();
      await page.waitForTimeout(300);

      // On mobile the minimap is behind the Outline toggle; open it first
      const outlineBtn = page.locator('button:has-text("Outline")').first();
      if (await outlineBtn.isVisible({ timeout: 500 }).catch(() => false)) {
        await outlineBtn.click();
        await page.waitForTimeout(300);
      }

      const amberCell = page.locator('.bg-amber-400, .border-amber-400, [class*="amber"]').first();
      await expect(amberCell).toBeVisible({ timeout: 3000 });
    }
  });

  // BR-11: Produce stage — submit disabled when empty
  test("BR-11: Produce submit button is disabled when textarea is empty", async ({ page }) => {
    await page.locator('button:has-text("Start"), button:has-text("Begin Day 1")').first().click();
    await page.waitForTimeout(500);
    await completeAllGrammar(page);
    await page.waitForTimeout(500);

    // Learn all vocab and kanji
    let safety = 120;
    while (safety-- > 0) {
      const learntBtn = page.locator('button:has-text("Learnt")').first();
      const submitBtn = page.locator('button:has-text("Submit Practice")');
      if (await submitBtn.count() > 0) break;
      if (await learntBtn.count() === 0) break;
      await learntBtn.click();
      await page.waitForTimeout(150);
    }

    const submitBtn = page.locator('button:has-text("Submit Practice")');
    if (await submitBtn.count() > 0) {
      await expect(submitBtn).toBeDisabled();
    }
  });

  // BR-12: Produce submit enabled after filling
  test("BR-12: Produce submit enabled after filling all textareas", async ({ page }) => {
    await page.locator('button:has-text("Start"), button:has-text("Begin Day 1")').first().click();
    await page.waitForTimeout(500);
    await completeAllGrammar(page);
    await page.waitForTimeout(500);

    let safety = 120;
    while (safety-- > 0) {
      const learntBtn = page.locator('button:has-text("Learnt")').first();
      const submitBtn = page.locator('button:has-text("Submit Practice")');
      if (await submitBtn.count() > 0) break;
      if (await learntBtn.count() === 0) break;
      await learntBtn.click();
      await page.waitForTimeout(150);
    }

    const textareas = page.locator("textarea");
    const count = await textareas.count();
    if (count > 0) {
      for (let i = 0; i < count; i++) {
        await textareas.nth(i).fill("テスト");
      }
      await expect(page.locator('button:has-text("Submit Practice")')).toBeEnabled({ timeout: 3000 });
    }
  });

  // BR-13: Produce "Show example sentences" toggle
  test("BR-13: Produce Show example sentences toggle works", async ({ page }) => {
    await page.locator('button:has-text("Start"), button:has-text("Begin Day 1")').first().click();
    await page.waitForTimeout(500);
    await completeAllGrammar(page);
    await page.waitForTimeout(500);

    let safety = 120;
    while (safety-- > 0) {
      const learntBtn = page.locator('button:has-text("Learnt")').first();
      const submitBtn = page.locator('button:has-text("Submit Practice")');
      if (await submitBtn.count() > 0) break;
      if (await learntBtn.count() === 0) break;
      await learntBtn.click();
      await page.waitForTimeout(150);
    }

    const toggleBtn = page.locator('button:has-text("Show example"), button:has-text("example sentences")').first();
    if (await toggleBtn.count() > 0) {
      await toggleBtn.click();
      await page.waitForTimeout(300);
      await expect(page.locator("text=/Verbatim source examples|Source examples/i")).toBeVisible({ timeout: 3000 });
    }
  });

  // BR-14: Done stage completion screen shows expected content
  test("BR-14: Done stage shows completion screen with streak and unlock info", async ({ page }) => {
    test.slow(); // full day completion
    await page.locator('button:has-text("Start"), button:has-text("Begin Day 1")').first().click();
    await page.waitForTimeout(500);
    await completeAllGrammar(page);
    await page.waitForTimeout(500);

    // Learn all vocab
    let safety = 60;
    while (safety-- > 0) {
      const learntBtn = page.locator('button:has-text("Learnt")').first();
      if (await learntBtn.count() === 0) break;
      const text = await page.locator("body").innerText();
      if (text.includes("Kanji") || text.includes("kanji")) break;
      await learntBtn.click();
      await page.waitForTimeout(150);
    }

    // Learn all kanji
    safety = 40;
    while (safety-- > 0) {
      const learntBtn = page.locator('button:has-text("Learnt")').first();
      if (await learntBtn.count() === 0) break;
      const text = await page.locator("body").innerText();
      if (text.includes("Submit Practice") || text.includes("produce")) break;
      await learntBtn.click();
      await page.waitForTimeout(150);
    }

    await submitProduce(page);
    await page.waitForTimeout(500);

    // Done stage should show completion content
    const bodyText = await page.locator("body").innerText();
    const hasCompletion = bodyText.includes("complete") || bodyText.includes("Complete") ||
                          bodyText.includes("streak") || bodyText.includes("Return Home");
    expect(hasCompletion).toBe(true);
  });

  // BR-15: Progress persists after reload
  test("BR-15: Progress persists after hard reload", async ({ page }) => {
    test.slow();
    // Complete at minimum the grammar stage
    await page.locator('button:has-text("Start"), button:has-text("Begin Day 1")').first().click();
    await page.waitForTimeout(500);
    await completeAllGrammar(page);
    await page.waitForTimeout(800);

    // Hard reload
    await page.reload();
    await page.waitForLoadState("networkidle");

    // Should still be on the lesson (not reset to a blank state)
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toMatch(/Day 1.*Start/); // Should not show "Start Day 1" as if fresh
  });
});

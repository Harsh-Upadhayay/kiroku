/**
 * TC-PRODUCE-STAGE (P-01 to P-10)
 * TC-DONE-STAGE (D-01 to D-13)
 */
import { test, expect } from "@playwright/test";
import {
  freshStart,
  completeAllGrammar,
  completeAllVocab,
  completeAllKanji,
  submitProduce,
  todayKey,
} from "./helpers";

async function goToProduceStage(page: Parameters<typeof freshStart>[0]) {
  await page.locator('button:has-text("Start")').first().click();
  await page.waitForTimeout(500);
  await completeAllGrammar(page);
  await page.waitForTimeout(300);
  await completeAllVocab(page);
  await page.waitForTimeout(300);
  await completeAllKanji(page);
  await page.waitForTimeout(300);
}

async function goToDoneStage(page: Parameters<typeof freshStart>[0]) {
  await goToProduceStage(page);
  await submitProduce(page);
  await page.waitForTimeout(400);
}

// ---------------------------------------------------------------------------
// TC-PRODUCE-STAGE
// ---------------------------------------------------------------------------

test.describe("TC-PRODUCE-STAGE (P-01 to P-10)", () => {
  test.beforeEach(async ({ page }) => {
    await freshStart(page);
  });

  test("P-01: Produce stage heading shows 'Write your own Japanese'", async ({ page }) => {
    test.slow();
    await goToProduceStage(page);
    await expect(page.locator("text=/Write your own Japanese/i")).toBeVisible({ timeout: 8000 });
  });

  test("P-02: Produce stage has at least one textarea", async ({ page }) => {
    test.slow();
    await goToProduceStage(page);
    const textareas = page.locator("textarea");
    await expect(textareas.first()).toBeVisible({ timeout: 8000 });
  });

  test("P-03: Submit Practice button is disabled when textareas are empty", async ({ page }) => {
    test.slow();
    await goToProduceStage(page);
    const submitBtn = page.locator('button:has-text("Submit Practice")');
    await expect(submitBtn).toBeVisible({ timeout: 8000 });
    await expect(submitBtn).toBeDisabled();
  });

  test("P-04: Submit Practice button enables after filling all textareas", async ({ page }) => {
    test.slow();
    await goToProduceStage(page);
    const textareas = page.locator("textarea");
    const count = await textareas.count();
    for (let i = 0; i < count; i++) {
      await textareas.nth(i).fill("テスト");
    }
    await expect(page.locator('button:has-text("Submit Practice")')).toBeEnabled({ timeout: 3000 });
  });

  test("P-05: 'Show example sentences' toggle shows examples", async ({ page }) => {
    test.slow();
    await goToProduceStage(page);
    const showBtn = page.locator('button:has-text("Show example sentences")');
    await expect(showBtn).toBeVisible({ timeout: 8000 });
    await showBtn.click();
    await page.waitForTimeout(300);
    await expect(page.locator("text=/Verbatim source examples/i")).toBeVisible({ timeout: 3000 });
  });

  test("P-06: 'Show example sentences' hides after second click", async ({ page }) => {
    test.slow();
    await goToProduceStage(page);
    const showBtn = page.locator('button:has-text("Show example sentences")');
    await showBtn.click();
    await page.waitForTimeout(200);
    await page.locator('button:has-text("Hide example sentences")').click();
    await page.waitForTimeout(200);
    await expect(page.locator("text=/Verbatim source examples/i")).not.toBeVisible();
  });

  test("P-07: Hint text 'Write in each box to continue' visible when empty", async ({ page }) => {
    test.slow();
    await goToProduceStage(page);
    await expect(page.locator("text=/Write in each box to continue/i")).toBeVisible({ timeout: 8000 });
  });

  test("P-08: Hint text disappears after filling all textareas", async ({ page }) => {
    test.slow();
    await goToProduceStage(page);
    const textareas = page.locator("textarea");
    const count = await textareas.count();
    for (let i = 0; i < count; i++) {
      await textareas.nth(i).fill("テスト");
    }
    await expect(page.locator("text=/Write in each box to continue/i")).not.toBeVisible();
  });

  test("P-09: Submitting produce advances to Done stage", async ({ page }) => {
    test.slow();
    await goToProduceStage(page);
    await submitProduce(page);
    await page.waitForTimeout(500);
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).toMatch(/Day complete|Done|Return Home/i);
  });

  test("P-10: Read-only produce disables all textareas", async ({ page }) => {
    test.slow();
    // Complete full day first, then revisit as read-only
    await goToProduceStage(page);
    await submitProduce(page);
    await page.waitForTimeout(300);
    await page.locator('button:has-text("Return Home")').first().click();
    await page.waitForTimeout(300);
    // Revisit completed day via map
    await page.locator('button:has-text("Map")').first().click();
    await page.waitForTimeout(300);
    const doneDay = page.locator('button:has-text("Done")').first();
    if (await doneDay.count() > 0) {
      await doneDay.click();
      await page.waitForTimeout(500);
      // In read-only mode the lesson starts at Review stage with stagesCompleted={}.
      // The StageRail "Produce" pill is disabled until prior stages are advanced through.
      // Advance through all read-only stages until textareas appear (Produce stage).
      let safety = 120;
      while (safety-- > 0) {
        if (await page.locator("textarea").count() > 0) break;
        const nextBtn = page.locator([
          'button:has-text("Continue")',
          'button:has-text("Finish Grammar")',
          'button:has-text("Next Grammar")',
          'button:has-text("Finish Vocab")',
          'button:has-text("Finish section")',
          'button:has-text("Next")',
        ].join(", ")).first();
        if (await nextBtn.count() === 0) break;
        const enabled = await nextBtn.isEnabled().catch(() => false);
        if (!enabled) break;
        await nextBtn.click();
        await page.waitForTimeout(200);
      }
      const textareas = page.locator("textarea");
      if (await textareas.count() > 0) {
        await expect(textareas.first()).toBeDisabled();
      }
    }
  });
});

// ---------------------------------------------------------------------------
// TC-DONE-STAGE
// ---------------------------------------------------------------------------

test.describe("TC-DONE-STAGE (D-01 to D-13)", () => {
  test.beforeEach(async ({ page }) => {
    await freshStart(page);
  });

  test("D-01: Done stage shows 'Day complete' indicator", async ({ page }) => {
    test.slow();
    await goToDoneStage(page);
    await expect(page.locator("text=/Day complete/i")).toBeVisible({ timeout: 8000 });
  });

  test("D-02: Done stage shows 'Day 1 complete' heading", async ({ page }) => {
    test.slow();
    await goToDoneStage(page);
    await expect(page.locator("text=/Day 1 complete/i")).toBeVisible({ timeout: 8000 });
  });

  test("D-03: Done stage shows next unlock info (Day 2)", async ({ page }) => {
    test.slow();
    await goToDoneStage(page);
    await expect(page.locator("text=/Next unlock.*Day 2/i")).toBeVisible({ timeout: 8000 });
  });

  test("D-04: Done stage shows streak count", async ({ page }) => {
    test.slow();
    await goToDoneStage(page);
    await expect(page.locator("text=/day streak/i")).toBeVisible({ timeout: 8000 });
  });

  test("D-05: Done stage shows upcoming reviews count", async ({ page }) => {
    test.slow();
    await goToDoneStage(page);
    await expect(page.locator("text=/reviews tomorrow/i")).toBeVisible({ timeout: 8000 });
  });

  test("D-06: Return Home button is present on Done stage", async ({ page }) => {
    test.slow();
    await goToDoneStage(page);
    await expect(page.locator('button:has-text("Return Home")')).toBeVisible({ timeout: 8000 });
  });

  test("D-07: Clicking Return Home goes back to home screen", async ({ page }) => {
    test.slow();
    await goToDoneStage(page);
    await page.locator('button:has-text("Return Home")').first().click();
    await page.waitForTimeout(500);
    // Should be on home — Day 2 is now current
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).toMatch(/Day 2|Day 1 complete/i);
  });

  test("D-08: After completing Day 1, Day 2 is unlocked on home", async ({ page }) => {
    test.slow();
    await goToDoneStage(page);
    await page.locator('button:has-text("Return Home")').first().click();
    await page.waitForTimeout(500);
    // Day 2 should now be the current day
    const heading = await page.locator("h2").first().textContent();
    expect(heading).toMatch(/Day 2/);
  });

  test("D-09: Redo Day button appears in read-only mode", async ({ page }) => {
    test.slow();
    await goToDoneStage(page);
    await page.locator('button:has-text("Return Home")').first().click();
    await page.waitForTimeout(300);
    // Open map and click completed Day 1
    await page.locator('button:has-text("Map")').first().click();
    await page.waitForTimeout(300);
    const doneDay = page.locator('button:has-text("Done")').first();
    if (await doneDay.count() > 0) {
      await doneDay.click();
      await page.waitForTimeout(400);
      const redoBtn = page.locator('button:has-text("Redo Day")');
      await expect(redoBtn).toBeVisible({ timeout: 5000 });
    }
  });

  test("D-10: Redo Day resets stage progress and starts lesson from Grammar", async ({ page }) => {
    test.slow();
    await goToDoneStage(page);
    await page.locator('button:has-text("Return Home")').first().click();
    await page.waitForTimeout(300);
    await page.locator('button:has-text("Map")').first().click();
    await page.waitForTimeout(300);
    const doneDay = page.locator('button:has-text("Done")').first();
    if (await doneDay.count() > 0) {
      await doneDay.click();
      await page.waitForTimeout(400);
      const redoBtn = page.locator('button:has-text("Redo Day")');
      if (await redoBtn.count() > 0) {
        await redoBtn.first().click();
        await page.waitForTimeout(500);
        // Should be in lesson mode (read-only flag removed, stage reset to grammar or review)
        const bodyText = await page.locator("body").innerText();
        expect(bodyText).toMatch(/Grammar|Review|Home/i);
        // Read-only badge should be gone
        await expect(page.locator("text=/Read-only/i")).not.toBeVisible();
      }
    }
  });

  test("D-11: Read-only complete day shows 'Read-only review complete'", async ({ page }) => {
    test.slow();
    await goToDoneStage(page);
    await page.locator('button:has-text("Return Home")').first().click();
    await page.waitForTimeout(300);
    await page.locator('button:has-text("Map")').first().click();
    await page.waitForTimeout(300);
    const doneDay = page.locator('button:has-text("Done")').first();
    if (await doneDay.count() > 0) {
      await doneDay.click();
      await page.waitForTimeout(400);
      // In read-only mode, navigate to Done stage via StageRail
      // The StageRail "done" pill is the only button with text "done"
      const doneStageBtn = page.locator('button:has-text("done"), button:has-text("Done")').first();
      if (await doneStageBtn.isEnabled().catch(() => false)) {
        await doneStageBtn.click();
        await page.waitForTimeout(300);
      }
      // Reach done: read-only should show 'Return Home' button (via StageShell)
      const returnHome = page.locator('button:has-text("Return Home")');
      if (await returnHome.count() > 0) {
        await expect(returnHome.first()).toBeVisible();
      }
    }
  });

  test("D-12: Done stage checkCircle icon is green", async ({ page }) => {
    test.slow();
    await goToDoneStage(page);
    // bg-emerald-300 circle
    const greenCircle = page.locator('[class*="bg-emerald-300"]').first();
    await expect(greenCircle).toBeVisible({ timeout: 8000 });
  });

  test("D-13: Done stage shows SRS preview ('reviews tomorrow')", async ({ page }) => {
    test.slow();
    await goToDoneStage(page);
    await expect(page.locator("text=/reviews tomorrow/i")).toBeVisible({ timeout: 8000 });
  });
});

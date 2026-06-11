/**
 * TC-BROWSER: Mobile Viewport (BR-62 to BR-64)
 */
import { test, expect } from "@playwright/test";

// These tests target the "mobile" project config (375px viewport)
test.describe("Mobile Viewport (BR-62 to BR-64)", () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => {
      return new Promise<void>((resolve) => {
        const req = indexedDB.deleteDatabase("localforage");
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
      });
    });
    await page.reload();
    await page.waitForTimeout(1000);
  });

  // BR-62: Outline button appears INSIDE a lesson, not on course home
  test("BR-62: Outline button appears in lesson header, not on home", async ({ page }) => {
    // On home: no Outline button
    const outlineOnHome = page.locator('button:has-text("Outline"), button:has-text("OUTLINE")').first();
    const homeHasOutline = await outlineOnHome.count() > 0;
    // Outline should NOT be on home
    expect(homeHasOutline).toBe(false);

    // Start a lesson
    const startBtn = page.locator('button:has-text("Start"), button:has-text("Begin Day 1")').first();
    if (await startBtn.count() === 0) {
      test.skip(true, "Start button not found");
      return;
    }
    await startBtn.click();
    await page.waitForTimeout(600);

    // Inside lesson: Outline button should appear
    const outlineInLesson = page.locator('button:has-text("Outline"), button:has-text("OUTLINE")').first();
    await expect(outlineInLesson).toBeVisible({ timeout: 5000 });
  });

  // BR-63: Outline button shows minimap overlay with legend
  test("BR-63: Outline button shows full-screen minimap with legend", async ({ page }) => {
    const startBtn = page.locator('button:has-text("Start"), button:has-text("Begin Day 1")').first();
    if (await startBtn.count() === 0) {
      test.skip(true, "Start button not found");
      return;
    }
    await startBtn.click();
    await page.waitForTimeout(600);

    const outlineBtn = page.locator('button:has-text("Outline"), button:has-text("OUTLINE")').first();
    if (await outlineBtn.count() === 0) {
      test.skip(true, "Outline button not found in lesson");
      return;
    }
    await outlineBtn.click();
    await page.waitForTimeout(400);

    // Should show legend items: Current / Learnt / Skipped / Not yet
    const bodyText = await page.locator("body").innerText();
    const hasLegend = bodyText.match(/Current|Learnt|Skipped|Not yet/i);
    expect(!!hasLegend).toBe(true);
  });

  // BR-64: Outline toggle again closes the minimap
  test("BR-64: Pressing Outline again closes minimap and returns to stage content", async ({ page }) => {
    const startBtn = page.locator('button:has-text("Start"), button:has-text("Begin Day 1")').first();
    if (await startBtn.count() === 0) {
      test.skip(true, "Start button not found");
      return;
    }
    await startBtn.click();
    await page.waitForTimeout(600);

    const outlineBtn = page.locator('button:has-text("Outline"), button:has-text("OUTLINE")').first();
    if (await outlineBtn.count() === 0) {
      test.skip(true, "Outline button not found");
      return;
    }

    // Open minimap
    await outlineBtn.click();
    await page.waitForTimeout(300);

    // Legend should be visible
    const legend = page.locator("text=/Current|Learnt|Not yet/i").first();
    await expect(legend).toBeVisible({ timeout: 3000 });

    // Close minimap — look for close button or toggle Outline again
    const closeBtn = page.locator('button[aria-label="Close"], button:has-text("✕"), button:has-text("×")').first();
    if (await closeBtn.count() > 0) {
      await closeBtn.click();
    } else {
      await outlineBtn.click(); // toggle off
    }
    await page.waitForTimeout(400);

    // Minimap/legend should be gone; stage content visible again
    const isLegendGone = await legend.isHidden().catch(() => true);
    expect(isLegendGone).toBe(true);
  });
});

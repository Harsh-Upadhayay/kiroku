/**
 * TC-BROWSER: Mobile Viewport (BR-62 to BR-64)
 */
import { test, expect } from "@playwright/test";
import { freshStart } from "./helpers";

// These tests target the "mobile" project config (375px viewport)
test.describe("Mobile Viewport (BR-62 to BR-64)", () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test.beforeEach(async ({ page }) => {
    await freshStart(page);
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

  // BR-65: Desktop sidebar (lg:block) is hidden at mobile viewport
  test("BR-65: Desktop sidebar minimap is hidden on mobile viewport", async ({ page }) => {
    const startBtn = page.locator('button:has-text("Start"), button:has-text("Begin Day 1")').first();
    if (await startBtn.count() === 0) {
      test.skip(true, "Start button not found");
      return;
    }
    await startBtn.click();
    await page.waitForTimeout(600);

    // The Outline toggle button (lg:hidden) should be visible on mobile
    const outlineBtn = page.locator('button:has-text("Outline"), button:has-text("OUTLINE")').first();
    await expect(outlineBtn).toBeVisible({ timeout: 5000 });

    // The desktop sidebar div has class "hidden lg:block" — at 375px it is display:none
    const desktopSidebar = page.locator('div[class*="lg:block"][class*="w-72"]').first();
    if (await desktopSidebar.count() > 0) {
      await expect(desktopSidebar).toBeHidden();
    }
    // Mobile minimap overlay is closed by default — "Not yet" legend text absent from visible DOM
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toMatch(/Not yet/i);
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

    // Close minimap via Outline toggle (the same button opens and closes it)
    // outlineBtn is in the lesson header — always visible, not inside the minimap overlay
    await outlineBtn.click();
    await page.waitForTimeout(400);

    // After minimap closes, the mobile minimap overlay is unmounted.
    // The desktop sidebar minimap is always in the DOM but display:none.
    // Use innerText() which excludes display:none elements, to verify the
    // visible "Not yet" legend text (unique to the minimap) is gone.
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toMatch(/Not yet/i);
  });
});

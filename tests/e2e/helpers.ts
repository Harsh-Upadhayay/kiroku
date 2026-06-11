import { type Page, expect } from "@playwright/test";

/** Navigate to N5 course and wipe local DB so each test starts fresh. */
export async function freshStart(page: Page) {
  await page.goto("/");
  // Clear IndexedDB/localForage so every test starts with a clean slate
  await page.evaluate(() => {
    return new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase("localforage");
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    });
  });
  await page.reload();
  await page.waitForSelector('[data-testid="n5-course-home"], .n5-home, text=Day 1', { timeout: 10_000 });
}

/** Dismiss any "app update" / reload banners that may appear. */
export async function dismissBanners(page: Page) {
  const dismiss = page.locator('button:has-text("Dismiss"), button:has-text("Later"), button:has-text("×")');
  if (await dismiss.count() > 0) {
    await dismiss.first().click().catch(() => {});
  }
}

/** Open the N5 course home (assumes app is already loaded). */
export async function openN5Home(page: Page) {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await dismissBanners(page);
}

/** Click the primary "Start" / lesson button for the current day. */
export async function startCurrentDay(page: Page) {
  const startBtn = page.locator('button:has-text("Start"), button:has-text("Continue")').first();
  await startBtn.click();
  await page.waitForLoadState("networkidle");
}

/** Complete all grammar items on the current grammar stage. */
export async function completeAllGrammar(page: Page) {
  let safety = 30;
  while (safety-- > 0) {
    const learntBtn = page.locator('button:has-text("Learnt"), button:has-text("Next Grammar"), button:has-text("Finish Grammar")');
    if (await learntBtn.count() === 0) break;
    await learntBtn.first().click();
    await page.waitForTimeout(200);
    // Stop once we left grammar stage
    const stageText = await page.locator("h2, h1").first().textContent().catch(() => "");
    if (stageText?.toLowerCase().includes("vocab") || stageText?.toLowerCase().includes("word")) break;
  }
}

/** Complete all vocab items (learn each one). */
export async function completeAllVocab(page: Page) {
  let safety = 60;
  while (safety-- > 0) {
    const btn = page.locator('button:has-text("Learnt"), button:has-text("Continue"), button:has-text("Next")').first();
    if (await btn.count() === 0) break;
    const txt = await btn.textContent();
    await btn.click();
    await page.waitForTimeout(150);
    const heading = await page.locator("h2, h1").first().textContent().catch(() => "");
    if (heading?.toLowerCase().includes("kanji") || heading?.toLowerCase().includes("produce")) break;
  }
}

/** Complete all kanji items. */
export async function completeAllKanji(page: Page) {
  let safety = 40;
  while (safety-- > 0) {
    const btn = page.locator('button:has-text("Learnt"), button:has-text("Continue"), button:has-text("Next")').first();
    if (await btn.count() === 0) break;
    await btn.click();
    await page.waitForTimeout(150);
    const heading = await page.locator("h2, h1").first().textContent().catch(() => "");
    if (heading?.toLowerCase().includes("produce") || heading?.toLowerCase().includes("done")) break;
  }
}

/** Fill all produce textareas and submit. */
export async function submitProduce(page: Page) {
  const textareas = page.locator("textarea");
  const count = await textareas.count();
  for (let i = 0; i < count; i++) {
    await textareas.nth(i).fill("テスト");
  }
  await page.locator('button:has-text("Submit Practice")').click();
  await page.waitForTimeout(300);
}

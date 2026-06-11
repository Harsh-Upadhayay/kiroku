import { type Page, expect } from "@playwright/test";

const APP_DB = "hiragana_flow_pwa_db";
const DB_VERSION = 3;

/** Open the app's IndexedDB and return a handle. */
async function openAppDB(page: Page): Promise<void> {
  // no-op placeholder; all DB ops use page.evaluate
}

/** Navigate to N5 course and wipe ALL app state so every test starts truly fresh. */
export async function freshStart(page: Page) {
  // Load the app first (we need to be on the app's origin to access its IndexedDB).
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  // Clear every object store in the app's database from within the app's origin.
  // We open our own connection (multiple connections to the same version are fine).
  await page.evaluate(async (dbName) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(dbName);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const storeNames = Array.from(db.objectStoreNames) as string[];
    if (storeNames.length > 0) {
      const tx = db.transaction(storeNames, "readwrite");
      for (const name of storeNames) {
        tx.objectStore(name).clear();
      }
      await new Promise<void>((resolve) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    }
    db.close();
    localStorage.clear();
    sessionStorage.clear();
  }, APP_DB);

  // Reload so the app initialises from the now-empty stores.
  await page.reload();
  await page.waitForFunction(
    () => document.body.innerText.includes("Day 1"),
    undefined,
    { timeout: 20_000 },
  );
}

/**
 * Seed N5 progress and SRS cards directly into IndexedDB.
 * Call AFTER freshStart and page.goto but BEFORE the reload that the app reads from.
 */
export async function seedN5State(
  page: Page,
  progress: Record<string, unknown>,
  cards: unknown[] = [],
) {
  await page.evaluate(
    async ({ dbName, dbVersion, progress, cards }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(dbName, dbVersion);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        req.onupgradeneeded = (e) => {
          const db = (e.target as IDBOpenDBRequest).result;
          if (!db.objectStoreNames.contains("settings")) {
            db.createObjectStore("settings", { keyPath: "key" });
          }
          if (!db.objectStoreNames.contains("cards")) {
            db.createObjectStore("cards", { keyPath: "char" });
          }
          if (!db.objectStoreNames.contains("review_actions")) {
            db.createObjectStore("review_actions", { keyPath: "id", autoIncrement: true });
          }
        };
      });
      const tx = db.transaction("settings", "readwrite");
      const store = tx.objectStore("settings");
      store.put({ key: "n5_course_progress", value: progress });
      if (cards.length) {
        store.put({ key: "n5_srs_cards", value: cards });
      }
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    },
    { dbName: APP_DB, dbVersion: DB_VERSION, progress, cards },
  );
}

/**
 * After cards have been created (by learning some items), move all n5_srs_cards
 * due-dates to the past so the review stage sees them as due immediately.
 */
export async function makeAllN5CardsDue(page: Page) {
  await page.evaluate(async (dbName) => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const req = indexedDB.open(dbName);
      req.onsuccess = () => resolve(req.result);
    });
    const tx = db.transaction("settings", "readwrite");
    const store = tx.objectStore("settings");
    const getReq = store.get("n5_srs_cards");
    await new Promise<void>((resolve) => {
      getReq.onsuccess = () => {
        const raw = getReq.result;
        const cards: unknown[] = raw?.value ?? [];
        const past = new Date(Date.now() - 7200000).toISOString(); // 2h ago
        const updated = cards.map((c: any) => ({ ...c, due: past }));
        store.put({ key: "n5_srs_cards", value: updated });
        resolve();
      };
      getReq.onerror = () => resolve();
    });
    await new Promise<void>((resolve) => { tx.oncomplete = () => resolve(); });
  }, APP_DB);
}

/** Build a minimal N5CourseProgress object with Day 1 completed. */
export function makeDay1CompletedProgress(today: string, yesterday?: string) {
  return {
    clientId: "e2e-test",
    unlockedDay: 2,
    currentDay: 2,
    completedDays: [1],
    learnedVocabIds: [],
    learnedKanjiIds: [],
    learnedGrammarIds: [],
    dayStates: {
      "1": {
        day: 1,
        stage: "done",
        grammarIndex: 0,
        vocabIndex: 0,
        kanjiIndex: 0,
        stagesCompleted: { review: true, grammar: true, vocab: true, kanji: true, produce: true, done: true },
        updatedAt: Date.now(),
      },
    },
    productionAnswers: {},
    streak: { current: 1, highest: 1, lastCompletedDate: today, updatedAt: Date.now() },
    updatedAt: Date.now(),
    dueCountTrend: [],
  };
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

/** Complete all grammar items on the current grammar stage. Stops as soon as vocab/kanji/produce appears. */
export async function completeAllGrammar(page: Page) {
  // Wait for grammar stage to appear
  await page.waitForFunction(
    () => document.body.innerText.match(/\d+ of \d+/) || document.body.innerText.match(/All caught up/i),
    undefined,
    { timeout: 10_000 },
  ).catch(() => {});

  let safety = 40;
  while (safety-- > 0) {
    // Check heading BEFORE clicking to detect if we've already transitioned.
    // Vocab h2: "X of N words", Kanji h2: "X of N kanji", Produce h2: "Write your own Japanese"
    const heading = await page.locator("h2").first().textContent().catch(() => "");
    const h2Lower = (heading ?? "").toLowerCase();
    if (h2Lower.includes("words") || h2Lower.includes("kanji") || h2Lower.includes("write your own")) break;

    const learntBtn = page.locator('button:has-text("Learnt"), button:has-text("Next Grammar"), button:has-text("Finish Grammar"), button:has-text("Continue")').first();
    if (await learntBtn.count() === 0) break;
    await learntBtn.first().click();
    await page.waitForTimeout(300);
  }
}

/** Complete all vocab items (learn each one). Stops as soon as the kanji or produce stage appears. */
export async function completeAllVocab(page: Page) {
  // Wait for vocab stage to be visible before starting
  await page.waitForFunction(
    () => document.body.innerText.match(/\d+ of \d+ words/i) || document.body.innerText.match(/No vocab listed/i),
    undefined,
    { timeout: 10_000 },
  ).catch(() => {});

  let safety = 80;
  while (safety-- > 0) {
    // Check the main content heading BEFORE clicking to detect stage transitions early.
    const heading = await page.locator("h2").first().textContent().catch(() => "");
    const h2Lower = (heading ?? "").toLowerCase();
    if (h2Lower.includes("kanji") || h2Lower.includes("produce") || h2Lower.includes("done")) break;
    if (!h2Lower.includes("word") && !h2Lower.includes("vocab") && !h2Lower.includes("no vocab")) {
      // We've left the vocab stage (heading no longer matches any vocab pattern)
      break;
    }

    const btn = page.locator('button:has-text("Learnt"), button:has-text("Continue")').first();
    if (await btn.count() === 0) break;
    await btn.click();
    await page.waitForTimeout(350);
  }
}

/** Complete all kanji items. Stops as soon as the produce stage appears. */
export async function completeAllKanji(page: Page) {
  // Wait for kanji stage to be visible before starting
  await page.waitForFunction(
    () => document.body.innerText.match(/\d+ of \d+ kanji/i) || document.body.innerText.match(/No kanji listed/i) || document.body.innerText.match(/Kanji review/i),
    undefined,
    { timeout: 10_000 },
  ).catch(() => {});

  let safety = 60;
  while (safety-- > 0) {
    const heading = await page.locator("h2").first().textContent().catch(() => "");
    const h2Lower = (heading ?? "").toLowerCase();
    if (h2Lower.includes("produce") || h2Lower.includes("done") || h2Lower.includes("write your own")) break;
    if (!h2Lower.includes("kanji") && !h2Lower.includes("no kanji") && !h2Lower.includes("kanji review")) {
      // Left kanji stage
      break;
    }

    const btn = page.locator('button:has-text("Learnt"), button:has-text("Continue")').first();
    if (await btn.count() === 0) break;
    await btn.click();
    await page.waitForTimeout(350);
  }
}

/** Fill all produce textareas and submit. */
export async function submitProduce(page: Page) {
  // Wait for the produce stage to render (textareas OR the submit button must appear)
  await page.waitForFunction(
    () => {
      const textareas = document.querySelectorAll("textarea:not([disabled])");
      const btn = Array.from(document.querySelectorAll("button")).find(
        (b) => b.textContent?.includes("Submit Practice"),
      );
      return textareas.length > 0 || btn !== undefined;
    },
    undefined,
    { timeout: 15_000 },
  ).catch(() => {});

  const textareas = page.locator("textarea");
  const count = await textareas.count();
  for (let i = 0; i < count; i++) {
    await textareas.nth(i).fill("テスト");
  }
  await page.locator('button:has-text("Submit Practice")').click();
  await page.waitForTimeout(300);
}

/** Complete a full Day 1 lesson (grammar → vocab → kanji → produce → done). */
export async function completeDay1(page: Page) {
  const startBtn = page.locator('button:has-text("Start"), button:has-text("Begin Day 1")').first();
  if (await startBtn.count() > 0) await startBtn.click();
  await page.waitForTimeout(500);
  await completeAllGrammar(page);
  await page.waitForTimeout(200);
  await completeAllVocab(page);
  await page.waitForTimeout(200);
  await completeAllKanji(page);
  await page.waitForTimeout(200);
  await submitProduce(page);
  await page.waitForTimeout(400);
}

/** Local date in YYYY-MM-DD format (mirrors app's localDateKey). */
export function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function yesterdayKey(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

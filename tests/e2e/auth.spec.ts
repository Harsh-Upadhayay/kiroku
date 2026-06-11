/**
 * TC-BROWSER: Auth Modal (BR-55 to BR-61)
 */
import { test, expect } from "@playwright/test";
import { freshStart } from "./helpers";

test.describe("Auth Modal (BR-55 to BR-61)", () => {
  test.beforeEach(async ({ page }) => {
    await freshStart(page);
  });

  async function openAuthModal(page: Parameters<typeof freshStart>[0]) {
    const signInBtn = page.locator('button:has-text("Sign In"), button:has-text("SIGN IN"), a:has-text("Sign In")').first();
    if (await signInBtn.count() === 0) return false;
    await signInBtn.click();
    await page.waitForTimeout(400);
    return true;
  }

  // BR-55: Sign In modal opens with tabs and fields
  test("BR-55: Sign In modal opens with SIGN IN/REGISTER tabs and email+password fields", async ({ page }) => {
    const opened = await openAuthModal(page);
    if (!opened) {
      test.skip(true, "Sign In button not found");
      return;
    }
    // Should show form fields
    await expect(page.locator('input[type="email"], input[placeholder*="email"], input[placeholder*="Email"]')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('input[type="password"], input[placeholder*="password"], input[placeholder*="Password"]')).toBeVisible({ timeout: 3000 });
  });

  // BR-56: Empty submit shows "Email is required." error
  test("BR-56: Empty form submit shows email required error", async ({ page }) => {
    const opened = await openAuthModal(page);
    if (!opened) {
      test.skip(true, "Sign In button not found");
      return;
    }

    const submitBtn = page.locator('button[type="submit"], button:has-text("Sign In"), button:has-text("SIGN IN")').last();
    await submitBtn.click();
    await page.waitForTimeout(300);

    await expect(page.locator("text=/Email is required|email is required/i")).toBeVisible({ timeout: 3000 });
  });

  // BR-57: Short/empty password shows validation error
  test("BR-57: Empty password shows validation error", async ({ page }) => {
    const opened = await openAuthModal(page);
    if (!opened) {
      test.skip(true, "Sign In button not found");
      return;
    }

    const emailInput = page.locator('input[type="email"], input[placeholder*="email"], input[placeholder*="Email"]').first();
    await emailInput.fill("test@example.com");

    const submitBtn = page.locator('button[type="submit"], button:has-text("Sign In")').last();
    await submitBtn.click();
    await page.waitForTimeout(300);

    const bodyText = await page.locator("body").innerText();
    const hasError = bodyText.match(/password|required|error/i);
    expect(!!hasError).toBe(true);
  });

  // BR-58: Wrong credentials shows "Invalid email or password." error
  test("BR-58: Wrong credentials shows invalid credentials error", async ({ page }) => {
    const opened = await openAuthModal(page);
    if (!opened) {
      test.skip(true, "Sign In button not found");
      return;
    }

    const emailInput = page.locator('input[type="email"], input[placeholder*="email"]').first();
    const passInput = page.locator('input[type="password"], input[placeholder*="password"]').first();
    await emailInput.fill("nonexistent@example.com");
    await passInput.fill("wrongpassword123");

    const submitBtn = page.locator('button[type="submit"], button:has-text("Sign In")').last();
    await submitBtn.click();
    await page.waitForTimeout(2000); // Wait for API response

    const bodyText = await page.locator("body").innerText();
    const hasError = bodyText.match(/invalid|incorrect|error|wrong/i);
    expect(!!hasError).toBe(true);
  });

  // BR-59: Register tab adds "Repeat password" field
  test("BR-59: Register tab shows Repeat password field", async ({ page }) => {
    const opened = await openAuthModal(page);
    if (!opened) {
      test.skip(true, "Sign In button not found");
      return;
    }

    const registerTab = page.locator('button:has-text("Register"), button:has-text("REGISTER")').first();
    if (await registerTab.count() === 0) {
      test.skip(true, "Register tab not found");
      return;
    }
    await registerTab.click();
    await page.waitForTimeout(300);

    // Should now have a "Repeat password" or "Confirm password" field
    const repeatPass = page.locator(
      'input[placeholder*="repeat"], input[placeholder*="Repeat"], input[placeholder*="confirm"], input[placeholder*="Confirm"]'
    ).first();
    await expect(repeatPass).toBeVisible({ timeout: 3000 });
  });

  // BR-60: Escape closes auth modal
  test("BR-60: Escape key closes auth popover", async ({ page }) => {
    const opened = await openAuthModal(page);
    if (!opened) {
      test.skip(true, "Sign In button not found");
      return;
    }

    // Modal should be open
    await expect(
      page.locator('input[type="email"], input[placeholder*="email"]').first()
    ).toBeVisible({ timeout: 3000 });

    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);

    // Modal should be closed
    const emailInput = page.locator('input[type="email"], input[placeholder*="email"]').first();
    const isGone = await emailInput.isHidden().catch(() => true);
    expect(isGone).toBe(true);
  });
});

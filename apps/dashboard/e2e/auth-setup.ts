/**
 * Auth setup — runs once before authenticated projects.
 * Logs in and saves storageState for reuse across all specs.
 */

import { test as setup } from "@playwright/test";
import { TEST_EMAIL, TEST_PASSWORD, TIMEOUTS, STORAGE_STATE_PATH } from "./config";

setup("authenticate and save state", async ({ page }) => {
  // Check if existing session in storage-state already grants authenticated access
  try {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const aside = page.locator("aside").first();
    if (await aside.isVisible({ timeout: 4000 }).catch(() => false)) {
      await page.context().storageState({ path: STORAGE_STATE_PATH });
      return;
    }
  } catch {
    // Continue to standard login flow
  }

  // Navigate to dashboard with explicit login mode
  await page.goto("/?mode=login", { waitUntil: "domcontentloaded" });

  // If redirected or still on signup, click "Entrar" button
  const enterBtn = page.getByRole("button", { name: "Entrar" }).first();
  if (await enterBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await enterBtn.click();
  }

  // Wait for login form
  const emailInput = page.locator("input[type='email']");
  if (await emailInput.isVisible({ timeout: 4000 }).catch(() => false)) {
    // Fill credentials
    await emailInput.fill(TEST_EMAIL);
    await page.locator("input[type='password']").fill(TEST_PASSWORD);

    // Submit
    await page.locator("button[type='submit']").click();

    // Wait for successful login — sidebar shell appears
    await page.locator("aside").waitFor({ state: "visible", timeout: TIMEOUTS.auth });
    await page.context().storageState({ path: STORAGE_STATE_PATH });
  } else {
    // If already inside or storage-state active
    await page.locator("aside").waitFor({ state: "visible", timeout: TIMEOUTS.auth });
    await page.context().storageState({ path: STORAGE_STATE_PATH });
  }
});

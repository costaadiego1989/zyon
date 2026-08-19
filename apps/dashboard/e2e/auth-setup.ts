/**
 * Auth setup — runs once before authenticated projects.
 * Logs in and saves storageState for reuse across all specs.
 */

import { test as setup } from "@playwright/test";
import { TEST_EMAIL, TEST_PASSWORD, TIMEOUTS, STORAGE_STATE_PATH } from "./config";

setup("authenticate and save state", async ({ page }) => {
  // Navigate to dashboard
  await page.goto("/", { waitUntil: "domcontentloaded" });

  // Wait for login form
  const emailInput = page.locator("input[type='email']");
  await emailInput.waitFor({ state: "visible", timeout: TIMEOUTS.auth });

  // Fill credentials
  await emailInput.fill(TEST_EMAIL);
  await page.locator("input[type='password']").fill(TEST_PASSWORD);

  // Submit
  await page.locator("button[type='submit']").click();

  // Wait for successful login — sidebar shell appears
  await page.locator("aside").waitFor({ state: "visible", timeout: TIMEOUTS.auth });

  // Save authenticated state
  await page.context().storageState({ path: STORAGE_STATE_PATH });
});

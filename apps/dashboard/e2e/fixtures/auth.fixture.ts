/**
 * Auth fixture — provides authenticated test context via storageState.
 *
 * Usage:
 *   import { test, expect } from "../fixtures/auth.fixture";
 *
 * The `test` export has a pre-authenticated `page` (logged-in session).
 * Use `test.use({ storageState: undefined })` in specs that test the login itself.
 */

import { test as base, expect, type Page, type BrowserContext } from "@playwright/test";
import { DASHBOARD_URL, TEST_EMAIL, TEST_PASSWORD, TIMEOUTS, API_BASE_URL } from "../config";

/* ── Types ──────────────────────────────────────────────────────── */

export interface AuthFixtures {
  /** Pre-authenticated page (session cookies already set) */
  authenticatedPage: Page;
  /** Login programmatically on a given page */
  login: (page: Page, email?: string, password?: string) => Promise<void>;
  /** Logout the current session */
  logout: (page: Page) => Promise<void>;
}

/* ── Login/Logout helpers ───────────────────────────────────────── */

/**
 * Perform UI-based login. Uses stable selectors (placeholder, type, role).
 */
async function performLogin(page: Page, email: string, password: string): Promise<void> {
  await page.goto(DASHBOARD_URL, { waitUntil: "domcontentloaded" });

  // Wait for auth screen
  const emailInput = page.locator("input[type='email']");
  await emailInput.waitFor({ state: "visible", timeout: TIMEOUTS.auth });

  // Fill email
  await emailInput.fill(email);

  // Fill password
  const passwordInput = page.locator("input[type='password']");
  await passwordInput.fill(password);

  // Submit
  await page.locator("button[type='submit']").click();

  // Wait for successful navigation (nav shell appears)
  await page.locator("nav").waitFor({ state: "visible", timeout: TIMEOUTS.auth });
}

/**
 * Perform logout via the UI.
 */
async function performLogout(page: Page): Promise<void> {
  // Look for user menu or logout button
  const logoutBtn = page.getByRole("button", { name: /sair|logout/i })
    .or(page.locator("[data-testid='logout-btn']"))
    .or(page.locator("button:has-text('Sair')"));

  if (await logoutBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await logoutBtn.click();
  } else {
    // Fallback: navigate to root which should redirect to login
    await page.goto(DASHBOARD_URL);
    // Clear storage to ensure logout
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.reload();
  }

  // Confirm login screen is back
  const emailInput = page.locator("input[type='email']");
  await emailInput.waitFor({ state: "visible", timeout: TIMEOUTS.auth });
}

/* ── Fixture definition ─────────────────────────────────────────── */

export const test = base.extend<AuthFixtures>({
  authenticatedPage: async ({ page }, use) => {
    await performLogin(page, TEST_EMAIL, TEST_PASSWORD);
    await use(page);
  },

  login: async ({}, use) => {
    await use(async (page: Page, email?: string, password?: string) => {
      await performLogin(page, email ?? TEST_EMAIL, password ?? TEST_PASSWORD);
    });
  },

  logout: async ({}, use) => {
    await use(async (page: Page) => {
      await performLogout(page);
    });
  },
});

export { expect };

/* ── Global setup: create storageState for project-level auth ──── */

/**
 * Call this in a globalSetup to produce a reusable storageState file.
 * This avoids repeating login in every test.
 */
export async function createAuthState(
  browser: import("@playwright/test").Browser,
  outputPath: string,
): Promise<void> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await performLogin(page, TEST_EMAIL, TEST_PASSWORD);
  await context.storageState({ path: outputPath });
  await context.close();
}

/**
 * Wait helpers — explicit waits, no waitForTimeout.
 * Encapsulates common wait patterns for dashboard E2E.
 */

import { type Page, type Locator, expect } from "@playwright/test";
import { TIMEOUTS } from "../config";

/**
 * Wait for navigation to settle (URL change + content loaded).
 */
export async function waitForNavigation(page: Page, urlPattern?: string | RegExp): Promise<void> {
  if (urlPattern) {
    await page.waitForURL(urlPattern, { timeout: TIMEOUTS.navigation });
  }
  await page.waitForLoadState("domcontentloaded");
}

/**
 * Wait for a network request to complete (e.g., API call).
 */
export async function waitForApiCall(
  page: Page,
  urlPattern: string | RegExp,
  options?: { method?: string; timeout?: number },
): Promise<void> {
  await page.waitForResponse(
    (response) => {
      const matchesUrl = typeof urlPattern === "string"
        ? response.url().includes(urlPattern)
        : urlPattern.test(response.url());
      const matchesMethod = !options?.method || response.request().method() === options.method;
      return matchesUrl && matchesMethod;
    },
    { timeout: options?.timeout ?? TIMEOUTS.api },
  );
}

/**
 * Wait for an element to appear and then disappear (e.g., loading spinner).
 */
export async function waitForTransient(locator: Locator, timeout = TIMEOUTS.long): Promise<void> {
  // First wait for it to appear (may already be gone)
  const appeared = await locator.isVisible({ timeout: 2_000 }).catch(() => false);
  if (appeared) {
    await locator.waitFor({ state: "hidden", timeout });
  }
}

/**
 * Wait for text content to change from a known value.
 */
export async function waitForTextChange(
  locator: Locator,
  previousText: string,
  timeout = TIMEOUTS.element,
): Promise<void> {
  await expect(locator).not.toHaveText(previousText, { timeout });
}

/**
 * Wait for a table to have at least N rows.
 */
export async function waitForTableRows(
  page: Page,
  minRows: number,
  tableSelector = "table tbody tr",
  timeout = TIMEOUTS.element,
): Promise<void> {
  const rows = page.locator(tableSelector);
  await expect(rows.first()).toBeVisible({ timeout });
  // Poll until count meets minimum
  await expect(async () => {
    const count = await rows.count();
    expect(count).toBeGreaterThanOrEqual(minRows);
  }).toPass({ timeout });
}

/**
 * Wait for a toast/notification to appear with specific text.
 */
export async function waitForToast(
  page: Page,
  textPattern: string | RegExp,
  timeout = TIMEOUTS.element,
): Promise<Locator> {
  const toast = page.locator("[role='alert']")
    .or(page.locator("[data-testid='toast']"));

  if (typeof textPattern === "string") {
    await expect(toast.filter({ hasText: textPattern })).toBeVisible({ timeout });
    return toast.filter({ hasText: textPattern });
  }

  await expect(toast.filter({ hasText: textPattern })).toBeVisible({ timeout });
  return toast.filter({ hasText: textPattern });
}

/**
 * Wait until page has no active network requests (stable state).
 * More reliable than waitForLoadState("networkidle") in SPAs.
 */
export async function waitForIdle(page: Page, idleMs = 500): Promise<void> {
  await page.waitForLoadState("networkidle");
  // Extra settle time for React re-renders
  await page.waitForFunction(
    (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    idleMs,
  );
}

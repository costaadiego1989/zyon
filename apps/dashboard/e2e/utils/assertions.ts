/**
 * Custom assertion helpers for dashboard E2E.
 * Wraps common multi-step checks into single calls.
 */

import { type Page, type Locator, expect } from "@playwright/test";
import { TIMEOUTS } from "../config";

/**
 * Assert that a table has the expected column headers.
 */
export async function assertTableHeaders(
  page: Page,
  expectedHeaders: string[],
  tableSelector = "table",
): Promise<void> {
  const headers = page.locator(`${tableSelector} th`);
  for (const header of expectedHeaders) {
    await expect(
      headers.filter({ hasText: header }).first(),
    ).toBeVisible({ timeout: TIMEOUTS.element });
  }
}

/**
 * Assert that a form field shows a validation error.
 */
export async function assertFieldError(
  field: Locator,
  errorText?: string | RegExp,
): Promise<void> {
  // Check for aria-invalid
  const isInvalid = await field.getAttribute("aria-invalid");
  if (isInvalid !== "true") {
    // Fallback: check sibling error message
    const errorEl = field.locator("~ .error, ~ [role='alert'], + .error");
    await expect(errorEl.first()).toBeVisible({ timeout: TIMEOUTS.element });
    if (errorText) {
      await expect(errorEl.first()).toHaveText(errorText);
    }
  }
}

/**
 * Assert page is fully authenticated (nav shell visible, no login form).
 */
export async function assertAuthenticated(page: Page): Promise<void> {
  await expect(page.locator("nav")).toBeVisible({ timeout: TIMEOUTS.auth });
  await expect(page.locator("input[type='email']")).not.toBeVisible();
}

/**
 * Assert page is NOT authenticated (login form visible).
 */
export async function assertNotAuthenticated(page: Page): Promise<void> {
  await expect(page.locator("input[type='email']")).toBeVisible({ timeout: TIMEOUTS.auth });
}

/**
 * Assert no unexpected console errors during a test.
 * Call at end of test, passing collected messages.
 */
export function assertNoUnexpectedErrors(
  messages: Array<{ type: string; text: string }>,
  allowedPatterns: RegExp[] = [],
): void {
  const defaultAllowed = [
    /favicon/i,
    /404/,
    /net::ERR_FILE_NOT_FOUND/,
    /Download the React DevTools/,
    /Cannot GET/,
  ];

  const allAllowed = [...defaultAllowed, ...allowedPatterns];
  const errors = messages.filter(
    (m) => m.type === "error" && !allAllowed.some((p) => p.test(m.text)),
  );

  expect(
    errors,
    `Unexpected console errors:\n${errors.map((e) => e.text).join("\n")}`,
  ).toHaveLength(0);
}

/**
 * Assert element has specific CSS property value.
 */
export async function assertCssProperty(
  locator: Locator,
  property: string,
  expectedValue: string | RegExp,
): Promise<void> {
  const value = await locator.evaluate(
    (el, prop) => getComputedStyle(el).getPropertyValue(prop),
    property,
  );
  if (typeof expectedValue === "string") {
    expect(value.trim()).toBe(expectedValue);
  } else {
    expect(value.trim()).toMatch(expectedValue);
  }
}

/**
 * Assert that a metric/stat card shows a numeric value.
 */
export async function assertMetricHasValue(
  locator: Locator,
  options?: { min?: number; max?: number },
): Promise<void> {
  await expect(locator).toBeVisible({ timeout: TIMEOUTS.element });
  const text = await locator.textContent();
  expect(text).toBeTruthy();

  // Extract numeric value from text (e.g., "R$ 1.234,56" → 1234.56, "34%" → 34)
  const numericStr = text!.replace(/[^\d.,]/g, "").replace(",", ".");
  const value = parseFloat(numericStr) || 0;

  if (options?.min !== undefined) {
    expect(value).toBeGreaterThanOrEqual(options.min);
  }
  if (options?.max !== undefined) {
    expect(value).toBeLessThanOrEqual(options.max);
  }
}

/**
 * Assert page viewport matches expected dimensions (for responsive tests).
 */
export async function assertViewport(
  page: Page,
  expected: { width: number; height: number },
): Promise<void> {
  const size = page.viewportSize();
  expect(size?.width).toBe(expected.width);
  expect(size?.height).toBe(expected.height);
}

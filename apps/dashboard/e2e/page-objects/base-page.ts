/**
 * Base page object — shared navigation and utility methods.
 * All page objects extend this class.
 */

import { type Page, type Locator, expect } from "@playwright/test";
import { TIMEOUTS } from "../config";
import { gotoTab } from "../utils/nav";

export abstract class BasePage {
  constructor(protected readonly page: Page) {}

  /* ── Navigation ─────────────────────────────────────────────────── */

  /** The nav sidebar/bar element */
  get nav(): Locator {
    return this.page.locator("nav");
  }

  /** Wait for the shell (nav) to be visible — indicates authenticated state */
  async waitForShell(): Promise<void> {
    await this.nav.waitFor({ state: "visible", timeout: TIMEOUTS.auth });
  }

  /** Navigate to a section by its exact sidebar item label (expands section if collapsed). */
  async navigateTo(label: string): Promise<void> {
    await gotoTab(this.page, label);
  }

  /* ── Common locators ────────────────────────────────────────────── */

  /** Page heading (h1 or main title) */
  get heading(): Locator {
    return this.page.locator("h1").first();
  }

  /** Loading spinner/skeleton */
  get loader(): Locator {
    return this.page.locator("[data-testid='loader']")
      .or(this.page.locator(".animate-pulse"))
      .or(this.page.locator("[role='progressbar']"));
  }

  /** Toast/notification messages */
  get toast(): Locator {
    return this.page.locator("[role='alert']")
      .or(this.page.locator("[data-testid='toast']"));
  }

  /* ── Assertions ─────────────────────────────────────────────────── */

  /** Assert page has no unexpected console errors */
  async assertNoConsoleErrors(consoleMessages: Array<{ type: string; text: string }>): Promise<void> {
    const errors = consoleMessages.filter(
      (m) => m.type === "error" && !this.isExpectedError(m.text),
    );
    expect(errors).toHaveLength(0);
  }

  /** Wait for loading state to resolve */
  async waitForContentLoaded(): Promise<void> {
    // Wait for any loading indicators to disappear
    const loaderVisible = await this.loader.isVisible({ timeout: 1_000 }).catch(() => false);
    if (loaderVisible) {
      await this.loader.waitFor({ state: "hidden", timeout: TIMEOUTS.long });
    }
  }

  /* ── Utilities ──────────────────────────────────────────────────── */

  /** Check if an error message is expected (e.g., favicon 404) */
  protected isExpectedError(text: string): boolean {
    const expectedPatterns = [
      /favicon/i,
      /Failed to load resource.*404/,
      /net::ERR_FILE_NOT_FOUND/,
    ];
    return expectedPatterns.some((p) => p.test(text));
  }

  /** Take a named screenshot (for debugging) */
  async screenshot(name: string): Promise<void> {
    await this.page.screenshot({ path: `test-results/screenshots/${name}.png` });
  }
}

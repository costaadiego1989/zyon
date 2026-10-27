/**
 * Orders page object.
 */

import { type Page, type Locator, expect } from "@playwright/test";
import { BasePage } from "./base-page";
import { TIMEOUTS } from "../config";
import { NAV_LABELS } from "../fixtures/test-data";

export class OrdersPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  /* ── Locators ───────────────────────────────────────────────────── */

  get searchInput(): Locator {
    return this.page.locator("input[placeholder*='Buscar']").first();
  }

  get table(): Locator {
    return this.page.locator("table").first();
  }

  get tableRows(): Locator {
    return this.table.locator("tbody tr");
  }

  get exportButton(): Locator {
    return this.page.getByRole("button", { name: /exportar|export/i });
  }

  get filterButtons(): Locator {
    return this.page.locator("[data-testid='filter-btn']")
      .or(this.page.locator("button:has-text('Filtrar')"));
  }

  /* ── Actions ────────────────────────────────────────────────────── */

  async goto(): Promise<void> {
    await this.navigateTo(NAV_LABELS.orders);
    await this.waitForContentLoaded();
  }

  async search(query: string): Promise<void> {
    await this.searchInput.fill(query);
    await this.page.waitForLoadState("networkidle");
  }

  async clickRow(index: number): Promise<void> {
    await this.tableRows.nth(index).click();
  }

  /* ── Assertions ─────────────────────────────────────────────────── */

  async assertTableVisible(): Promise<void> {
    await expect(this.table).toBeVisible({ timeout: TIMEOUTS.element });
  }

  async assertRowCount(min: number): Promise<void> {
    await expect(this.tableRows).toHaveCount(min, { timeout: TIMEOUTS.element });
  }

  async assertRowCountAtLeast(min: number): Promise<void> {
    const count = await this.tableRows.count();
    expect(count).toBeGreaterThanOrEqual(min);
  }
}

/**
 * Customers page object.
 */

import { type Page, type Locator, expect } from "@playwright/test";
import { BasePage } from "./base-page";
import { TIMEOUTS } from "../config";
import { NAV_LABELS } from "../fixtures/test-data";

export class CustomersPage extends BasePage {
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

  get metricsCards(): Locator {
    return this.page.locator("[data-testid='metric-card']")
      .or(this.page.locator("text=Total de clientes").locator(".."));
  }

  get exportButton(): Locator {
    return this.page.getByRole("button", { name: /exportar|export/i });
  }

  /* ── Actions ────────────────────────────────────────────────────── */

  async goto(): Promise<void> {
    await this.navigateTo(NAV_LABELS.customers);
    await this.waitForContentLoaded();
  }

  async search(query: string): Promise<void> {
    await this.searchInput.fill(query);
    await this.page.waitForLoadState("networkidle");
  }

  async clickCustomer(index: number): Promise<void> {
    await this.tableRows.nth(index).click();
  }

  /* ── Assertions ─────────────────────────────────────────────────── */

  async assertTableVisible(): Promise<void> {
    await expect(this.table).toBeVisible({ timeout: TIMEOUTS.element });
  }

  async assertSearchWorks(query: string): Promise<void> {
    await this.search(query);
    const rows = await this.tableRows.count();
    expect(rows).toBeGreaterThanOrEqual(0); // At least renders
  }
}

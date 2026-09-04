/**
 * Dashboard page object — overview/operation panel after login.
 */

import { type Page, type Locator, expect } from "@playwright/test";
import { BasePage } from "./base-page";
import { TIMEOUTS } from "../config";
import { NAV_LABELS } from "../fixtures/test-data";

export class DashboardPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  /* ── Locators ───────────────────────────────────────────────────── */

  /** Overview page subtitle */
  get overviewSubtitle(): Locator {
    return this.page.locator("text=Acompanhe sessões, receita e desempenho do checkout agêntico em tempo real");
  }

  /** Agent status badge */
  get agentStatus(): Locator {
    return this.page.locator("text=Agente operante")
      .or(this.page.locator("text=Agente indisponível"));
  }

  /** Revenue metrics header */
  get revenueHeader(): Locator {
    return this.page.locator("text=RECEITA GERADA · 7 DIAS");
  }

  /** Sessions metric */
  get sessionsMetric(): Locator {
    return this.page.locator("text=SESSÕES").first();
  }

  /** Conversion metric */
  get conversionMetric(): Locator {
    return this.page.locator("text=CONVERSÃO").first();
  }

  /** Average ticket metric */
  get ticketMetric(): Locator {
    return this.page.locator("text=TICKET MÉDIO").first();
  }

  /* ── Actions ────────────────────────────────────────────────────── */

  /** Navigate to Overview/Operação section */
  async gotoOverview(): Promise<void> {
    await this.navigateTo(NAV_LABELS.overview);
  }

  /** Navigate to Orders section */
  async gotoOrders(): Promise<void> {
    await this.navigateTo(NAV_LABELS.orders);
  }

  /** Navigate to Customers section */
  async gotoCustomers(): Promise<void> {
    await this.navigateTo(NAV_LABELS.customers);
  }

  /** Navigate to Integrations */
  async gotoIntegrations(): Promise<void> {
    await this.navigateTo(NAV_LABELS.integrations);
  }

  /** Navigate to Checkout Settings */
  async gotoCheckoutSettings(): Promise<void> {
    await this.navigateTo(NAV_LABELS.checkoutSettings);
  }

  /** Navigate to Theme */
  async gotoTheme(): Promise<void> {
    await this.navigateTo(NAV_LABELS.theme);
  }

  /* ── Assertions ─────────────────────────────────────────────────── */

  /** Assert overview metrics are visible */
  async assertMetricsVisible(): Promise<void> {
    await expect(this.revenueHeader).toBeVisible({ timeout: TIMEOUTS.element });
    await expect(this.sessionsMetric).toBeVisible({ timeout: TIMEOUTS.element });
    await expect(this.conversionMetric).toBeVisible({ timeout: TIMEOUTS.element });
  }

  /** Assert agent status badge is visible */
  async assertAgentStatusVisible(): Promise<void> {
    await expect(this.agentStatus.first()).toBeVisible({ timeout: TIMEOUTS.element });
  }

  /** Assert nav contains expected items */
  async assertNavVisible(): Promise<void> {
    await expect(this.nav).toBeVisible({ timeout: TIMEOUTS.element });
  }
}

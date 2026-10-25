/**
 * Integrations page object.
 */

import { type Page, type Locator, expect } from "@playwright/test";
import { BasePage } from "./base-page";
import { TIMEOUTS } from "../config";
import { NAV_LABELS } from "../fixtures/test-data";

export class IntegrationsPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  /* ── Locators ───────────────────────────────────────────────────── */

  get apiKeySection(): Locator {
    return this.page.locator("text=API Key")
      .or(this.page.locator("text=Chave de API"));
  }

  get webhookSection(): Locator {
    return this.page.locator("text=Webhook")
      .or(this.page.locator("text=Webhooks"));
  }

  get quickstartSection(): Locator {
    return this.page.locator("text=Quickstart")
      .or(this.page.locator("text=Início rápido"));
  }

  get copyButton(): Locator {
    return this.page.getByRole("button", { name: /copiar|copy/i }).first();
  }

  /* ── Actions ────────────────────────────────────────────────────── */

  async goto(): Promise<void> {
    await this.navigateTo(NAV_LABELS.integrations);
    await this.waitForContentLoaded();
  }

  /* ── Assertions ─────────────────────────────────────────────────── */

  async assertApiKeyVisible(): Promise<void> {
    await expect(this.apiKeySection).toBeVisible({ timeout: TIMEOUTS.element });
  }
}

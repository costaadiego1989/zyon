/**
 * @regression T003 — UserPanel must render merchant identity from injected session.
 *
 * When an embed session is pre-injected (via the embed bootstrap), the UserPanel
 * must display the merchant name and ID sourced from the session, not show a blank state.
 */
import { test, expect } from "@playwright/test";
import { setupApiMocks } from "../fixtures/api-mocks.js";

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173";

test("@regression UserPanel renders merchant identity from injected embed session", async ({ page }) => {
  await setupApiMocks(page, { merchantName: "Loja E2E", merchantId: "mrc_dev_seed" });
  await page.goto(BASE);
  await page.waitForSelector(".aacp-thread", { timeout: 10_000 });

  // Open user panel
  const userIcon = page.locator("[aria-label='Minha conta'], .aacp-user-btn").first();
  if (await userIcon.isVisible()) {
    await userIcon.click();
  }

  // UserPanel must show merchant name
  const panel = page.locator(".aacp-user-panel");
  await expect(panel).toBeVisible({ timeout: 5_000 });
  await expect(panel).toContainText("Loja E2E", { timeout: 3_000 });
});

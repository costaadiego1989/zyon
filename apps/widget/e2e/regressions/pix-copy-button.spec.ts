/**
 * @regression T001 — PIX copy button must be visible during payment step.
 *
 * Regression for commit aacbfc0. The "Copiar código PIX" button was invisible
 * because the mocked payment_options fixture did not include a pix_code payload.
 */
import { test, expect } from "@playwright/test";
import { setupApiMocks } from "../fixtures/api-mocks.js";

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173";

test("@regression PIX copy button is visible when pix_code present in payment step", async ({ page }) => {
  await setupApiMocks(page, { includePix: true });
  await page.goto(BASE);
  await page.waitForSelector(".aacp-thread", { timeout: 10_000 });

  // Navigate to payment step
  await page.click("[data-testid='pay-button'], .aacp-pay-btn", { timeout: 5_000 }).catch(() => null);
  await page.waitForSelector(".aacp-payment-options, [data-payment-method]", { timeout: 5_000 }).catch(() => null);

  // Select PIX if multiple options
  const pixOption = page.locator("[data-payment-method='pix'], button:has-text('PIX')").first();
  if (await pixOption.isVisible()) {
    await pixOption.click();
  }

  // Assert copy button visible
  const copyBtn = page.locator("button:has-text('Copiar código PIX'), [data-testid='pix-copy']").first();
  await expect(copyBtn).toBeVisible({ timeout: 5_000 });
});

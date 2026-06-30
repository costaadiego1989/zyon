/**
 * @regression T003 — Merchant identity from the injected session must render.
 *
 * When an embed session is pre-injected (via setupApiMocks → start-checkout
 * bootstrap), the widget must display the merchant name sourced from that
 * session rather than a blank state. The brand name surfaces in the cart
 * header (.zyon-cart-store); opening the user panel must not blank it out.
 */
import { test, expect, type Page } from "@playwright/test";
import { setupApiMocks } from "../fixtures/api-mocks.js";

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173";

// The mocked start-checkout bootstrap brand (api-mocks BRAND.name).
const MERCHANT_NAME = "Northstar Atelier";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (globalThis as { process?: { env: Record<string, string> } }).process = {
      env: { AACP_DISABLE_STREAMING: "1" },
    };
  });
});

async function dismissGateAndWaitForThread(page: Page) {
  const gate = page.locator(".zyon-channel-gate__panel[role='dialog']");
  if (await gate.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await page.getByRole("button", { name: /Comprar por chat/i }).click();
  }
  const thread = page.locator(".zyon-thread");
  await expect(thread).toBeVisible({ timeout: 10_000 });
  await expect(thread.locator(".zyon-bubble-agent").first()).toBeVisible({ timeout: 10_000 });
}

test("@regression merchant identity from injected embed session renders", async ({ page }) => {
  await setupApiMocks(page, { chatSequence: [] });
  await page.goto(BASE);
  await dismissGateAndWaitForThread(page);

  // The merchant name from the injected session is shown in the cart header.
  const store = page.locator(".zyon-cart-store").first();
  await expect(store).toBeVisible({ timeout: 5_000 });
  await expect(store).toContainText(MERCHANT_NAME, { timeout: 3_000 });

  // Opening the account panel must not blank out the injected identity.
  const userBtn = page.locator(".zyon-user-chip, .zyon-user-btn").first();
  if (await userBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await userBtn.click();
    await expect(page.locator(".zyon-user-panel")).toBeVisible({ timeout: 5_000 });
  }

  await expect(store).toContainText(MERCHANT_NAME);
});

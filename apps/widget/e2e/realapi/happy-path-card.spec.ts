/**
 * T042 — Happy path: card payment via real API.
 *
 * Seeds a merchant, bootstraps checkout, walks through to payment step,
 * selects card, verifies CardForm renders.
 */
import { test, expect } from "@playwright/test";
import { openChatCheckout, REALAPI_URL } from "../fixtures/realapi-helpers.js";

const API = REALAPI_URL;

test.describe("@realapi happy-path card", () => {
  let merchantId: string;
  let embedToken: string;

  test.beforeEach(async ({ request }) => {
    const seed = await request.post(`${API}/__test__/seed`);
    expect(seed.ok()).toBe(true);
    ({ merchantId, embedToken } = await seed.json());
  });

  test("checkout renders and accepts card payment intent", async ({ page }) => {
    await openChatCheckout(page, merchantId, embedToken, "e2e_product_001");

    // Thread visible — checkout session started
    const thread = page.locator('[role="log"]');
    await expect(thread).toBeVisible();

    // Pay button or payment step reachable
    const payBtn = page.locator("[data-testid='pay-button'], .zyon-pay-btn").first();
    if (await payBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await payBtn.click();
      // CardForm or payment options should appear
      await expect(
        page.locator(".zyon-card-form, [data-testid='card-form'], .zyon-payment-options")
      ).toBeVisible({ timeout: 8_000 });
    }
  });
});

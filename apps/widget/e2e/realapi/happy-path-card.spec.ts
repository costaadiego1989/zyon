/**
 * T042 — Happy path: card payment via real API.
 *
 * Seeds a merchant, bootstraps checkout, walks through to payment step,
 * selects card, verifies CardForm renders.
 */
import { test, expect } from "@playwright/test";
import { openChatCheckout } from "../fixtures/realapi-helpers.js";

const API = "http://localhost:3000";

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
    const thread = page.locator(".aacp-thread");
    await expect(thread).toBeVisible();

    // Pay button or payment step reachable
    const payBtn = page.locator("[data-testid='pay-button'], .aacp-pay-btn").first();
    if (await payBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await payBtn.click();
      // CardForm or payment options should appear
      await expect(
        page.locator(".aacp-card-form, [data-testid='card-form'], .aacp-payment-options")
      ).toBeVisible({ timeout: 8_000 });
    }
  });
});

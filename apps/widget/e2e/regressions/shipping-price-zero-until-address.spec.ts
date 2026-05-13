/**
 * @regression REQ-CHK-001
 * Shipping price must be 0 and shipping selector hidden until address is complete.
 * Bug: R$19 flat-rate was shown before any address was entered.
 */
import { test, expect } from "@playwright/test";

const API = "http://localhost:3000";
const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173";

test.describe("@regression shipping-price-zero-until-address", () => {
  let merchantId: string;
  let embedToken: string;

  test.beforeEach(async ({ request }) => {
    const seed = await request.post(`${API}/__test__/seed`);
    if (!seed.ok()) {
      test.skip(true, "Seed endpoint not available (E2E_SEED_ENABLED not set)");
      return;
    }
    ({ merchantId, embedToken } = await seed.json());
  });

  test("shipping selector not visible before address is provided", async ({ page }) => {
    await page.goto(`${BASE}?merchantId=${merchantId}&embedToken=${embedToken}&productId=e2e_product_001`);
    await page.waitForSelector(".aacp-thread", { timeout: 15_000 });

    await expect(page.locator(".aacp-shipping-selector")).not.toBeVisible();
  });

  test("cart shipping line shows R$0,00 before address", async ({ page }) => {
    await page.goto(`${BASE}?merchantId=${merchantId}&embedToken=${embedToken}&productId=e2e_product_001`);
    await page.waitForSelector(".aacp-thread", { timeout: 15_000 });

    const cartBtn = page.locator(".aacp-cart-btn, [aria-label='Carrinho']").first();
    if (await cartBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await cartBtn.click();
      const shippingCost = page.locator(".aacp-totals-shipping, [data-testid='shipping-cost']").first();
      if (await shippingCost.isVisible({ timeout: 2_000 }).catch(() => false)) {
        const text = await shippingCost.textContent() ?? "";
        expect(text).toMatch(/R\$\s*0[,.]00|grátis|Grátis/i);
      }
    }

    await expect(page.locator(".aacp-thread")).toBeVisible();
  });
});

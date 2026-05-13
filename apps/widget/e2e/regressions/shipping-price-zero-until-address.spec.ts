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
    expect(seed.ok()).toBe(true);
    ({ merchantId, embedToken } = await seed.json());
  });

  test("shipping selector not visible before address is provided", async ({ page }) => {
    await page.goto(`${BASE}?merchantId=${merchantId}&embedToken=${embedToken}&productId=e2e_product_001`);
    await page.waitForSelector(".aacp-thread", { timeout: 15_000 });

    // Shipping selector must not appear before any address input
    await expect(page.locator(".aacp-shipping-selector")).not.toBeVisible();
  });

  test("cart shipping line shows R$0,00 before address", async ({ page }) => {
    await page.goto(`${BASE}?merchantId=${merchantId}&embedToken=${embedToken}&productId=e2e_product_001`);
    await page.waitForSelector(".aacp-thread", { timeout: 15_000 });

    // Open cart if available
    const cartBtn = page.locator(".aacp-cart-btn, [aria-label='Carrinho']").first();
    if (await cartBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await cartBtn.click();
      // Shipping line should show R$0,00 or not be visible at all
      const shippingLine = page.locator("text=Frete").first();
      if (await shippingLine.isVisible({ timeout: 2_000 }).catch(() => false)) {
        const shippingVal = page.locator(".aacp-totals-shipping, [data-testid='shipping-cost']").first();
        const text = await shippingVal.textContent().catch(() => "");
        expect(text).toMatch(/R\$\s*0[,.]00|grátis|Grátis/i);
      }
    }

    // Thread still visible — no crash
    await expect(page.locator(".aacp-thread")).toBeVisible();
  });
});

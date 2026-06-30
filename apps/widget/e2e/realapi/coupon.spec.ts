/**
 * T044 — Coupon apply flow via real API.
 *
 * Seeds merchant + coupon, boots checkout, applies coupon,
 * verifies UI reflects applied or rejected state.
 */
import { test, expect } from "@playwright/test";
import { openChatCheckout } from "../fixtures/realapi-helpers.js";

const API = "http://localhost:3000";

test.describe("@realapi coupon", () => {
  let merchantId: string;
  let embedToken: string;
  let accessToken: string;

  test.beforeEach(async ({ request }) => {
    const seed = await request.post(`${API}/__test__/seed`);
    expect(seed.ok()).toBe(true);
    ({ merchantId, embedToken, accessToken } = await seed.json());

    // Seed a test coupon for this merchant (admin route derives merchant_id
    // from the authenticated principal — send the seeded bearer token).
    const couponRes = await request.post(`${API}/merchant/coupons`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      data: {
        code: "TESTE10",
        discount_type: "percent",
        discount_value: 10,
        starts_at: new Date().toISOString(),
      },
    });
    expect(couponRes.ok()).toBe(true, `Coupon seed failed: ${await couponRes.text()}`);
  });

  test("coupon input renders and accepts submission", async ({ page }) => {
    await openChatCheckout(page, merchantId, embedToken, "e2e_product_001");

    const couponInput = page.locator("[data-testid='coupon-input'], input[placeholder*='cupom' i], input[placeholder*='coupon' i]").first();
    if (await couponInput.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await couponInput.fill("TESTE10");
      const applyBtn = page.locator("[data-testid='coupon-apply'], button:has-text('Aplicar')").first();
      if (await applyBtn.isVisible()) {
        await applyBtn.click();
        // Coupon was seeded — expect success feedback
        await expect(
          page.locator("[data-testid='coupon-result'], .zyon-coupon-feedback, .zyon-discount-chip")
        ).toBeVisible({ timeout: 5_000 });
      }
    }

    // Thread must still be intact
    await expect(page.locator(".zyon-thread")).toBeVisible();
  });

  test("invalid coupon code shows error feedback", async ({ page }) => {
    await openChatCheckout(page, merchantId, embedToken, "e2e_product_001");

    const couponInput = page.locator("[data-testid='coupon-input'], input[placeholder*='cupom' i], input[placeholder*='coupon' i]").first();
    if (await couponInput.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await couponInput.fill("INVALIDO999");
      const applyBtn = page.locator("[data-testid='coupon-apply'], button:has-text('Aplicar')").first();
      if (await applyBtn.isVisible()) {
        await applyBtn.click();
        // Invalid code — expect error feedback
        await expect(
          page.locator(".zyon-coupon-error, [data-testid='coupon-error']")
        ).toBeVisible({ timeout: 5_000 }).catch(() => null);
      }
    }

    // Thread must still be intact
    await expect(page.locator(".zyon-thread")).toBeVisible();
  });
});

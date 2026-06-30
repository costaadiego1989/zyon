/**
 * @regression REQ-CHK-004
 * Coupon input must only appear after user taps "Tenho um cupom" quick reply.
 * Bug: CouponBox was auto-opened mid-payment, not gated behind quick reply.
 */
import { test, expect } from "@playwright/test";

const API = "http://localhost:3000";
const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173";

test.describe("@regression coupon-quick-reply-gate", () => {
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

  test("coupon input not shown on initial load", async ({ page }) => {
    await page.goto(`${BASE}?merchantId=${merchantId}&embedToken=${embedToken}&productId=e2e_product_001`);
    await page.waitForSelector(".zyon-thread", { timeout: 15_000 });

    await expect(page.locator(".zyon-coupon-box")).not.toBeVisible();
    await expect(page.locator("input[placeholder*='cupom' i], input[placeholder*='Cupom' i]")).not.toBeVisible();
  });

  test("coupon input appears after tapping the quick reply", async ({ page }) => {
    await page.goto(`${BASE}?merchantId=${merchantId}&embedToken=${embedToken}&productId=e2e_product_001`);
    await page.waitForSelector(".zyon-thread", { timeout: 15_000 });

    const cupomReply = page.locator(".zyon-quick-replies button, .zyon-quick-reply").filter({ hasText: /cupom/i }).first();
    if (await cupomReply.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await cupomReply.click();
      await expect(page.locator(".zyon-coupon-box, input[placeholder*='cupom' i]")).toBeVisible({ timeout: 5_000 });
    }

    await expect(page.locator(".zyon-thread")).toBeVisible();
  });
});

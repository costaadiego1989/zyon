import { test, expect } from "@playwright/test";
import { setupCrossSellMocks, navigateToCheckout, selectChatChannel, type CrossSellMockConfig } from "./fixtures/cross-sell-mocks.js";

/**
 * Override the widget-config mock with trigger-specific config.
 * Must be called AFTER setupCrossSellMocks (overrides the widget-config route).
 */
async function overrideWidgetConfig(page: import("@playwright/test").Page, config: Record<string, unknown>) {
  await page.route("**/checkout-settings/widget-config**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        enabledTriggers: ["idle_30_seconds", "exit_intent_detected"],
        cooldownSeconds: 5,
        maxInterventionsPerSession: 10,
        idleSeconds: 2, // 2s for fast E2E
        triggerMessages: {
          exit_intent_detected: { message: "Ei, não vai embora!", couponCode: "VOLTA10" },
          idle_30_seconds: { message: "Está aí? Posso ajudar?", couponCode: "IDLE5" },
        },
        progressiveDiscount: {
          enabled: true,
          stages: { initial_coupon: 5, abandoned_cart: 10, payment_nudge: 15 },
        },
        advancedRules: [],
        ...config,
      }),
    });
  });
}

// ─── Issue 1: Idle trigger fires ─────────────────────────────────────────────

test("idle trigger: banner appears after inactivity", async ({ page }) => {
  await setupCrossSellMocks(page, {});
  await overrideWidgetConfig(page, { idleSeconds: 2 });
  await navigateToCheckout(page);
  await selectChatChannel(page);

  // Wait 3s (idle = 2s configured) without any interaction
  await page.waitForTimeout(3500);

  // Discount banner should be visible with idle message
  await expect(page.locator(".discount-banner")).toBeVisible({ timeout: 3000 });
  await expect(page.locator(".discount-banner__text")).toContainText(/OFF|Está aí/);
});

// ─── Issue 2: Exit-intent shows coupon ───────────────────────────────────────

test("exit-intent: banner shows coupon code from config", async ({ page }) => {
  await setupCrossSellMocks(page, {});
  await overrideWidgetConfig(page, {});
  await navigateToCheckout(page);
  await selectChatChannel(page);

  // Simulate exit intent: move mouse out of viewport
  await page.mouse.move(400, 300);
  await page.waitForTimeout(500);
  await page.mouse.move(400, -10); // above viewport = mouseleave on document

  await expect(page.locator(".discount-banner")).toBeVisible({ timeout: 5000 });
  // Coupon code chip must be present with "VOLTA10"
  await expect(page.locator(".discount-banner__coupon")).toContainText("VOLTA10");
  // Message from config (not default template)
  await expect(page.locator(".discount-banner__text")).toContainText("Ei, não vai embora!");
});

// ─── Issue 3: Progressive discount per checkout stage ────────────────────────

test("progressive discount: banner shows initial percent at checkout start", async ({ page }) => {
  await setupCrossSellMocks(page, {});
  await overrideWidgetConfig(page, {});
  await navigateToCheckout(page);
  await selectChatChannel(page);

  // Progressive discount fires at "awaiting" → initial_coupon stage (5%)
  await expect(page.locator(".discount-banner")).toBeVisible({ timeout: 5000 });
  await expect(page.locator(".discount-banner__text")).toContainText("5%");
});

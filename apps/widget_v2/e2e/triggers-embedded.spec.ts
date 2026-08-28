import { test, expect, type Page } from "@playwright/test";

/**
 * Validates that triggers fire in the EMBEDDED InlineCheckout path
 * (the one storefront uses). The `?embed=1` flag on the dev server
 * mounts InlineCheckout instead of App (see main.tsx).
 */

const WIDGET_URL = "http://127.0.0.1:5174";

async function setupEmbedMocks(page: Page) {
  await page.route("**/embed/start", async (route) => {
    await route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({
        session_id: "chk_embed_trigger_test",
        experience: {
          brand: { name: "Test Store", mode: "dark" },
          agent: { name: "IA", greeting: "Olá!" },
          buyer: { name: "Diego" },
          cart: { items: [{ sku: "P1", name: "Produto", price: 99.9, quantity: 1 }] },
          rules: { showBranding: false },
        },
      }),
    });
  });
  await page.route("**/storefront/cart/**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [{ variantId: "P1", productName: "Produto", quantity: 1, price: 99.9, subtotal: 99.9 }], total: 99.9 }) });
  });
  await page.route("**/embed/chat", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ message: "Ok!", blocks: [] }) });
  });
  await page.route("**/checkout-settings/widget-config**", async (route) => {
    await route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({
        enabledTriggers: ["idle_30_seconds", "exit_intent_detected"],
        cooldownSeconds: 5,
        maxInterventionsPerSession: 10,
        idleSeconds: 2,
        triggerMessages: {
          exit_intent_detected: { message: "Não vai embora!", couponCode: "VOLTA10" },
          idle_30_seconds: { message: "Está aí?" },
        },
        progressiveDiscount: { enabled: true, stages: { initial_coupon: 5, abandoned_cart: 10, payment_nudge: 15 } },
        advancedRules: [],
      }),
    });
  });
  await page.route("**/embed/track", (route) => route.fulfill({ status: 200, body: "{}" }));
}

async function navigateEmbed(page: Page) {
  await page.goto(`${WIDGET_URL}/?embed=1&embedToken=tok&merchantId=mrc&cartRef=cart&apiBaseUrl=${WIDGET_URL}`, { waitUntil: "domcontentloaded", timeout: 30000 });
}

async function enterChat(page: Page) {
  const chatBtn = page.locator("button", { hasText: "Por chat" });
  await chatBtn.waitFor({ state: "visible", timeout: 15000 });
  await chatBtn.click();
  await page.locator("text=/carrinho|Olá|produto ideal/i").first().waitFor({ state: "visible", timeout: 10000 });
}

// ─── Idle fires in embedded InlineCheckout ───────────────────────────────────

test("embedded: idle trigger fires after inactivity", async ({ page }) => {
  await setupEmbedMocks(page);
  await navigateEmbed(page);
  await enterChat(page);

  // Wait for idle (2s configured + buffer)
  await page.waitForTimeout(3500);
  await expect(page.locator(".discount-banner")).toBeVisible({ timeout: 3000 });
});

// ─── Exit-intent fires in embedded InlineCheckout ────────────────────────────

test("embedded: exit-intent shows coupon in InlineCheckout", async ({ page }) => {
  await setupEmbedMocks(page);
  await navigateEmbed(page);
  await enterChat(page);

  // Trigger exit intent (mouse leaves viewport)
  await page.mouse.move(400, 300);
  await page.waitForTimeout(300);
  await page.mouse.move(400, -10);

  await expect(page.locator(".discount-banner")).toBeVisible({ timeout: 5000 });
  await expect(page.locator(".discount-banner__coupon")).toContainText("VOLTA10");
});

// ─── Progressive discount at checkout start ──────────────────────────────────

test("embedded: progressive discount shows initial_coupon (5%) at start", async ({ page }) => {
  await setupEmbedMocks(page);
  await navigateEmbed(page);
  await enterChat(page);

  await expect(page.locator(".discount-banner")).toBeVisible({ timeout: 5000 });
  await expect(page.locator(".discount-banner__text")).toContainText("5%");
});

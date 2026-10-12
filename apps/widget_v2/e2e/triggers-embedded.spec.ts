import { test, expect, type Page } from "@playwright/test";

/**
 * Validates that triggers fire in the EMBEDDED InlineCheckout path
 * (the one storefront uses). The `?embed=1` flag on the dev server
 * mounts InlineCheckout instead of App (see main.tsx).
 */

const WIDGET_URL = "http://127.0.0.1:5174";

async function setupEmbedMocks(page: Page, options: {
  enabledTriggers?: string[];
  onTrack?: (event: { event?: string; metadata?: Record<string, unknown> }) => void;
} = {}) {
  await page.route("**/embed/start", async (route) => {
    await route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({
        session_id: "chk_embed_trigger_test",
        experience: {
          brand: { name: "Test Store", mode: "dark" },
          agent: { name: "IA", greeting: "Olá!" },
          buyer: { name: "Diego" },
          items: [{ sku: "P1", name: "Produto", unit_price: 99.9, quantity: 1 }],
          totals: { subtotal: 99.9, discount: 0, total: 99.9 },
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
        enabledTriggers: options.enabledTriggers ?? ["idle_30_seconds", "exit_intent_detected"],
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
  await page.route("**/embed/track", async (route) => {
    options.onTrack?.(route.request().postDataJSON());
    await route.fulfill({ status: 200, body: "{}" });
  });
}

async function navigateEmbed(page: Page) {
  await page.goto(`${WIDGET_URL}/?embed=1&embedToken=tok&merchantId=mrc&cartRef=cart&apiBaseUrl=${WIDGET_URL}`, { waitUntil: "domcontentloaded", timeout: 30000 });
}

async function enterChat(page: Page) {
  const chatBtn = page.locator("button", { hasText: "Por chat" });
  // A restored checkout session can already be in the chat channel. In that
  // case the selector is intentionally absent and the assertion below is the
  // stable readiness signal.
  if (await chatBtn.isVisible().catch(() => false)) await chatBtn.click();
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

test("embedded: closing the checkout records an abandonment event", async ({ page }) => {
  const events: { event?: string; metadata?: Record<string, unknown> }[] = [];
  await setupEmbedMocks(page, { onTrack: event => events.push(event) });
  await navigateEmbed(page);
  await enterChat(page);

  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));

  await expect.poll(() => events.some(event => event.event === "checkout_abandoned")).toBe(true);
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

// ─── Progressive discount remains server-authoritative ────────────────────────

test("embedded: progressive configuration alone does not grant a client-side discount", async ({ page }) => {
  await setupEmbedMocks(page, { enabledTriggers: [] });
  await navigateEmbed(page);
  await enterChat(page);

  await expect(page.locator(".discount-banner")).toHaveCount(0);
});

import { test, expect, type Page } from "@playwright/test";

/**
 * Validates the checkout cart is mobile-first: on a narrow viewport the cart
 * sidebar is hidden (chat gets full width) and a cart FAB appears; on desktop
 * the sidebar shows. Runs against the embedded InlineCheckout path (?embed=1).
 */

const WIDGET_URL = "http://127.0.0.1:5174";

async function setupMocks(page: Page) {
  await page.route("**/embed/start", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({
      session_id: "chk_mobile", experience: {
        brand: { name: "Test", mode: "dark" }, agent: { name: "IA", greeting: "Olá!" },
        buyer: { name: "Diego" },
        cart: { items: [{ sku: "P1", name: "Produto", price: 99.9, quantity: 1 }] },
      },
    }),
  }));
  await page.route("**/storefront/cart/**", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ items: [{ variantId: "P1", productName: "Produto", quantity: 1, price: 99.9, subtotal: 99.9 }], total: 99.9 }),
  }));
  await page.route("**/embed/chat", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ message: "Ok!", blocks: [] }) }));
  await page.route("**/checkout-settings/widget-config**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ enabledTriggers: [], cooldownSeconds: 120, maxInterventionsPerSession: 3 }) }));
  await page.route("**/embed/track", (route) => route.fulfill({ status: 200, body: "{}" }));
}

async function enterChat(page: Page) {
  await page.goto(`${WIDGET_URL}/?embed=1&embedToken=t&merchantId=m&cartRef=c&apiBaseUrl=${WIDGET_URL}`, { waitUntil: "domcontentloaded", timeout: 30000 });
  const chatBtn = page.locator("button", { hasText: "Por chat" });
  await chatBtn.waitFor({ state: "visible", timeout: 15000 });
  await chatBtn.click();
  await page.locator("text=/carrinho|Olá|produto ideal/i").first().waitFor({ state: "visible", timeout: 10000 });
}

test("mobile: cart sidebar hidden, FAB shown", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); // iPhone-ish
  await setupMocks(page);
  await enterChat(page);

  // Sidebar (aside.smart-cart-sidebar) should NOT be visible on mobile
  await expect(page.locator("aside.smart-cart-sidebar")).toHaveCount(0);
  // Cart FAB should be visible
  await expect(page.locator(".cart-fab-mobile")).toBeVisible({ timeout: 3000 });

  // Chat panel should have full width (not squeezed) — check it's wider than 300px
  const chatWidth = await page.locator(".pulse-widget-shell").first().evaluate((el) => el.clientWidth);
  expect(chatWidth).toBeGreaterThan(340);
});

test("mobile: tapping FAB opens cart drawer", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setupMocks(page);
  await enterChat(page);

  await page.locator(".cart-fab-mobile").click();
  await expect(page.locator(".smart-cart-drawer")).toBeVisible({ timeout: 3000 });
  await expect(page.locator(".smart-cart-drawer")).toContainText(/Carrinho/i);
});

test("desktop: cart sidebar shown, FAB hidden", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await setupMocks(page);
  await enterChat(page);

  await expect(page.locator("aside.smart-cart-sidebar")).toBeVisible({ timeout: 3000 });
  await expect(page.locator(".cart-fab-mobile")).toHaveCount(0);
});

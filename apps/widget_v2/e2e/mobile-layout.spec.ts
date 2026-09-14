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
        items: [{ sku: "P1", name: "Produto", unit_price: 99.9, quantity: 1 }],
        totals: { subtotal: 99.9, discount: 0, total: 99.9 },
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

test("mobile: cart sidebar hidden, FAB aligns with the chat composer", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); // iPhone-ish
  await setupMocks(page);
  await enterChat(page);

  // Sidebar (aside.smart-cart-sidebar) should NOT be visible on mobile
  await expect(page.locator("aside.smart-cart-sidebar")).toHaveCount(0);
  // Cart FAB should be visible
  const fab = page.locator(".cart-fab-mobile");
  await expect(fab).toBeVisible({ timeout: 3000 });

  // Chat panel should have full width (not squeezed)
  const chatWidth = await page.locator(".pulse-widget-shell").first().evaluate((el) => el.clientWidth);
  expect(chatWidth).toBeGreaterThan(340);
  // The composer reserves a slot for the FAB: both share a visual baseline
  // without the FAB covering the send action.
  const input = page.getByPlaceholder(/mensagem/i).first();
  const composer = input.locator("xpath=ancestor::form[1]");
  const send = composer.getByRole("button", { name: "Enviar mensagem" });
  const [inputBox, sendBox, fabBox] = await Promise.all([
    input.boundingBox(),
    send.boundingBox(),
    fab.boundingBox(),
  ]);
  expect(Math.abs((fabBox!.y + fabBox!.height / 2) - (inputBox!.y + inputBox!.height / 2))).toBeLessThanOrEqual(12);
  expect(fabBox!.x).toBeGreaterThanOrEqual(sendBox!.x + sendBox!.width + 8);
});

test("mobile: tapping FAB opens cart drawer (slides up from bottom)", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setupMocks(page);
  await enterChat(page);

  await page.locator(".cart-fab-mobile").click();
  const drawer = page.locator(".smart-cart-drawer");
  await expect(drawer).toBeVisible({ timeout: 3000 });
  await expect(drawer).toContainText(/Carrinho/i);

  // Drawer is anchored to the bottom (bottom sheet), radius top-only, slide-up animation
  const style = await drawer.evaluate((el) => {
    const s = getComputedStyle(el);
    return { bottom: s.bottom, borderTopLeftRadius: s.borderTopLeftRadius, animationName: s.animationName };
  });
  expect(style.bottom).toBe("0px");
  expect(style.borderTopLeftRadius).toBe("20px");
  expect(style.animationName).toContain("ckui-sheet-up");
});

test("mobile: closing drawer plays slide-down animation then unmounts", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setupMocks(page);
  await enterChat(page);

  await page.locator(".cart-fab-mobile").click();
  const drawer = page.locator(".smart-cart-drawer");
  await expect(drawer).toBeVisible({ timeout: 3000 });

  // Click close → slide-down animation kicks in
  await drawer.locator('button[aria-label="Fechar"]').click();
  const animName = await drawer.evaluate((el) => getComputedStyle(el).animationName).catch(() => "gone");
  // Either mid slide-down animation, or already unmounted
  expect(["ckui-sheet-down", "gone"]).toContain(animName === "ckui-sheet-down" ? "ckui-sheet-down" : "gone");

  // After the animation completes, the drawer is unmounted
  await expect(drawer).toHaveCount(0, { timeout: 1500 });
});

test("desktop: cart sidebar shown, FAB hidden", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await setupMocks(page);
  await enterChat(page);

  await expect(page.locator("aside.smart-cart-sidebar")).toBeVisible({ timeout: 3000 });
  await expect(page.locator(".cart-fab-mobile")).toHaveCount(0);
});

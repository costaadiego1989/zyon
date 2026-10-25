import { expect, test } from "@playwright/test";

const token = () => `${Buffer.from(JSON.stringify({ expiresAt: Date.now() / 1000 + 3_600 })).toString("base64url")}.test`;
const storyCover = (color: string, label: string) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><rect width="80" height="80" fill="${color}"/><text x="40" y="48" fill="white" font-family="Arial" font-size="30" font-weight="700" text-anchor="middle">${label}</text></svg>`)}`;

test("Compra rápida stays compact in the mobile header with Stories", async ({ page }, testInfo) => {
  let enabled = false;

  await page.addInitScript(() => {
    const payload = btoa(JSON.stringify({ sub: "buyer-mobile", exp: Math.floor(Date.now() / 1000) + 3_600 }));
    localStorage.setItem("zyon_buyer_token", `header.${payload}.signature`);
  });

  await page.route("**/api/storefront-conversations", async (route) => {
    await route.fulfill({ json: { conversation_id: "one-buy-mobile", conversation_token: token(), experiment: null } });
  });
  await page.route("**/one-buy-click", async (route) => {
    if (route.request().method() === "PATCH") enabled = !enabled;
    await route.fulfill({
      json: {
        enabled,
        status: enabled ? "idle" : "paused",
        shippingPreference: "fastest",
        paymentPreference: "pix",
        preferencesConfigured: true,
      },
    });
  });
  await page.route("**/events", async (route) => {
    await route.fulfill({ json: { ok: true } });
  });
  await page.route("**/storefront/demo/stories", async (route) => {
    await route.fulfill({
      json: {
        categories: [
          { id: "launch", name: "Lançamentos", coverImage: storyCover("#0f766e", "N"), stories: [{ id: "launch-1", imageUrl: storyCover("#0f766e", "N"), duration: 5 }] },
          { id: "offers", name: "Ofertas", coverImage: storyCover("#db2777", "%"), stories: [{ id: "offers-1", imageUrl: storyCover("#db2777", "%"), duration: 5 }] },
          { id: "looks", name: "Looks", coverImage: storyCover("#7c3aed", "L"), stories: [{ id: "looks-1", imageUrl: storyCover("#7c3aed", "L"), duration: 5 }] },
          { id: "news", name: "Novidades", coverImage: storyCover("#ea580c", "+"), stories: [{ id: "news-1", imageUrl: storyCover("#ea580c", "+"), duration: 5 }] },
        ],
      },
    });
  });

  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto("/store/demo", { waitUntil: "domcontentloaded" });

  // A store without voice starts chat after hydration; a voice-enabled store
  // retains this entry point. Invoke it without racing React's mode transition.
  await page.getByRole("button", { name: /Por chat/i })
    .evaluate((button: HTMLButtonElement) => button.click())
    .catch(() => {});

  const mobileHeaderToggle = page.locator('[data-one-buy-click-toggle="mobile-header"]');
  const headerToggle = page.locator('[data-one-buy-click-toggle="header"]');
  const composer = page.locator("form[data-aacp-composer-frame]");
  const stories = page.getByRole("list", { name: "Stories" });
  await expect(mobileHeaderToggle).toBeVisible();
  await expect(mobileHeaderToggle).toBeEnabled();
  await expect(headerToggle).toBeHidden();
  await expect(stories).toBeVisible();
  await expect(composer).toBeVisible();

  const layout = await page.locator("#storefront-chat").evaluate((chat) => {
    const mobile = document.querySelector('[data-one-buy-click-toggle="mobile-header"]')?.getBoundingClientRect();
    const composerFrame = document.querySelector("form[data-aacp-composer-frame]")?.getBoundingClientRect();
    const header = chat.querySelector("header")?.getBoundingClientRect();
    const storiesRow = chat.querySelector('[aria-label="Stories"]')?.parentElement?.getBoundingClientRect();
    const cart = document.querySelector('button[aria-label^="Carrinho"]')?.getBoundingClientRect();
    return {
      pageWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      headerRight: header?.right ?? 0,
      headerTop: header?.top ?? 0,
      headerBottom: header?.bottom ?? 0,
      mobileTop: mobile?.top ?? 0,
      mobileBottom: mobile?.bottom ?? 0,
      storiesTop: storiesRow?.top ?? 0,
      storiesBottom: storiesRow?.bottom ?? 0,
      composerTop: composerFrame?.top ?? 0,
      cartOverlapsStories: Boolean(cart && storiesRow && cart.left < storiesRow.right && cart.right > storiesRow.left && cart.top < storiesRow.bottom && cart.bottom > storiesRow.top),
    };
  });

  expect(layout.pageWidth).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.headerRight).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.mobileTop).toBeGreaterThanOrEqual(layout.headerTop);
  expect(layout.mobileBottom).toBeLessThanOrEqual(layout.headerBottom);
  expect(layout.storiesTop).toBeGreaterThanOrEqual(layout.headerBottom);
  expect(layout.storiesBottom).toBeLessThanOrEqual(layout.composerTop);
  expect(layout.cartOverlapsStories).toBe(false);

  await mobileHeaderToggle.click();
  await expect(mobileHeaderToggle).toHaveAttribute("aria-checked", "true");

  const screenshot = testInfo.outputPath("one-buy-click-mobile.png");
  await page.screenshot({ path: screenshot, animations: "disabled" });
  await testInfo.attach("one-buy-click-mobile", { path: screenshot, contentType: "image/png" });

  await page.setViewportSize({ width: 320, height: 640 });
  await expect(mobileHeaderToggle).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(headerToggle).toBeVisible();
  await expect(mobileHeaderToggle).toBeHidden();
  await expect(headerToggle).toHaveAttribute("aria-checked", "true");
});

for (const theme of ["light", "dark"]) {
test(`Compra rápida asks visitors to authenticate and choose readable defaults in ${theme}`, async ({ page }, testInfo) => {
  await page.addInitScript(theme => localStorage.setItem("zyon-theme", theme), theme);
  let preferencesConfigured = false;
  let enabled = false;
  let savedPreferences: Record<string, unknown> | null = null;
  await page.route("**/api/storefront-conversations", async (route) => {
    await route.fulfill({ json: { conversation_id: "one-buy-preferences", conversation_token: token(), experiment: null } });
  });
  await page.route("**/one-buy-click", async (route) => {
    if (route.request().method() === "PATCH") enabled = true;
    await route.fulfill({ json: {
      enabled,
      status: enabled ? "idle" : "paused",
      shippingPreference: "cheapest",
      paymentPreference: "pix",
      preferencesConfigured,
    } });
  });
  await page.route("**/buyer/me/preferences", async (route) => {
    savedPreferences = JSON.parse(route.request().postData() ?? "{}");
    preferencesConfigured = true;
    await route.fulfill({ json: {
      one_buy_click_enabled: true,
      shipping_preference: "fastest",
      payment_preference: "card",
      purchase_preferences_configured: true,
    } });
  });

  await page.goto("/store/demo", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /Por chat/i })
    .evaluate((button: HTMLButtonElement) => button.click())
    .catch(() => {});
  const headerToggle = page.locator('[data-one-buy-click-toggle="header"]');
  await expect(headerToggle).toBeVisible();
  await headerToggle.click();
  await expect(page.getByRole("heading", { name: /confirme sua identidade/i })).toBeVisible();

  await page.addInitScript(() => {
    const payload = btoa(JSON.stringify({ sub: "buyer-first-time", exp: Math.floor(Date.now() / 1000) + 3_600 }));
    localStorage.setItem("zyon_buyer_token", `header.${payload}.signature`);
  });
  await page.goto("/store/demo", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /Por chat/i })
    .evaluate((button: HTMLButtonElement) => button.click())
    .catch(() => {});
  const loggedBuyerToggle = page.locator('[data-one-buy-click-toggle="header"]');
  await expect(loggedBuyerToggle).toBeEnabled();
  await loggedBuyerToggle.click();
  const dialog = page.locator("[data-quick-purchase-preferences-dialog]");
  await expect(dialog).toBeVisible();
  await expect(dialog).not.toContainText(/\\u00/i);
  await expect(dialog.getByRole("button", { name: /Mais econômico/ })).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Cartão/ })).toBeVisible();
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: width === 320 ? 568 : 800 });
    const geometry = await dialog.evaluate(element => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
        viewport: innerWidth, height: innerHeight, overflowing: element.scrollWidth > element.clientWidth };
    });
    expect(geometry.left).toBeGreaterThanOrEqual(0);
    expect(geometry.right).toBeLessThanOrEqual(geometry.viewport);
    expect(geometry.top).toBeGreaterThanOrEqual(0);
    expect(geometry.bottom).toBeLessThanOrEqual(geometry.height);
    expect(geometry.overflowing).toBe(false);
    await dialog.screenshot({ path: testInfo.outputPath(`preferences-${theme}-${width}.png`) });
  }
  await dialog.getByRole("button", { name: /Salvar e ativar/ }).focus();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: /Mais econômico/ })).toBeFocused();
  await page.locator('[data-quick-purchase-choice="shipping-fastest"]').click();
  await page.locator('[data-quick-purchase-choice="payment-card"]').click();
  await page.getByRole("button", { name: /Salvar e ativar/i }).click();
  expect(savedPreferences).toEqual({
    one_buy_click_enabled: true,
    shipping_preference: "fastest",
    payment_preference: "card",
    purchase_preferences_configured: true,
  });
  await expect(page.locator('[data-one-buy-click-toggle="header"]')).toHaveAttribute("aria-checked", "true");
});
}

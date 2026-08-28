import { test, expect } from "@playwright/test";
import { setupCrossSellMocks, navigateToCheckout, selectChatChannel } from "./fixtures/cross-sell-mocks.js";

// ─── Theme sync: widget follows the shared "zyon-theme" localStorage key ──────

test("theme: widget renders light when shared theme key is light", async ({ page }) => {
  await setupCrossSellMocks(page, {});
  // Storefront writes the shared key; widget must read it (not default to dark).
  await page.addInitScript(() => {
    try { localStorage.setItem("zyon-theme", "light"); } catch {}
  });
  await navigateToCheckout(page);
  await selectChatChannel(page);

  const shellTheme = await page.locator(".pulse-widget-shell").first().getAttribute("data-theme");
  expect(shellTheme).toBe("light");
});

test("theme: widget renders dark when shared theme key is dark", async ({ page }) => {
  await setupCrossSellMocks(page, {});
  await page.addInitScript(() => {
    try { localStorage.setItem("zyon-theme", "dark"); } catch {}
  });
  await navigateToCheckout(page);
  await selectChatChannel(page);

  const shellTheme = await page.locator(".pulse-widget-shell").first().getAttribute("data-theme");
  expect(shellTheme).toBe("dark");
});

// ─── Whitelabel badge: shown only when rules.showBranding is true ─────────────

test("branding: 'Powered by Zyon' shown when showBranding=true", async ({ page }) => {
  await setupCrossSellMocks(page, { showBranding: true });
  await navigateToCheckout(page);
  await selectChatChannel(page);

  await expect(page.locator("text=Powered by Zyon")).toBeVisible({ timeout: 5000 });
});

test("branding: badge hidden when showBranding=false (paid plan)", async ({ page }) => {
  await setupCrossSellMocks(page, { showBranding: false });
  await navigateToCheckout(page);
  await selectChatChannel(page);

  await expect(page.locator("text=Powered by Zyon")).not.toBeVisible();
});

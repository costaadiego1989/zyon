import { test, expect } from "@playwright/test";
import { setupCrossSellMocks, navigateToCheckout, selectChatChannel } from "./fixtures/cross-sell-mocks.js";

// ─── Theme sync: widget follows the shared "zyon-theme" localStorage key ──────

// Helper: is an rgb() color light? (luminance > 0.6)
function isLightColor(rgb: string): boolean {
  const m = rgb.match(/\d+/g);
  if (!m || m.length < 3) return false;
  const [r, g, b] = m.map(Number);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6;
}

test("theme: widget renders light background when shared key is light", async ({ page }) => {
  await setupCrossSellMocks(page, {});
  await page.addInitScript(() => {
    try { localStorage.setItem("zyon-theme", "light"); } catch {}
  });
  await navigateToCheckout(page);
  await selectChatChannel(page);

  const shell = page.locator(".pulse-widget-shell").first();
  expect(await shell.getAttribute("data-theme")).toBe("light");
  // The CSS vars must actually resolve to a light background (not just the attr).
  const bg = await shell.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(isLightColor(bg), `expected light bg, got ${bg}`).toBe(true);
});

test("theme: widget renders dark background when shared key is dark", async ({ page }) => {
  await setupCrossSellMocks(page, {});
  await page.addInitScript(() => {
    try { localStorage.setItem("zyon-theme", "dark"); } catch {}
  });
  await navigateToCheckout(page);
  await selectChatChannel(page);

  const shell = page.locator(".pulse-widget-shell").first();
  expect(await shell.getAttribute("data-theme")).toBe("dark");
  const bg = await shell.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(isLightColor(bg), `expected dark bg, got ${bg}`).toBe(false);
});

test("theme: user light preference beats merchant dark default", async ({ page }) => {
  // Merchant default is dark (brand.mode dark), but user picked light.
  await setupCrossSellMocks(page, { brand: { mode: "dark" } });
  await page.addInitScript(() => {
    try { localStorage.setItem("zyon-theme", "light"); } catch {}
  });
  await navigateToCheckout(page);
  await selectChatChannel(page);

  const shell = page.locator(".pulse-widget-shell").first();
  expect(await shell.getAttribute("data-theme")).toBe("light");
  const bg = await shell.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(isLightColor(bg), `expected light bg (user pref wins), got ${bg}`).toBe(true);
});

test("theme: inline palette works without base.css (embedded scenario)", async ({ page }) => {
  // Simulate storefront embed: strip all link/style stylesheets after load.
  // The inline palette vars must still produce a light background.
  await setupCrossSellMocks(page, { brand: { mode: "dark" } });
  await page.addInitScript(() => {
    try { localStorage.setItem("zyon-theme", "light"); } catch {}
  });
  await navigateToCheckout(page);
  await selectChatChannel(page);

  // Remove all external stylesheets (simulates no base.css loaded)
  await page.evaluate(() => {
    document.querySelectorAll('link[rel="stylesheet"], style').forEach((el) => el.remove());
  });
  // Wait for reflow
  await page.waitForTimeout(200);

  const shell = page.locator(".pulse-widget-shell").first();
  const bg = await shell.evaluate((el) => getComputedStyle(el).backgroundColor);
  // Even without CSS files, inline palette on the shell should produce light bg
  expect(isLightColor(bg), `expected light bg from inline palette, got ${bg}`).toBe(true);
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

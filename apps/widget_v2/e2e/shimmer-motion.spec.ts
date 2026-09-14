import { test, expect } from "@playwright/test";
import { setupCrossSellMocks, navigateToCheckout, selectChatChannel } from "./fixtures/cross-sell-mocks.js";

for (const theme of ["light", "dark"]) {
  test(`checkout shimmer remains visible with reduced motion in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setupCrossSellMocks(page, {});
    await page.addInitScript(t => localStorage.setItem("zyon-theme", t), theme);
    await navigateToCheckout(page); await selectChatChannel(page);
    await page.getByRole("textbox", { name: "Mensagem", exact: true }).blur();
    await page.evaluate(() => document.fonts.ready);
    const contours = [
      page.locator('.shimmer-border-wrap > [data-perimeter="container"]'),
      page.locator('[data-aacp-checkout-composer] [data-perimeter="input"]'),
    ];
    for (const [i, contour] of contours.entries()) {
      expect(await contour.evaluate(el => getComputedStyle(el, "::after").animationDuration)).toBe(i ? "10s" : "8s");
      expect(await contour.evaluate(el => getComputedStyle(el, "::after").animationIterationCount)).toBe("infinite");
      await contour.evaluate(el => el.getAnimations({ subtree: true }).forEach(a => { a.pause(); a.currentTime = 0; }));
      const options = { caret: "hide" as const, mask: i === 0 ? [page.locator(".shimmer-border-wrap > div")] : [] };
      const before = await contour.screenshot(options);
      expect((await contour.screenshot(options)).equals(before)).toBe(true);
      await contour.evaluate(el => el.getAnimations({ subtree: true }).forEach(a => a.play()));
      await page.waitForTimeout(650);
      expect((await contour.screenshot(options)).equals(before)).toBe(false);
    }
  });
}

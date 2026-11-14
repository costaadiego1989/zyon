import { expect, test, type Page } from "@playwright/test";

async function changedPixels(page: Page, before: Buffer, after: Buffer) {
  return page.evaluate(async ([a, b]) => {
    const read = async (data: string) => {
      const image = new Image(); image.src = "data:image/png;base64," + data; await image.decode();
      const canvas = new OffscreenCanvas(image.width, image.height);
      const context = canvas.getContext("2d")!; context.drawImage(image, 0, 0);
      return context.getImageData(0, 0, image.width, image.height).data;
    };
    const first = await read(a), second = await read(b); let changed = 0;
    for (let i = 0; i < first.length; i += 4) {
      // GPU antialiasing can differ by a few channel values at rounded edges.
      // The opaque red diagnostic contour produces a much larger difference.
      if (Math.max(...[0, 1, 2].map(c => Math.abs(first[i + c] - second[i + c]))) > 16) changed++;
    }
    return changed;
  }, [before.toString("base64"), after.toString("base64")]);
}

const base = process.env.STOREFRONT_BASE_URL;
const slug = process.env.AACP_E2E_STORE_SLUG;

test.describe("Shimmer and panel layers", () => {
  test.skip(!base || !slug, "Configure the local storefront and demo slug.");
  for (const theme of ["light", "dark"]) {
    for (const reducedMotion of ["no-preference", "reduce"] as const) {
    test(`shimmer visibly moves on both contours in ${theme}, motion=${reducedMotion}`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.addInitScript(t => localStorage.setItem("zyon-theme", t), theme);
      await page.goto(`${base}/store/${slug}`);
      const input = page.getByRole("textbox", { name: "Mensagem", exact: true });
      await expect(input).toBeVisible(); await input.blur();
      await page.evaluate(() => document.fonts.ready);
      const contours = [
        page.locator('#storefront-chat > [data-perimeter="container"]'),
        page.locator('#storefront-chat form[data-neu="inset"] > [data-perimeter="input"]'),
      ];
      const durations: string[] = [];
      for (const [i, contour] of contours.entries()) {
        const duration = await contour.evaluate(el => getComputedStyle(el, "::after").animationDuration);
        durations.push(duration);
        await contour.evaluate(el => el.getAnimations({ subtree: true }).forEach(a => { a.pause(); a.currentTime = 0; }));
        // Mask chat content so only actual border pixels can change this image.
        const options = { caret: "hide" as const, mask: i === 0 ? [page.locator("[data-aacp-chat-content]")] : [] };
        const paused = await contour.screenshot(options);
        expect((await contour.screenshot(options)).equals(paused)).toBe(true);
        await contour.evaluate(el => el.getAnimations({ subtree: true }).forEach(a => a.play()));
        await page.waitForTimeout(650);
        expect((await contour.screenshot(options)).equals(paused)).toBe(false);
      }
      expect(durations).toEqual(reducedMotion === "reduce" ? ["8s", "10s"] : ["4s", "5s"]);
      for (const contour of contours) expect(await contour.evaluate(el => getComputedStyle(el, "::after").animationIterationCount)).toBe("infinite");
    });
    }

    test(`Hub and support cover chat decoration in ${theme}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.addInitScript(t => localStorage.setItem("zyon-theme", t), theme);
      await page.goto(`${base}/store/${slug}`);
      await expect(page.getByRole("textbox", { name: "Mensagem", exact: true })).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      const shell = page.locator("#storefront-chat");
      for (const kind of ["hub", "support"]) {
        await page.getByRole("button", { name: kind === "hub" ? "Abrir conta" : "Suporte", exact: true }).click();
        const panel = kind === "hub" ? page.getByRole("dialog", { name: "Hub do comprador" }) : page.locator("#support-panel");
        await expect(panel).toBeVisible(); await page.waitForTimeout(400);
        const background = await panel.evaluate(el => getComputedStyle(el).backgroundColor);
        expect(background).toMatch(/^rgb\(/); // Opaque theme token, never transparent.
        // Put the chat contour beneath the middle of a fixed panel, reproducing
        // an embedded storefront beside a larger drawer without changing app code.
        await shell.evaluate(el => { el.style.width = "60%"; });
        const pauseShimmer = await page.addStyleTag({ content: ".aacp-perimeter::after { animation-play-state: paused !important; }" });
        const before = await panel.screenshot({ animations: "allow", caret: "hide" });
        const highlight = await page.addStyleTag({ content: `
          #storefront-chat > .aacp-perimeter::before { border-color: red !important; }
          #storefront-chat > .aacp-perimeter::after { background: red !important; }
        ` });
        const after = await panel.screenshot({ animations: "allow", caret: "hide" });
        expect(await changedPixels(page, before, after), "covered chat decoration must not change the panel").toBe(0);
        // Positive control: recreate the former stacking bug so this assertion
        // cannot silently pass if the fixture stops overlapping the contour.
        const wrongLayer = await page.addStyleTag({ content: "#storefront-chat > .aacp-perimeter { z-index: 3 !important; }" });
        const exposed = await panel.screenshot({ animations: "allow", caret: "hide" });
        expect(await changedPixels(page, before, exposed)).toBeGreaterThan(10);
        await wrongLayer.evaluate(el => el.remove());
        await highlight.evaluate(el => el.remove());
        await pauseShimmer.evaluate(el => el.remove());
        await shell.evaluate(el => { el.style.width = "100%"; });
        await panel.screenshot({ path: testInfo.outputPath(`${kind}-${theme}.png`), animations: "allow", caret: "hide" });
        await panel.getByRole("button", { name: kind === "hub" ? "Fechar painel" : "Fechar suporte", exact: true }).click();
      }
    });
  }
});

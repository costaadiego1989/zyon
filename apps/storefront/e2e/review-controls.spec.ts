import { expect, test } from "@playwright/test";

const base = process.env.STOREFRONT_BASE_URL;
const slug = process.env.AACP_E2E_STORE_SLUG;
const product = process.env.AACP_E2E_PRODUCT_ID;

test.describe("Product review controls", () => {
  test.skip(!base || !slug || !product, "Configure the storefront, store slug and a local catalog product.");

  for (const width of [320, 390, 1440]) for (const theme of ["light", "dark"]) {
    test(`${width}px ${theme}: modes, keyboard, upload validation and account gate`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
      await page.addInitScript(value => localStorage.setItem("zyon-theme", value), theme);
      const submissions: string[] = [];
      page.on("request", request => {
        if (request.method() === "POST" && /\/(testimonials|videos)(\?|$)/.test(request.url())) submissions.push(request.url());
      });
      await page.goto(`${base}/store/${encodeURIComponent(slug!)}?show=content&product=${encodeURIComponent(product!)}`);
      const panel = page.locator("[data-aacp-product-experience]");
      const group = page.getByRole("group", { name: "Tipo de avaliação" });
      const written = group.getByRole("button", { name: "Avaliação escrita", exact: true });
      const video = group.getByRole("button", { name: "Vídeo", exact: true });
      await expect(written).toHaveAttribute("aria-pressed", "true");
      await panel.getByRole("textbox", { name: "Seu nome", exact: true }).fill("Cliente de teste");
      await panel.getByRole("textbox", { name: "Sua avaliação", exact: true }).fill("O produto atendeu às expectativas.");
      await written.focus();
      await page.keyboard.press("Tab");
      await expect(video).toBeFocused();
      await page.keyboard.press("Space");
      await expect(video).toHaveAttribute("aria-pressed", "true");
      await expect(written).toHaveAttribute("aria-pressed", "false");
      await expect(panel.getByRole("textbox", { name: "Título do vídeo", exact: true })).toBeVisible();

      const rects = await group.evaluate(el => {
        const track = el.getBoundingClientRect();
        return { track: { x: track.x, right: track.right }, buttons: Array.from(el.querySelectorAll("button")).map(button => {
          const r = button.getBoundingClientRect();
          return { x: r.x, right: r.right, height: r.height, clipped: button.scrollWidth > button.clientWidth + 1 };
        }) };
      });
      expect(rects.buttons[0].right).toBeLessThan(rects.buttons[1].x);
      for (const rect of rects.buttons) {
        expect(rect.x).toBeGreaterThan(rects.track.x);
        expect(rect.right).toBeLessThan(rects.track.right);
        expect(rect.height).toBeGreaterThanOrEqual(44);
        expect(rect.clipped).toBe(false);
      }
      expect(await panel.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

      const chooserButton = page.getByRole("button", { name: /Escolher vídeo/ });
      await chooserButton.focus();
      await expect(chooserButton).toBeFocused();
      const chooserEvent = page.waitForEvent("filechooser", { timeout: 5000 });
      await chooserButton.press("Enter");
      const chooser = await chooserEvent;
      await chooser.setFiles({ name: "arquivo.txt", mimeType: "text/plain", buffer: Buffer.from("conteudo de teste") });
      await expect(panel.getByRole("alert")).toHaveText("Escolha um vídeo no formato MP4.");
      await expect(chooserButton).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`video-${width}-${theme}.png`) });

      await written.click();
      await expect(panel.getByRole("textbox", { name: "Seu nome", exact: true })).toHaveValue("Cliente de teste");
      await expect(panel.getByRole("textbox", { name: "Sua avaliação", exact: true })).toHaveValue("O produto atendeu às expectativas.");
      await page.getByRole("button", { name: "Enviar para aprovação", exact: true }).click();
      await expect(page.getByRole("button", { name: "Entrar ou criar conta", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Fechar aviso", exact: true })).toBeVisible();
      expect(submissions).toEqual([]);
      await page.getByRole("button", { name: "Fechar aviso", exact: true }).click();
      await expect(page.getByRole("button", { name: "Entrar ou criar conta", exact: true })).toHaveCount(0);
      await group.scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath(`review-${width}-${theme}.png`) });
    });
  }
});

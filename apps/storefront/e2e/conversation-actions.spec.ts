import { expect, test } from "@playwright/test";

const base = process.env.STOREFRONT_BASE_URL;
const slug = process.env.AACP_E2E_STORE_SLUG;

test.describe("Conversation action states", () => {
  test.skip(!base || !slug, "Configure a local storefront and store slug.");
  for (const width of [320, 390, 1440]) for (const theme of ["light", "dark"]) {
    test(`${width}px ${theme}: send, reply and cart keep their states`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
      await page.addInitScript(value => localStorage.setItem("zyon-theme", value), theme);
      let releaseResponse!: () => void;
      const pending = new Promise<void>(resolve => { releaseResponse = resolve; });
      let submitted = 0;
      await page.route(/\/storefront\/conversations\/[^/]+\/messages$/, async route => {
        submitted++;
        await pending;
        await route.fulfill({ json: { message: "Seu produto está no carrinho.", blocks: [{ type: "cart_summary", data: {
          items: [{ variantId: "visual-camera", productName: "Câmera Instante", price: 749, subtotal: 749, quantity: 1, imageUrl: "https://images.example.test/camera.jpg" }],
          itemCount: 1, total: 749, discount: 0,
        } }] } });
      });
      await page.goto(`${base}/store/${encodeURIComponent(slug!)}`);
      const input = page.getByRole("textbox", { name: "Mensagem", exact: true });
      const send = input.locator("..").getByRole("button", { name: "Enviar mensagem", exact: true });
      await expect(send).toBeDisabled();
      await input.fill("   ");
      await expect(send).toBeDisabled();
      await input.fill("Quero essa câmera");
      await expect(send).toBeEnabled();
      const readyBox = await send.boundingBox();
      await send.focus();
      await send.press("Enter");
      await expect(send).toBeDisabled();
      await expect(input).toBeDisabled();
      expect(submitted).toBe(1);
      await expect(page.getByText("Quero essa câmera", { exact: true })).toBeVisible();
      const busyBox = await send.boundingBox();
      expect(busyBox?.width).toBe(readyBox?.width);
      expect(busyBox?.height).toBe(readyBox?.height);
      releaseResponse();
      await expect(page.getByText("Seu produto está no carrinho.", { exact: true })).toBeVisible();
      await expect(input).toBeEnabled();
      await expect(input).toHaveValue("");
      await expect(send).toBeDisabled();

      // The existing cart preview auto-opens after an item is added.
      const cartClose = page.getByRole("button", { name: "Fechar carrinho", exact: true });
      await expect(cartClose).toBeVisible();
      await expect(page.locator('img[src="https://images.example.test/camera.jpg"]')).toBeVisible();
      await cartClose.click();
      const cart = page.getByRole("button", { name: /Carrinho: 1 itens/ });
      await expect(cart).toBeVisible();
      await expect(cart).toContainText("1");
      await cart.focus();
      await cart.press("Enter");
      await expect(cartClose).toBeVisible();
      await expect(page.getByText("Câmera Instante", { exact: true }).last()).toBeVisible();
      await cartClose.click();
      await expect(cart).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`conversation-${width}-${theme}.png`) });
    });
  }
});

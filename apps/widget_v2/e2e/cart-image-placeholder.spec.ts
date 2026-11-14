import { test, expect } from "@playwright/test";
import { setupCrossSellMocks, navigateToCheckout, selectChatChannel } from "./fixtures/cross-sell-mocks";

for (const width of [390, 1440]) for (const mode of ["light", "dark"]) {
  test(`cart thumbnails fall back without changing layout at ${width}px in ${mode}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await setupCrossSellMocks(page);
    const image = "https://qa-images.invalid/product.svg";
    const items = [
      { sku: "missing", name: "Produto sem foto", quantity: 1, unit_price: 10 },
      { sku: "broken", name: "Produto com foto inválida", quantity: 1, unit_price: 10, image_url: "https://qa-images.invalid/missing.png" },
      { sku: "valid", name: "Produto com foto", quantity: 1, unit_price: 10, image_url: image },
    ];
    const experience = () => ({ items, brand: { name: "Teste de imagens", theme: { mode } },
      totals: { subtotal: 30, discount: 0, total: 30 }, stage: "payment" });
    await page.route("https://qa-images.invalid/**", route => route.request().url() === image
      ? route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="52" height="52"><rect width="52" height="52" fill="#0f766e"/></svg>' })
      : route.fulfill({ status: 404, body: "not found" }));
    await page.route("**/embed/start", route => route.fulfill({ json: { session_id: "chk_e2e_test_001", experience: experience() } }));
    await page.route("**/embed/cart", route => {
      items[1].image_url = image;
      return route.fulfill({ json: { experience: experience() } });
    });
    await navigateToCheckout(page, "https://qa-checkout.invalid");
    await selectChatChannel(page);
    if (width < 640) await page.getByRole("button", { name: "Abrir carrinho", exact: true }).click();
    const cart = page.locator('[aria-label="Carrinho do checkout"]:visible').first();
    const missing = cart.getByRole("img", { name: "Imagem indisponível: Produto sem foto", exact: true });
    const broken = cart.getByRole("img", { name: "Imagem indisponível: Produto com foto inválida", exact: true });
    await expect(missing.locator("svg")).toBeVisible();
    await expect(broken.locator("svg")).toBeVisible();
    const valid = cart.getByRole("img", { name: "Produto com foto", exact: true });
    await expect(valid.locator("img")).toBeVisible();
    await expect(valid.locator("svg")).toHaveCount(0);
    expect((await missing.boundingBox())?.width).toBe((await valid.boundingBox())?.width);
    expect((await missing.locator("svg").boundingBox())?.width).toBe(24);
    await page.screenshot({ path: test.info().outputPath("cart-placeholder.png") });
    await cart.getByRole("button", { name: "Aumentar quantidade de Produto com foto inválida", exact: true }).click();
    const recovered = cart.getByRole("img", { name: "Produto com foto inválida", exact: true });
    await expect(recovered.locator("img")).toBeVisible();
    await expect(recovered.locator("svg")).toHaveCount(0);
  });
}

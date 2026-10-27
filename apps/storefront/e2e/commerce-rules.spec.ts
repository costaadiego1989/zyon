import { test, expect } from "@playwright/test";
test.beforeEach(async ({ page }) => {
  await page.route("**/*", route => new URL(route.request().url()).origin === "http://127.0.0.1:5186"
    ? route.continue() : route.abort("blockedbyclient"));
});
for (const width of [390, 1440]) {
  test("typed commercial notices in actual chat and drawer at " + width + "px", async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 }); await page.goto("/");
    const cart = page.getByRole("region", { name: "Carrinho", exact: true });
    await page.getByLabel("Aviso comercial", { exact: true }).selectOption("discount_limit_reached");
    const status = cart.locator("[data-aacp-commercial-notices]");
    await expect(status).toHaveAttribute("role", "status"); await expect(status).toHaveAttribute("aria-live", "polite");
    await expect(status).toContainText("Você já obteve o desconto máximo permitido por esta loja nos produtos deste pedido. Outros benefícios não aumentam esse desconto."); await expect(status).not.toContainText("BENEFÍCIO ATIVO");
    await page.getByRole("button", { name: "Abrir carrinho de teste" }).click();
    const drawerNotice = page.locator('[data-aacp-commercial-notices]').filter({ has: page.locator('[data-commercial-notice-code="discount_limit_reached"]') });
    await expect(drawerNotice).toHaveCount(2);
    await page.screenshot({ path: info.outputPath("commercial-notices-" + width + ".png"), fullPage: true });
    const checkout = page.getByRole("button", { name: "Finalizar pedido", exact: true }); await expect(checkout).toBeEnabled(); await checkout.click();
    await expect(page.locator("output")).toHaveText("checkout-confirmed");
    await page.getByRole("button", { name: "Continuar comprando", exact: true }).click();
    await page.getByLabel("Aviso comercial", { exact: true }).selectOption("benefit_conditions_not_met");
    await expect(status).toContainText("condições atuais do carrinho"); await expect(status).not.toContainText("máximo permitido");
    await page.getByLabel("Aviso comercial", { exact: true }).selectOption(""); await expect(status).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
  test("notices, applied amount and cross-sell at " + width + "px", async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    for (const region of ["Produto", "Produto com conteúdo"]) {
      const notices = page.getByRole("region", { name: region, exact: true }).locator("[data-aacp-rule-notices]");
      await expect(notices).toContainText("a partir de 2 itens");
      await expect(notices).toContainText("Pix");
    }
    await expect(page.getByText("Frete grátis Brasil", { exact: true })).toHaveCount(0);
    const cart = page.getByRole("region", { name: "Carrinho", exact: true });
    await expect(cart.getByRole("status")).toContainText("Adicione mais 1 item");
    await page.getByRole("region", { name: "Produto", exact: true }).getByRole("button", { name: /Adicionar ao carrinho/ }).click();
    await expect(cart.getByRole("status")).toContainText("R$ 10,00 de desconto aplicado");
    await expect(cart).not.toContainText("Adicione mais 1 item");
    const crossSell = page.getByRole("region", { name: "Complementos", exact: true });
    await expect(crossSell).toContainText("Complemento real");
    await crossSell.getByRole("button", { name: /Adicionar/ }).click();
    await expect(page.locator("output")).toContainText("variant-complement");
    await page.getByRole("button", { name: "Reduzir quantidade" }).click();
    await expect(cart.getByRole("status")).toContainText("Adicione mais 1 item");
    await expect(cart).not.toContainText("desconto aplicado");
    await page.getByLabel("Sugestões após adicionar").uncheck();
    await page.getByRole("region", { name: "Produto", exact: true }).getByRole("button", { name: /Adicionar ao carrinho/ }).click();
    await expect(crossSell).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath("commerce-rules-" + width + ".png"), fullPage: true });
  });
}

import { test, expect } from "@playwright/test";
for (const width of [390, 1440]) {
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

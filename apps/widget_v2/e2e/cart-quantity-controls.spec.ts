import { test, expect } from "@playwright/test";
import { setupCrossSellMocks, navigateToCheckout, selectChatChannel } from "./fixtures/cross-sell-mocks";

for (const mobile of [false, true]) {
  test(`quantity and zero removal ${mobile ? "mobile" : "desktop"}`, async ({ page }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    await setupCrossSellMocks(page);
    const quantities: number[] = [];
    let fail = false;
    await page.route("**/embed/cart", async route => {
      const body = route.request().postDataJSON();
      expect(route.request().headers().authorization).toBe("Bearer tok_e2e");
      expect(body.session_id).toBe("chk_e2e_test_001");
      const quantity = body.items[0].quantity;
      quantities.push(quantity);
      await new Promise(resolve => setTimeout(resolve, 200));
      if (fail) return route.fulfill({ status: 503, json: { error: "unavailable" } });
      await route.fulfill({ json: { session_id: body.session_id, experience: {
        items: quantity ? [{ sku: "SKU-001", name: "Camiseta Zyon", quantity, unit_price: 89.9 }] : [],
        totals: { subtotal: quantity * 89.9, discount: 0, total: quantity * 89.9 },
      } } });
    });
    await navigateToCheckout(page);
    await selectChatChannel(page);
    const cart = page.locator('[aria-label="Carrinho do checkout"]:visible').first();
    if (mobile) await page.getByRole("button", { name: /carrinho/i }).first().click();
    const plus = cart.getByRole("button", { name: "Aumentar quantidade de Camiseta Zyon" });
    const minus = cart.getByRole("button", { name: "Diminuir quantidade de Camiseta Zyon" });
    const count = cart.getByLabel("Quantidade de Camiseta Zyon", { exact: true });
    await expect(count).toHaveText("1");
    await plus.click();
    await expect(plus).toBeDisabled();
    await expect(count).toHaveText("2");
    await expect(cart.getByText(/179,80/).first()).toBeVisible();
    fail = true;
    await plus.click();
    await expect(cart.getByRole("alert")).toContainText("Seus itens foram mantidos");
    await expect(count).toHaveText("2");
    fail = false;
    await minus.click();
    await expect(count).toHaveText("1");
    await minus.click();
    await expect(cart.getByText("Carrinho vazio", { exact: true })).toBeVisible();
    expect(quantities).toEqual([2, 3, 1, 0]);
  });
}

test("explicit remove action clears checkout", async ({ page }) => {
  await setupCrossSellMocks(page);
  await page.route("**/embed/cart", async route => {
    expect(route.request().postDataJSON().items).toEqual([{ sku: "SKU-001", quantity: 0 }]);
    await route.fulfill({ json: { experience: { items: [], totals: { subtotal: 0, discount: 0, total: 0 } } } });
  });
  await navigateToCheckout(page);
  await selectChatChannel(page);
  await page.getByRole("button", { name: "Remover Camiseta Zyon", exact: true }).first().click();
  await expect(page.getByText("Carrinho vazio", { exact: true }).first()).toBeVisible();
});

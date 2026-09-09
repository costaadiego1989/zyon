import { test, expect } from "@playwright/test";
import { setupCrossSellMocks, navigateToCheckout, selectChatChannel } from "./fixtures/cross-sell-mocks";

test("cart quantities use the authenticated checkout and render the authoritative response", async ({ page }) => {
  await setupCrossSellMocks(page);
  let publicCartCalls = 0;
  let updateBody: any;
  await page.route("**/storefront/cart/**", async route => { publicCartCalls += 1; await route.abort(); });
  await page.route("**/embed/cart", async route => {
    updateBody = route.request().postDataJSON();
    expect(route.request().headers().authorization).toBe("Bearer tok_e2e");
    await route.fulfill({ json: { session_id: "chk_e2e_test_001", experience: {
      items: [{ sku: "SKU-001", name: "Camiseta Zyon", quantity: 2, unit_price: 89.9 }],
      totals: { subtotal: 179.8, discount: 0, total: 179.8 },
    } } });
  });
  await navigateToCheckout(page);
  await selectChatChannel(page);
  await expect(page.getByText("Camiseta Zyon", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Aumentar quantidade de Camiseta Zyon", exact: true }).first().click();
  await expect(page.getByText("Carrinho atualizado. Vamos confirmar o frete antes do pagamento.", { exact: true })).toBeVisible();
  expect(updateBody).toEqual({ session_id: "chk_e2e_test_001", items: [{ sku: "SKU-001", quantity: 2 }] });
  expect(publicCartCalls).toBe(0);
  await expect(page.getByText(/179,80/).first()).toBeVisible();

  await page.route("**/embed/cart", route => route.fulfill({ status: 500, json: { error: "unavailable" } }));
  await page.getByRole("button", { name: "Aumentar quantidade de Camiseta Zyon", exact: true }).first().click();
  await expect(page.getByRole("alert").first()).toContainText("Seus itens foram mantidos");
  await expect(page.getByText(/179,80/).first()).toBeVisible();
});

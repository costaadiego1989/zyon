import { test, expect } from "@playwright/test";

const token = (expired = false) => `${Buffer.from(JSON.stringify({ expiresAt: Date.now() / 1000 + (expired ? -10 : 3600) })).toString("base64url")}.test`;

for (const mobile of [false, true]) {
  test(`restored conversation renews and cart quantities survive failures (${mobile ? "mobile" : "desktop"})`, async ({ page }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    const id = "e2e_cart_session";
    let starts = 0;
    let renewals = 0;
    let quantity = 0;
    let fail = false;
    let rejectMessage = false;
    const quantities: number[] = [];
    const snapshot = () => ({ cartId: id, items: quantity ? [{ variantId: "sku_test", productName: "Produto de teste", quantity, price: 129.9, subtotal: 129.9 * quantity }] : [], itemCount: quantity, discount: 0, total: quantity * 129.9 });
    await page.route("**/storefront/conversations", async route => {
      starts++;
      await route.fulfill({ json: { conversation_id: id, conversation_token: token() } });
    });
    await page.route(`**/storefront/conversations/${id}/access`, async route => {
      expect(route.request().headers().authorization).toMatch(/^Bearer /);
      renewals++;
      await route.fulfill({ json: { conversation_id: id, conversation_token: token() } });
    });
    await page.route(`**/storefront/conversations/${id}/events`, route => route.fulfill({ json: {} }));
    await page.route(`**/storefront/conversations/${id}/messages`, async route => {
      if (rejectMessage) { rejectMessage = false; return route.fulfill({ status: 401, json: { message: "invalid_conversation_token" } }); }
      const adding = route.request().postDataJSON().user_message.includes("Adicionar");
      if (adding) quantity = 1;
      await route.fulfill({ json: { message: adding ? "Produto adicionado." : "Catálogo disponível.", blocks: adding ? [{ type: "cart_summary", data: snapshot() }] : [] } });
    });
    await page.route(`**/storefront/cart/${id}**`, async route => {
      if (route.request().method() === "PATCH") {
        const next = route.request().postDataJSON().quantity;
        quantities.push(next);
        await new Promise(resolve => setTimeout(resolve, 250));
        if (fail) return route.fulfill({ status: 503, json: {} });
        quantity = next;
      }
      await route.fulfill({ json: snapshot() });
    });
    await page.addInitScript(() => localStorage.setItem("pulse-channel-pref", "chat"));
    // Store identity/layout comes from SSR; all conversation/cart writes above are isolated mocks.
    await page.goto(`/store/${process.env.STOREFRONT_E2E_SLUG ?? "athom-technologies"}`);
    const input = page.getByRole("textbox", { name: "Mensagem", exact: true });
    await input.fill("Adicionar produto de teste");
    await input.press("Enter");
    await expect(page.getByText("Produto adicionado.", { exact: true })).toBeVisible();
    expect(starts).toBe(1);
    await page.evaluate(({ id, expired }) => sessionStorage.setItem(`aacp_conversation_access:${id}`, expired), { id, expired: token(true) });
    await page.reload();
    const cart = page.getByRole("dialog", { name: "Carrinho", exact: true });
    const cartButton = page.getByRole("button", { name: /^Carrinho:/ });
    await expect(cartButton.or(cart)).toBeVisible();
    if (!(await cart.isVisible())) await cartButton.click();
    const plus = cart.getByRole("button", { name: "Aumentar quantidade de Produto de teste" });
    const minus = cart.getByRole("button", { name: "Diminuir quantidade de Produto de teste" });
    const count = cart.getByLabel("Quantidade de Produto de teste", { exact: true });
    await expect(count).toHaveText("1");
    expect(renewals).toBe(1);
    expect(starts).toBe(1);
    await plus.click();
    await expect(plus).toBeDisabled();
    await expect(count).toHaveText("2");
    fail = true;
    await minus.click();
    await expect(cart.getByRole("alert")).toContainText("Seus itens foram mantidos");
    await expect(count).toHaveText("2");
    fail = false;
    await minus.click();
    await expect(count).toHaveText("1");
    await minus.click();
    await expect(cart.getByText("Carrinho vazio", { exact: true })).toBeVisible();
    expect(quantities).toEqual([2, 1, 1, 0]);
    await cart.getByRole("button", { name: "Fechar carrinho", exact: true }).click();
    rejectMessage = true;
    await input.fill("Ver Produtos");
    await input.press("Enter");
    await expect(page.getByText("Catálogo disponível.", { exact: true })).toBeVisible();
    expect(renewals).toBe(2);
    expect(starts).toBe(1);
  });
}

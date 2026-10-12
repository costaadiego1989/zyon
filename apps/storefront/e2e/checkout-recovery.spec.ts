import { expect, test, type Page } from "@playwright/test";

// Store identity is rendered by the configured SSR backend. All buyer,
// conversation, checkout and payment requests below stay inside this browser.
async function setupCheckout(page: Page, options: { register?: boolean; failChunk?: boolean } = {}) {
  const conversationId = "checkout-recovery-cart";
  const buyerId = "checkout-recovery-buyer";
  const conversationToken = `${Buffer.from(JSON.stringify({ expiresAt: Date.now() / 1000 + 3600 })).toString("base64url")}.test`;
  const buyerToken = `test.${Buffer.from(JSON.stringify({ sub: buyerId, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")}.test`;
  const cart = { cartId: conversationId, items: [{ variantId: "test-sku", productName: "Produto de teste", quantity: 1, price: 129.9, subtotal: 129.9 }], itemCount: 1, total: 129.9, discount: 0 };
  const state = { failChunk: Boolean(options.failChunk), opening: false, blockedChunks: 0, registrations: 0, tokenRequests: 0, checkoutStarts: 0 };

  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (state.opening && state.failChunk && request.resourceType() === "script" && url.pathname.includes("/_next/")) {
      state.blockedChunks++;
      return route.abort("failed");
    }
    if (!url.pathname.startsWith("/api/") && url.hostname !== "viacep.com.br" && ["GET", "HEAD"].includes(request.method())) return route.continue();
    if (url.pathname.endsWith("/storefront-conversations") || url.pathname.endsWith("/storefront/conversations")) return route.fulfill({ json: { conversation_id: conversationId, conversation_token: conversationToken } });
    if (url.pathname.endsWith("/messages")) return route.fulfill({ json: { message: "Carrinho de teste pronto.", blocks: [{ type: "cart_summary", data: cart }, { type: "quick_replies", data: { options: ["Finalizar compra"] } }] } });
    if (url.pathname.includes("/cart/")) return route.fulfill({ json: cart });
    if (url.pathname.endsWith("/one-buy-click")) return route.fulfill({ json: { enabled: false, status: "paused", shippingPreference: "fastest", paymentPreference: "pix" } });
    if (url.pathname.endsWith("/buyer/email/verify")) return route.fulfill({ json: { verificationToken: "test-email-verification" } });
    if (url.pathname.endsWith("/buyer/register")) {
      state.registrations++;
      return route.fulfill({ json: { globalUserId: buyerId, accessToken: buyerToken, email: "buyer@example.test" } });
    }
    if (url.hostname === "viacep.com.br") return route.fulfill({ json: { logradouro: "Rua de Teste", bairro: "Centro", localidade: "São Paulo", uf: "SP" } });
    if (url.pathname.endsWith("/checkout-token")) {
      state.opening = true;
      state.tokenRequests++;
      expect(request.postDataJSON().cart_ref).toBe(conversationId);
      expect(request.headers().authorization).toBe(`Bearer ${conversationToken}`);
      return route.fulfill({ json: { embed_session_token: "test-embed-token", expires_at_unix: Date.now() / 1000 + 900 } });
    }
    if (url.pathname.endsWith("/embed/start")) {
      state.checkoutStarts++;
      expect(request.postDataJSON().buyer_access_token).toBe(buyerToken);
      return route.fulfill({ json: { session_id: "test-checkout-session", experience: {
        items: [{ sku: "test-sku", name: "Produto de teste", quantity: 1, unit_price: 129.9 }],
        totals: { subtotal: 129.9, total: 129.9, discount: 0 },
        brand: { name: "Loja de teste", theme: { mode: "light" } },
        agent: { name: "Assistente", language: "pt-BR" },
        buyer: { name: "Comprador Teste" },
        paymentMethods: { pix: true, card: false, boleto: false },
      } } });
    }
    return route.fulfill({ json: {} });
  });
  await page.addInitScript(({ buyerToken, buyerId, register }) => {
    localStorage.setItem("pulse-channel-pref", "chat");
    if (!register) {
      localStorage.setItem("zyon_buyer_token", buyerToken);
      localStorage.setItem("zyon_buyer_session", JSON.stringify({ globalUserId: buyerId, email: "buyer@example.test" }));
    }
  }, { buyerToken, buyerId, register: options.register });

  await page.goto(`/store/${process.env.STOREFRONT_E2E_SLUG ?? "athom-technologies"}`);
  const message = page.getByRole("textbox", { name: "Mensagem", exact: true });
  await message.fill("Adicionar produto de teste");
  await message.press("Enter");
  await page.getByRole("button", { name: "Finalizar compra", exact: true }).click();

  return { state, buyerToken, cart, message };
}

test("new registration opens checkout without registering again", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const { state, buyerToken } = await setupCheckout(page, { register: true });
  await page.getByRole("button", { name: /Criar conta/ }).click();
  const dialog = page.getByRole("dialog").filter({ has: page.getByRole("button", { name: "Confirmar", exact: true }) });
  const confirm = dialog.getByRole("button", { name: "Confirmar", exact: true });
  await dialog.getByLabel("E-mail", { exact: true }).fill("buyer@example.test");
  await confirm.click();
  for (let i = 1; i <= 6; i++) await dialog.getByLabel(`Dígito ${i}`, { exact: true }).fill(String(i));
  await confirm.click();
  await dialog.getByLabel("Celular para contato", { exact: true }).fill("11999999999");
  await confirm.click();
  await dialog.getByLabel("Nome completo", { exact: true }).fill("Comprador Teste");
  await dialog.getByLabel("CPF", { exact: true }).fill("52998224725");
  await confirm.click();
  await dialog.getByLabel("CEP", { exact: true }).fill("01001000");
  await dialog.getByLabel("Número", { exact: true }).fill("123");
  await expect(dialog.getByText("Rua: Rua de Teste", { exact: false })).toBeVisible();
  await confirm.click();
  await expect(page.locator(".pulse-widget-shell").getByText("Loja de teste", { exact: true })).toBeVisible();
  expect(state.registrations).toBe(1);
  expect(await page.evaluate(() => localStorage.getItem("zyon_buyer_token"))).toBe(buyerToken);
  expect(errors).toEqual([]);
});

for (const recovery of ["retry", "close"] as const) {
  test(`checkout download failure preserves the cart and recovers via ${recovery}`, async ({ page }) => {
    const { state, buyerToken, cart, message } = await setupCheckout(page, { failChunk: true });
    await expect(page.getByRole("alert").filter({ hasText: "Seu carrinho foi mantido" })).toBeVisible();
    expect(state.blockedChunks).toBeGreaterThan(0);
    expect(state.checkoutStarts).toBe(0);
    await expect(page.locator("body")).not.toContainText("Application error:");
    expect(await page.evaluate(() => localStorage.getItem("zyon_buyer_token"))).toBe(buyerToken);

    state.failChunk = false;
    if (recovery === "retry") {
      await page.getByRole("button", { name: "Tentar novamente", exact: true }).click();
    } else {
      await page.getByRole("button", { name: "Voltar à loja", exact: true }).click();
      await expect(message).toBeVisible();
      await expect(page.getByText(cart.items[0].productName, { exact: true }).first()).toBeVisible();
      await page.getByRole("dialog", { name: "Carrinho", exact: true }).getByRole("button", { name: "Finalizar pedido", exact: true }).click();
    }
    await expect(page.locator(".pulse-widget-shell").getByText("Loja de teste", { exact: true })).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Application error:");
    expect(state.checkoutStarts).toBeGreaterThan(0);
    expect(state.tokenRequests).toBeGreaterThan(1);
    expect(state.registrations).toBe(0);
  });
}

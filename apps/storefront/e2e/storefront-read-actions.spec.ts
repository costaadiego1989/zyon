import { expect, test } from "@playwright/test";

const merchantId = "read-action-merchant";
const conversationId = "read-action-conversation";
const capability = { version: 1, tools: ["search_products", "get_product_details"] };
const categories = { type: "category_carousel", data: { categories: [
  { id: "category-one", name: "Mesmo nome", slug: "one" },
  { id: "category-two", name: "Mesmo nome", slug: "two" },
] } };
const products = { type: "product_carousel", data: { merchantId, products: [
  { id: "product-one", name: "Produto com nome igual", price: 10, priceFormatted: "R$ 10,00", inStock: true, variants: [] },
  { id: "product-two", name: "Produto com nome igual", price: 20, priceFormatted: "R$ 20,00", inStock: true, variants: [] },
] } };

for (const failure of [401, 403, 500, "lost-response"] as const) {
  test(`legacy mutation/${failure}: browser never replays or recreates the conversation`, async ({ page }) => {
    const messages: Array<Record<string, unknown>> = [];
    let starts = 0, renewals = 0;
    const token = `${Buffer.from(JSON.stringify({ origin: "http://127.0.0.1:33117", expiresAt: Date.now() / 1000 + 3600 })).toString("base64url")}.synthetic-browser-only`;
    await page.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== "http://127.0.0.1:33117") return route.abort();
      if (url.pathname === "/api/storefront-conversations") {
        starts++;
        return route.fulfill({ json: { conversation_id: conversationId, merchant_id: merchantId, conversation_token: token } });
      }
      if (url.pathname.endsWith(`/conversations/${conversationId}/access`)) {
        renewals++;
        return route.fulfill({ status: 401, json: { error: "synthetic_access_rejected" } });
      }
      if (url.pathname.endsWith(`/conversations/${conversationId}/messages`)) {
        messages.push(request.postDataJSON());
        if (failure === "lost-response") return route.abort("failed");
        return route.fulfill({ status: failure, json: { error: "synthetic_uncertain_command" } });
      }
      if (url.pathname.startsWith("/api/v1/") || url.pathname.startsWith("/api/storefront-proxy/")) {
        return route.fulfill({ json: url.pathname.endsWith("/one-buy-click")
          ? { enabled: false, status: "idle", shippingPreference: "cheapest", paymentPreference: "pix", preferencesConfigured: false }
          : {} });
      }
      return route.continue();
    });
    await page.routeWebSocket("**/*", socket => socket.close());
    await page.addInitScript(() => localStorage.setItem("pulse-channel-pref", "chat"));
    await page.goto("/store/read-actions");
    await page.getByRole("button", { name: "Não aceito", exact: true }).click();
    const input = page.getByRole("textbox", { name: "Mensagem", exact: true });
    await expect(input).toBeEnabled();
    await input.fill("Adicionar produto sintético ao carrinho");
    await input.press("Enter");
    const text = failure === 401 || failure === 403
      ? "A sessão precisa ser validada. Sua solicitação não foi reenviada automaticamente. Verifique o carrinho antes de continuar."
      : "Não consegui confirmar o resultado da solicitação. Verifique o carrinho antes de enviar outra ação.";
    await expect(page.getByText(text, { exact: true })).toBeVisible();
    expect(messages).toHaveLength(1); expect(starts).toBe(1); expect(renewals).toBe(0);
    expect(messages[0].user_message).toBe("Adicionar produto sintético ao carrinho");
    expect(messages[0]).not.toHaveProperty("ui_action");
    await expect(input).toBeEnabled();
  });
}

for (const mode of ["typed", "legacy", "rejected"] as const) {
  test(`${mode}: real category/product callbacks preserve IDs and transport safety`, async ({ page }) => {
    const messages: Array<Record<string, unknown>> = [];
    let starts = 0;
    let renewals = 0;
    const token = `${Buffer.from(JSON.stringify({ origin: "http://127.0.0.1:33117", expiresAt: Date.now() / 1000 + 3600 })).toString("base64url")}.synthetic-not-a-real-signed-token`;
    await page.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== "http://127.0.0.1:33117") return route.abort();
      if (url.pathname === "/api/storefront-conversations") {
        starts++;
        return route.fulfill({ json: { conversation_id: conversationId, merchant_id: merchantId, conversation_token: token,
          ...(mode === "legacy" ? {} : { ui_action_capability: capability }) } });
      }
      if (url.pathname.endsWith(`/conversations/${conversationId}/access`)) {
        renewals++;
        return route.fulfill({ status: 401, json: { error: "synthetic_access_rejected" } });
      }
      if (url.pathname.endsWith(`/conversations/${conversationId}/messages`)) {
        const body = request.postDataJSON();
        messages.push(body);
        if (messages.length === 1) return route.fulfill({ json: { conversation_id: conversationId, message: "Escolha a categoria.", blocks: [categories], suggested_next: [] } });
        if (mode === "rejected") return route.fulfill({ status: 401, json: { error: "synthetic_action_rejected" } });
        return route.fulfill({ json: { conversation_id: conversationId, message: "Produtos encontrados.", blocks: messages.length === 2 ? [products] : [], suggested_next: [] } });
      }
      if (url.pathname.startsWith("/api/v1/") || url.pathname.startsWith("/api/storefront-proxy/")) {
        return route.fulfill({ json: url.pathname.endsWith("/one-buy-click") ? {
          enabled: false, status: "idle", shippingPreference: "cheapest", paymentPreference: "pix", preferencesConfigured: false,
        } : {} });
      }
      return route.continue();
    });
    await page.routeWebSocket("**/*", socket => socket.close());
    await page.addInitScript(() => localStorage.setItem("pulse-channel-pref", "chat"));
    await page.goto("/store/read-actions");
    await page.getByRole("button", { name: "Não aceito", exact: true }).click();
    const input = page.getByRole("textbox", { name: "Mensagem", exact: true });
    await expect(input).toBeEnabled();
    await input.fill("Explorar categorias");
    await input.press("Enter");
    await page.getByRole("navigation", { name: "Categorias da loja" }).getByRole("button").nth(1).click();
    await expect.poll(() => messages.length).toBe(2);
    expect(messages[0]).not.toHaveProperty("ui_action");
    expect(messages[1].user_message).toBe("Ver produtos de Mesmo nome");
    if (mode === "legacy") {
      expect(messages[1]).not.toHaveProperty("ui_action");
      expect(messages[1]).not.toHaveProperty("ui_action_version");
    } else {
      expect(messages[1].ui_action_version).toBe(1);
      expect(messages[1].ui_action).toEqual({ tool: "search_products", args: { query: "*", categoryId: "category-two" } });
    }
    if (mode === "rejected") {
      await expect(page.getByText("A sessão precisa ser validada. Sua solicitação não foi reenviada automaticamente. Verifique o carrinho antes de continuar.", { exact: true })).toBeVisible();
      expect(starts).toBe(1);
      expect(renewals).toBe(0);
      expect(messages).toHaveLength(2);
      return;
    }
    await page.locator('[data-aacp-carousel-product="product-two"]').getByRole("button", { name: "Saber mais", exact: true }).click();
    await expect.poll(() => messages.length).toBe(3);
    expect(messages[2].user_message).toBe("Detalhes Produto com nome igual");
    if (mode === "typed") {
      expect(messages[2].ui_action_version).toBe(1);
      expect(messages[2].ui_action).toEqual({ tool: "get_product_details", args: { productId: "product-two" } });
    } else expect(messages[2]).not.toHaveProperty("ui_action");
    expect(starts).toBe(1);
    expect(renewals).toBe(0);
  });
}

// Cross-sell IDs can be SKUs. Only its explicit productId is a read target.
const detailName = "Produto com nome igual";
const detailFixtures = [
  { producer: "product-card", productId: "card-product-two", label: `Ver detalhes de ${detailName}`,
    block: { type: "product_card", data: { id: "card-product-two", name: detailName, price: 2000, priceFormatted: "R$ 20,00", inStock: true, variants: [] } } },
  { producer: "cross-sell", productId: "cross-product-two", label: `Detalhes ${detailName}`,
    block: { type: "cross_sell", data: { trigger: "Complementos", displayMode: "inline", products: [
      { id: "sku-one", productId: "cross-product-one", name: detailName, price: 10, priceFormatted: "R$ 10,00", inStock: true },
      { id: "sku-two", productId: "cross-product-two", name: detailName, price: 20, priceFormatted: "R$ 20,00", inStock: true },
    ] } } },
] as const;

for (const mode of ["typed", "legacy", "rejected", "malformed", "foreign", "unknown", "old"] as const) {
  test(`suggestions/${mode}: versioned read suggestions are separate from display labels`, async ({ page }) => {
    if (mode === "typed") await page.setViewportSize({ width: 390, height: 844 });
    const messages: Array<Record<string, unknown>> = [];
    let starts = 0, renewals = 0;
    const label = "Abrir item com nome igual";
    const items = [
      { id: "read-action-1", label, action: { tool: "get_product_details", args: { productId: "suggestion-product-one" } } },
      { id: "read-action-2", label, action: { tool: "get_product_details", args: { productId: "suggestion-product-two" } } },
    ];
    const categorySuggestion = { version: 1, items: [{ id: "read-action-1", label: "Explorar esta categoria",
      action: { tool: "search_products", args: { query: "*", categoryId: "suggestion-category-two" } } }] };
    const token = `${Buffer.from(JSON.stringify({ origin: "http://127.0.0.1:33117", expiresAt: Date.now() / 1000 + 3600 })).toString("base64url")}.synthetic-not-a-real-signed-token`;
    await page.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== "http://127.0.0.1:33117") return route.abort();
      if (url.pathname === "/api/storefront-conversations") {
        starts++;
        return route.fulfill({ json: { merchant_id: merchantId, conversation_id: conversationId, conversation_token: token,
          ...(mode === "legacy" || mode === "old" ? {} : { ui_action_capability: capability }) } });
      }
      if (url.pathname.endsWith(`/conversations/${conversationId}/access`)) {
        renewals++;
        return route.fulfill({ status: 401, json: { error: "synthetic_access_rejected" } });
      }
      if (url.pathname.endsWith(`/conversations/${conversationId}/messages`)) {
        messages.push(request.postDataJSON());
        if (messages.length === 1) {
          const envelope = mode === "malformed"
            ? { version: 1, items: [items[0], { id: "write", label: "Never downgrade this label", action: { tool: "clear_cart", args: {} } }] }
            : { version: mode === "unknown" ? 2 : 1, items };
          return route.fulfill({ json: { conversation_id: mode === "foreign" ? "another-conversation" : conversationId,
            message: "Sugestões disponíveis.", blocks: [], suggested_next: ["Continuar pelo texto legado"],
            ...(mode === "old" ? {} : { suggested_actions: envelope }) } });
        }
        if (mode === "rejected") return route.fulfill({ status: 401, json: { error: "synthetic_action_rejected" } });
        return route.fulfill({ json: { conversation_id: conversationId, message: "Seleção recebida.", blocks: [], suggested_next: [],
          ...(messages.length === 2 && (mode === "typed" || mode === "legacy") ? { suggested_actions: categorySuggestion } : {}) } });
      }
      if (url.pathname.startsWith("/api/v1/") || url.pathname.startsWith("/api/storefront-proxy/")) {
        return route.fulfill({ json: url.pathname.endsWith("/one-buy-click")
          ? { enabled: false, status: "idle", shippingPreference: "cheapest", paymentPreference: "pix", preferencesConfigured: false } : {} });
      }
      return route.continue();
    });
    await page.routeWebSocket("**/*", socket => socket.close());
    await page.addInitScript(() => localStorage.setItem("pulse-channel-pref", "chat"));
    await page.goto("/store/read-actions");
    await page.getByRole("button", { name: "Não aceito", exact: true }).click();
    const input = page.getByRole("textbox", { name: "Mensagem", exact: true });
    await expect(input).toBeEnabled();
    await input.fill("Mostrar opções");
    await input.press("Enter");
    const legacyButton = page.getByRole("button", { name: "Continuar pelo texto legado", exact: true });
    await expect(legacyButton).toBeVisible();
    if (["malformed", "foreign", "unknown", "old"].some(value => value === mode)) {
      await expect(page.getByRole("button", { name: label, exact: true })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Never downgrade this label", exact: true })).toHaveCount(0);
      await legacyButton.click();
      await expect(page.getByText("Seleção recebida.", { exact: true })).toBeVisible();
      expect(messages).toHaveLength(2);
      expect(messages[1].user_message).toBe("Continuar pelo texto legado");
      expect(messages[1]).not.toHaveProperty("ui_action");
    } else {
      const buttons = page.getByRole("button", { name: label, exact: true });
      await expect(buttons).toHaveCount(2);
      await buttons.nth(1).focus();
      await buttons.nth(1).press("Enter");
      await expect.poll(() => messages.length).toBe(2);
      expect(messages[1].user_message).toBe(label);
      if (mode === "legacy") expect(messages[1]).not.toHaveProperty("ui_action");
      else {
        expect(messages[1].ui_action_version).toBe(1);
        expect(messages[1].ui_action).toEqual(items[1].action);
      }
      if (mode === "rejected") await expect(page.getByText("A sessão precisa ser validada. Sua solicitação não foi reenviada automaticamente. Verifique o carrinho antes de continuar.", { exact: true })).toBeVisible();
      else {
        await page.getByRole("button", { name: "Explorar esta categoria", exact: true }).click();
        await expect.poll(() => messages.length).toBe(3);
        expect(messages[2].user_message).toBe("Explorar esta categoria");
        if (mode === "legacy") expect(messages[2]).not.toHaveProperty("ui_action");
        else expect(messages[2].ui_action).toEqual(categorySuggestion.items[0].action);
      }
      expect(messages).toHaveLength(mode === "rejected" ? 2 : 3);
    }
    expect(starts).toBe(1);
    expect(renewals).toBe(0);
  });
}

for (const fixture of detailFixtures) {
  for (const mode of ["typed", "legacy", "rejected"] as const) {
    test(`${fixture.producer}/${mode}: details carry product identity without replay`, async ({ page }) => {
      const messages: Array<Record<string, unknown>> = [];
      let starts = 0, renewals = 0;
      const token = `${Buffer.from(JSON.stringify({ origin: "http://127.0.0.1:33117", expiresAt: Date.now() / 1000 + 3600 })).toString("base64url")}.synthetic-not-a-real-signed-token`;
      await page.route("**/*", async route => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin !== "http://127.0.0.1:33117") return route.abort();
        if (url.pathname === "/api/storefront-conversations") {
          starts++;
          return route.fulfill({ json: { merchant_id: merchantId, conversation_id: conversationId, conversation_token: token,
            ...(mode === "legacy" ? {} : { ui_action_capability: capability }) } });
        }
        if (url.pathname.endsWith(`/conversations/${conversationId}/access`)) {
          renewals++;
          return route.fulfill({ status: 401, json: { error: "synthetic_access_rejected" } });
        }
        if (url.pathname.endsWith(`/conversations/${conversationId}/messages`)) {
          messages.push(request.postDataJSON());
          if (messages.length === 1) return route.fulfill({ json: { conversation_id: conversationId, message: "Escolha um produto.", blocks: [fixture.block], suggested_next: [] } });
          return route.fulfill(mode === "rejected"
            ? { status: 401, json: { error: "synthetic_action_rejected" } }
            : { json: { conversation_id: conversationId, message: "Detalhes encontrados.", blocks: [], suggested_next: [] } });
        }
        // This suite certifies callbacks/transport, not rich editorial content.
        // Explicitly unavailable content avoids a misleading successful {} mock.
        if ((url.pathname.endsWith("/content") || url.pathname.endsWith("/share")) && url.pathname.includes("/products/")) {
          return route.fulfill({ status: 404, json: { error: "synthetic_content_unavailable" } });
        }
        if (url.pathname.startsWith("/api/v1/") || url.pathname.startsWith("/api/storefront-proxy/")) {
          return route.fulfill({ json: url.pathname.endsWith("/one-buy-click")
            ? { enabled: false, status: "idle", shippingPreference: "cheapest", paymentPreference: "pix", preferencesConfigured: false }
            : {} });
        }
        return route.continue();
      });
      await page.routeWebSocket("**/*", socket => socket.close());
      await page.addInitScript(() => localStorage.setItem("pulse-channel-pref", "chat"));
      await page.goto("/store/read-actions");
      await page.getByRole("button", { name: "Não aceito", exact: true }).click();
      const input = page.getByRole("textbox", { name: "Mensagem", exact: true });
      await expect(input).toBeEnabled();
      await input.fill("Ver produtos");
      await input.press("Enter");
      if (fixture.producer === "product-card") {
        await page.getByRole("button", { name: `Ver detalhes ricos de ${detailName}`, exact: true }).click();
      } else {
        await page.locator('div[data-neu="surface"]').filter({ has: page.getByText(detailName, { exact: true }) }).nth(1).click();
      }
      await expect.poll(() => messages.length).toBe(2);
      expect(messages[1].user_message).toBe(fixture.label);
      if (mode === "legacy") {
        expect(messages[1]).not.toHaveProperty("ui_action");
        expect(messages[1]).not.toHaveProperty("ui_action_version");
      } else {
        expect(messages[1].ui_action_version).toBe(1);
        expect(messages[1].ui_action).toEqual({ tool: "get_product_details", args: { productId: fixture.productId } });
      }
      if (fixture.producer === "product-card") {
        const panel = page.getByRole("dialog", { name: "Detalhes do produto", exact: true });
        await expect(panel).toBeVisible();
        await panel.getByRole("button", { name: "Voltar ao chat", exact: true }).click();
        await expect(panel).toBeHidden();
        await expect(page.locator("[data-aacp-chat-content]")).not.toHaveAttribute("inert", "");
      }
      if (mode === "rejected") await expect(page.getByText("A sessão precisa ser validada. Sua solicitação não foi reenviada automaticamente. Verifique o carrinho antes de continuar.", { exact: true })).toBeVisible();
      else await expect(page.getByText("Detalhes encontrados.", { exact: true })).toBeVisible();
      expect(messages).toHaveLength(2);
      expect(starts).toBe(1);
      expect(renewals).toBe(0);
    });
  }
}

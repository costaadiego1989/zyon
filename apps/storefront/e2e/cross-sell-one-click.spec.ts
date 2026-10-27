import { expect, test } from "@playwright/test";

function quote(optionMode = false): any {
  if (optionMode) {
    const value = quote(), option = (itemId: string, priceModifierInCents: number) => ({ groupId: "extras", groupName: "Extras", itemId, itemName: itemId, priceModifierInCents });
    value.cartBasis.items[0].selectedOptions = [option("size", 500)]; value.cartBasis.items[0].unitPriceCents = 10500;
    value.cartBasis.items.push({ ...value.cartBasis.items[0], selectedOptions: [option("color", 500)] }); value.cartBasis.total = 21000;
    value.selectedOptionItemIds = ["target-size"]; value.selectedOptions = [option("target-size", 1500)];
    value.originalUnitPriceCents = 11500; value.maximumUnitPriceCents = 10350;
    value.quote = { currency: "BRL", originalSubtotalCents: 32500, promotionDiscountCents: 1150, subtotalCents: 31350, merchandiseTotalCents: 30850,
      items: value.cartBasis.items.map((item: any) => ({ variantId: item.variantId, productId: item.productId, quantity: 1,
        selectedOptionItemIds: item.selectedOptions.map((option: any) => option.itemId), baseUnitPriceCents: 10500, unitPriceCents: 10500 })).concat([
        { variantId: "added", productId: "product-added", quantity: 1, selectedOptionItemIds: ["target-size"], baseUnitPriceCents: 11500, unitPriceCents: 10350 }]) };
    return value;
  }
  return { version: 1, merchantId: "store", cartId: "cart", variantId: "added", productId: "product-added", sku: "sku-added",
    promotionId: "promo", promotionUpdatedAt: "2026-10-19T00:00:00.000Z", quantity: 1, originalUnitPriceCents: 10000, maximumUnitPriceCents: 9000,
    cartBasis: { items: [{ variantId: "existing", productId: "product-existing", sku: "sku-existing", name: "Existing", quantity: 1, unitPriceCents: 10000 }],
      total: 10000, discount: 0, couponCode: null, freeShipping: false },
    quote: { currency: "BRL", originalSubtotalCents: 20000, promotionDiscountCents: 1000, subtotalCents: 19000, merchandiseTotalCents: 18500,
      items: [{ variantId: "existing", productId: "product-existing", quantity: 1, baseUnitPriceCents: 10000, unitPriceCents: 10000 },
        { variantId: "added", productId: "product-added", quantity: 1, baseUnitPriceCents: 10000, unitPriceCents: 9000 }] } };
}
function cart(optionMode = false): any {
  if (optionMode) {
    const expected = quote(true);
    return { cartId: "cart", items: expected.quote.items.map((item: any) => ({ variantId: item.variantId, productName: "Option product",
      quantity: 1, price: item.unitPriceCents / 100, subtotal: item.unitPriceCents / 100, optionItemIds: item.selectedOptionItemIds,
      selectedOptions: item.variantId === "added" ? expected.selectedOptions : expected.cartBasis.items.find((line: any) => line.selectedOptions[0].itemId === item.selectedOptionItemIds[0]).selectedOptions })),
      itemCount: 3, subtotal: 313.5, total: 308.5, discount: 5, freeShipping: false };
  }
  return { cartId: "cart", items: [{ variantId: "existing", productName: "Existing", quantity: 1, price: 100, subtotal: 100 },
    { variantId: "added", productName: "Complemento aprovado", quantity: 1, price: 90, subtotal: 90 }],
    itemCount: 2, subtotal: 190, total: 185, discount: 5, freeShipping: false };
}

for (const optionMode of [false, true]) for (const placement of ["inline", "interstitial", "rich"]) {
  for (const outcome of ["accepted", "stale", "lost-response", "session-changed"] as const) {
    test(`${optionMode ? "options" : "plain"}/${placement}/${outcome}: real CTA uses prior quote and never chat, repeat POST or full-price fallback`, async ({ page }) => {
      const requests: string[] = [], bodies: unknown[] = [];
      let releaseQuote!: () => void, releaseAccept!: () => void;
      const quoteGate = new Promise<void>(resolve => { releaseQuote = resolve; });
      const acceptGate = new Promise<void>(resolve => { releaseAccept = resolve; });
      await page.route("**/*", async route => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin !== "http://127.0.0.1:5197") return route.abort();
        if (url.pathname.endsWith("/cross-sell/quote")) {
          const previouslyAccepted = requests.includes("cart");
          requests.push("quote");
          if (previouslyAccepted) return route.fulfill({ status: 409, json: { error: "target_already_present" } });
          await quoteGate;
          return route.fulfill({ json: quote(optionMode) });
        }
        if (url.pathname.endsWith("/cross-sell/accept")) {
          requests.push("accept"); bodies.push(request.postDataJSON()); await acceptGate;
          if (outcome === "lost-response") return route.abort("failed");
          return route.fulfill({ status: outcome === "stale" ? 409 : 200,
            json: outcome === "stale" ? { error: "cross_sell_stale" } : { version: 1, status: "accepted", merchantId: "store", cartId: "cart" } });
        }
        if (url.pathname === "/api/storefront-proxy/cart/cart") {
          requests.push("cart"); return route.fulfill({ json: cart(optionMode) });
        }
        if (url.pathname.startsWith("/api/")) {
          requests.push(`unexpected:${request.method()}:${url.pathname}`);
          return route.fulfill({ status: 404, json: { error: "fixture_route_not_found" } });
        }
        return route.continue();
      });
      await page.goto(`/?placement=${placement}${optionMode ? "&options=1" : ""}`);
      await expect.poll(() => requests).toEqual(["quote"]);
      await expect(page.getByText("Complemento aprovado", { exact: true })).toHaveCount(0);
      releaseQuote();
      const offer = page.getByRole("region", { name: "Oferta validada" });
      await expect(offer.getByText("Complemento aprovado", { exact: true })).toBeVisible();
      await expect(offer.getByText(optionMode ? /103,50/ : /90,00/).first()).toBeVisible();
      const add = offer.getByRole("button", { name: /adicionar|adicionando|adicionado/i }).last();
      await expect(add).toBeEnabled();
      await add.dblclick();
      await expect(add).toBeDisabled();
      expect(requests).toEqual(["quote", "accept"]);
      expect(bodies).toEqual([{ expectedQuote: quote(optionMode) }]);
      if (outcome === "session-changed") {
        // Scope changes are application state, not a user click through a modal.
        await page.getByTestId("replace-conversation").dispatchEvent("click");
        await expect(page.getByTestId("conversation")).toHaveText("replacement");
      }
      const acknowledgement = outcome === "lost-response" ? Promise.resolve()
        : page.waitForResponse(response => response.url().endsWith("/cross-sell/accept"));
      releaseAccept();
      if (outcome === "accepted") {
        await acknowledgement;
        await expect(page.getByTestId("applied")).toHaveText("1");
        await expect(page.getByTestId("cart-total")).toHaveText(optionMode ? "308.5" : "185");
        expect(requests.slice(0, 3)).toEqual(["quote", "accept", "cart"]);
        expect(requests.filter(value => value === "accept")).toHaveLength(1);
        expect(requests.every(value => ["quote", "accept", "cart"].includes(value))).toBe(true);
      } else if (outcome === "session-changed") {
        await acknowledgement;
        await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        await expect(page.getByTestId("applied")).toHaveText("0");
        await expect(page.getByTestId("cart-total")).toHaveText(optionMode ? "210" : "100");
        expect(requests).toEqual(["quote", "accept"]);
      } else {
        // A lost response deliberately has no Response event.
        if (outcome !== "lost-response") await acknowledgement;
        await expect(offer.getByRole("alert")).toBeVisible();
        await expect(add).toBeDisabled();
        await expect(page.getByTestId("applied")).toHaveText("0");
        await expect(page.getByTestId("cart-total")).toHaveText(optionMode ? "210" : "100");
        expect(requests).toEqual(["quote", "accept"]);
      }
      await expect(page.getByTestId("chat-calls")).toHaveText("0");
    });
  }
}

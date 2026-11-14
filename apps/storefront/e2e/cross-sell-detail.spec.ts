import { expect, test } from "@playwright/test";

function quote(): any {
  const option = (itemId: string, cents: number) => ({ groupId: "extras", groupName: "Extras", itemId, itemName: itemId, priceModifierInCents: cents });
  const basis = ["size", "color"].map(itemId => ({ variantId: "existing", productId: "product-existing", sku: "sku-existing", name: "Existing", quantity: 1, unitPriceCents: 10500, selectedOptions: [option(itemId, 500)] }));
  return { version: 1, merchantId: "store", cartId: "cart", variantId: "added", productId: "product-added", sku: "sku-added", promotionId: "promo", promotionUpdatedAt: "2026-10-19T00:00:00.000Z", quantity: 1,
    selectedOptionItemIds: ["target-size"], selectedOptions: [option("target-size", 1500)], originalUnitPriceCents: 11500, maximumUnitPriceCents: 10350,
    cartBasis: { items: basis, total: 21000, discount: 0, couponCode: null, freeShipping: false },
    quote: { currency: "BRL", originalSubtotalCents: 32500, promotionDiscountCents: 1150, subtotalCents: 31350, merchandiseTotalCents: 30850,
      items: [...basis.map(item => ({ variantId: item.variantId, productId: item.productId, quantity: 1, selectedOptionItemIds: item.selectedOptions.map(option => option.itemId), baseUnitPriceCents: 10500, unitPriceCents: 10500 })),
        { variantId: "added", productId: "product-added", quantity: 1, selectedOptionItemIds: ["target-size"], baseUnitPriceCents: 11500, unitPriceCents: 10350 }] } };
}
function cart() {
  const q = quote(); return { cartId: "cart", items: q.quote.items.map((item: any) => ({ variantId: item.variantId, productName: "Target", quantity: 1,
    optionItemIds: item.selectedOptionItemIds, selectedOptions: item.variantId === "added" ? q.selectedOptions : q.cartBasis.items.find((line: any) => line.selectedOptions[0].itemId === item.selectedOptionItemIds[0]).selectedOptions,
    price: item.unitPriceCents / 100, subtotal: item.unitPriceCents / 100 })), itemCount: 3, subtotal: 313.5, total: 308.5, discount: 5, freeShipping: false };
}
function share() { return { merchantId: "store", productId: "product-added", blocks: [], faqs: [], testimonials: [], videos: [], purchase: {
  productName: "Target canonical", defaultVariantId: "red-default", priceReais: 1, images: [],
  variants: ["red-default", "added"].map(id => ({ id, attributes: { color: id === "added" ? "Blue G" : "Red M" }, available: true, priceReais: id === "added" ? 100 : 1, currency: "BRL", lowStock: false })),
  optionGroups: [{ id: "extras", name: "Extras", required: true, selectionType: "single", items: [{ id: "target-size", name: "Adicional aprovado", priceModifierInCents: 1500 }] }] } }; }

for (const placement of ["inline", "interstitial", "rich"]) for (const outcome of ["accepted", "lost-response", "variant-refused", "session-changed"]) {
  test(`${placement}/detail/${outcome}: existing selector quotes exact SKU and additions before the single purchase CTA`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const requests: string[] = [], selections: any[] = [], accepts: any[] = [];
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    await page.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== "http://127.0.0.1:5197") return route.abort();
      if (url.pathname.endsWith("/share")) { requests.push("share"); return route.fulfill({ json: share() }); }
      if (url.pathname.endsWith("/cross-sell/quote")) {
        const selection = request.postDataJSON(); selections.push(selection); requests.push("quote");
        if (selection.variantId !== "added" || selection.selectedOptionItemIds?.join() !== "target-size" || requests.includes("cart")) return route.fulfill({ status: 422, json: { code: "selection_required" } });
        return route.fulfill({ json: quote() });
      }
      if (url.pathname.endsWith("/cross-sell/accept")) { requests.push("accept"); accepts.push(request.postDataJSON()); await gate;
        return outcome === "lost-response" ? route.abort("failed") : route.fulfill({ json: { version: 1, status: "accepted", merchantId: "store", cartId: "cart" } }); }
      if (url.pathname === "/api/storefront-proxy/cart/cart") { requests.push("cart"); return route.fulfill({ json: cart() }); }
      if (url.pathname.startsWith("/api/")) { requests.push("unexpected:" + url.pathname); return route.fulfill({ status: 404, json: {} }); }
      return route.continue();
    });
    await page.goto(`/?placement=${placement}&detail=1&options=1`);
    const entry = page.getByRole("button", { name: "Ver detalhes", exact: true });
    await expect(entry).toBeEnabled(); await entry.focus(); await page.keyboard.press("Enter");
    const panel = page.locator("[data-aacp-rich-product-experience]"); await expect(panel).toBeVisible();
    await expect(panel.getByRole("radio", { name: "Blue G" })).toBeChecked();
    const add = panel.locator("[data-aacp-rich-product-add-to-cart]");
    await expect(add).toBeDisabled(); await expect(panel.locator("[data-aacp-product-total]")).toHaveText("Escolha as opções");
    await panel.getByRole("radio", { name: /Adicional aprovado/ }).check();
    await expect(add).toBeEnabled(); await expect(panel.locator("[data-aacp-product-total]")).toHaveText(/103,50/);
    await expect(add).toHaveCount(1);
    await expect(panel.locator("[data-aacp-rich-product-price]")).toHaveText(await panel.locator("[data-aacp-product-total]").innerText());
    if (outcome === "accepted") {
      await panel.evaluate(async element => {
        const animations = element.getAnimations({ subtree: false }).filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity);
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try { await Promise.race([Promise.all(animations.map(animation => animation.finished.catch(() => {}))),
          new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("detail_reveal_did_not_settle")), 2000); })]); }
        finally { if (timeout !== undefined) clearTimeout(timeout); }
      });
      await expect(panel).toHaveCSS("opacity", "1");
      await page.screenshot({ path: testInfo.outputPath(`${placement}-detail-390px.png`), fullPage: true });
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.screenshot({ path: testInfo.outputPath(`${placement}-detail-desktop.png`), fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
    }
    expect(selections.at(-1)).toEqual({ variantId: "added", promotionId: "promo", quantity: 1, selectedOptionItemIds: ["target-size"] });
    if (outcome === "variant-refused") {
      await panel.getByRole("radio", { name: "Red M" }).check(); await expect(add).toBeDisabled();
      await expect(panel.locator("[data-aacp-product-total]")).toHaveText("Oferta indisponível"); expect(selections.at(-1).variantId).toBe("red-default"); expect(accepts).toEqual([]); return;
    }
    await add.dblclick(); await expect(add).toBeDisabled(); expect(accepts).toEqual([{ expectedQuote: quote() }]);
    if (outcome === "session-changed") await page.getByTestId("replace-conversation").dispatchEvent("click");
    release();
    if (outcome === "accepted") await expect(page.getByTestId("applied")).toHaveText("1");
    else if (outcome === "lost-response") { await expect(panel.getByRole("alert")).toBeVisible(); await expect(page.getByTestId("applied")).toHaveText("0"); }
    else { await expect(page.getByTestId("conversation")).toHaveText("replacement"); await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))); await expect(page.getByTestId("applied")).toHaveText("0"); }
    expect(accepts).toHaveLength(1); expect(requests.some(value => value.startsWith("unexpected:"))).toBe(false);
    await expect(page.getByTestId("chat-calls")).toHaveText("0");
  });
}

import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { normalCheckoutCrossSellQuoteSchema } from "@zyon/contracts";

const variant = JSON.stringify(["blue", ["large"]]);
const startExperience = { items: [{ sku: "EXISTING", name: "Existing", quantity: 1, unit_price: 100 }],
  totals: { subtotal: 100, discount: 0, shipping: 0, total: 100, total_to_pay: 100, service_fee: 0 } };
function quote() { return normalCheckoutCrossSellQuoteSchema.parse({ version: 1, merchantId: "store", sessionId: "checkout", suggestionId: "suggestion", sessionVersion: 2,
  contextHash: "a".repeat(64), basisHash: "b".repeat(64), pricing: { kind: "quote_candidate", version: 1, merchantId: "store",
    targets: [{ version: 1, promotionId: "promo", promotionUpdatedAt: "2026-10-20T12:00:00Z", acceptedQuantity: 1, originalUnitPriceCents: 11500,
      maximumUnitPriceCents: 10350, selectedOptionItemIds: ["large"], variantId: "blue", productId: "product-added", sku: "BLUE", source: "cross_sell" }],
    items: [{ variantId: "existing", productId: "product-existing", sku: "EXISTING", quantity: 1, baseUnitPriceCents: 10000, unitPriceCents: 10000 },
      { variantId: "blue", productId: "product-added", sku: "BLUE", quantity: 1, baseUnitPriceCents: 11500, unitPriceCents: 10350,
        selectedOptions: [{ groupId: "size", groupName: "Tamanho", itemId: "large", itemName: "Grande", priceModifierInCents: 1500 }] }],
    originalSubtotalCents: 21500, preservedSavingsCents: 0, allocatedSavingsCents: 1150, promotionDiscountCents: 1150,
    cartDiscountCents: 0, merchandiseSubtotalCents: 20350, payableMerchandiseCents: 20350, remainingDiscountCents: 0, notice: "discount_limit_reached" } }); }
const share = () => ({ merchantId: "store", productId: "product-added", blocks: [], faqs: [], testimonials: [], videos: [], purchase: {
  productName: "Canonical checkout product", defaultVariantId: "red", images: [],
  variants: [{ id: "blue", sku: "BLUE", attributes: { color: "Azul" }, available: true, currency: "BRL", priceReais: 100, lowStock: false },
    { id: "red", sku: "RED", attributes: { color: "Vermelho" }, available: true, currency: "BRL", priceReais: 1, lowStock: false }],
  optionGroups: [{ id: "size", name: "Tamanho", required: true, selectionType: "single", items: [{ id: "large", name: "Grande", priceModifierInCents: 1500 }] }] } });
function accepted(review = false) {
  const q = quote(), acknowledgement = { version: 1, status: "accepted", merchantId: "store", sessionId: "checkout", suggestionId: "suggestion",
    persistenceVersion: 3, quoteHash: createHash("sha256").update(JSON.stringify(q)).digest("hex") };
  if (review) return { acknowledgement, projection_status: "requires_review" };
  return { acknowledgement, projection_status: "available", cart: { currency: "BRL", total: 203.5, currentDiscount: 0,
    items: [{ sku: "EXISTING", name: "Existing", variantId: "existing", product_id: "product-existing", quantity: 1, price: 100 },
      { sku: "BLUE", name: "Canonical checkout product", variantId: "blue", product_id: "product-added", quantity: 1, price: 103.5, originalPrice: 115, variant }] },
    experience: { items: [...startExperience.items, { sku: "BLUE", name: "Canonical checkout product", quantity: 1, unit_price: 103.5, variant }],
      totals: { subtotal: 203.5, discount: 0, shipping: 0, service_fee: 0, total: 203.5, total_to_pay: 203.5 } } };
}
for (const width of [390, 1440]) for (const outcome of ["accepted", "lost-response", "requires-review", "variant-refused", "session-swap"] as const) {
  test(`checkout/${width}/${outcome}: real widget blocks and existing detail preserve explicit quote/ACK and host continuity`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    const paths: string[] = [], quotes: unknown[] = [], accepts: unknown[] = [], denied: string[] = [];
    let starts = 0, release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    await page.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== "http://127.0.0.1:5197") { denied.push(url.origin); return route.abort(); }
      if (url.pathname === "/embed/start") { starts++; return route.fulfill({ json: { session_id: starts === 1 ? "checkout" : "replacement", experience: startExperience } }); }
      if (url.pathname.endsWith("/share")) return route.fulfill({ json: share() });
      if (url.pathname === "/embed/cross-sell/quote") {
        const body = request.postDataJSON(); paths.push(url.pathname); quotes.push(body);
        expect(request.headers().authorization).toBe("Bearer synthetic-browser-token");
        if (body.targets[0].variant_id !== "blue") return route.fulfill({ status: 422, json: { code: "cross_sell_quote_review_required" } });
        expect(body).toEqual({ session_id: "checkout", suggestion_id: "suggestion", targets: [{ sku: "BLUE", variant_id: "blue", quantity: 1, selected_option_item_ids: ["large"] }] });
        return route.fulfill({ json: quote() });
      }
      if (url.pathname === "/embed/cross-sell/accept") {
        accepts.push(request.postDataJSON()); paths.push(url.pathname); await gate;
        return outcome === "lost-response" ? route.abort("failed") : route.fulfill({ json: accepted(outcome === "requires-review") });
      }
      if (url.pathname.startsWith("/embed/") || url.pathname.startsWith("/api/")) { paths.push(`unexpected:${url.pathname}`); return route.fulfill({ status: 409, json: { code: "unexpected_fixture_operation" } }); }
      return route.continue();
    });
    await page.goto("/?checkout=1");
    await expect(page.getByTestId("checkout-session")).toHaveText("checkout");
    const origin = page.getByTestId("checkout-origin"); await origin.getByRole("button", { name: "Complemento checkout", exact: true }).click();
    const detail = page.locator("[data-aacp-rich-product-experience]"); await expect(detail).toBeVisible(); await expect(origin).toBeHidden();
    await expect(detail.getByRole("radio", { name: "Azul", exact: true })).toBeChecked();
    const button = detail.locator("[data-aacp-rich-product-add-to-cart]"); await expect(button).toBeDisabled(); expect(quotes).toHaveLength(0);
    await detail.getByRole("radio", { name: /Grande/ }).check(); await expect(button).toBeEnabled();
    await expect(detail.getByRole("status").filter({ hasText: /Você já obteve o desconto máximo permitido/ })).toBeVisible();
    await expect(detail.locator("[data-aacp-product-total]")).toHaveText(/103,50/); expect(accepts).toHaveLength(0);
    if (outcome === "variant-refused") {
      await detail.getByRole("radio", { name: "Vermelho", exact: true }).check(); await expect(button).toBeDisabled();
      await expect(detail.locator("[data-aacp-product-total]")).toHaveText("Oferta indisponível"); expect((quotes.at(-1) as { targets: { sku: string }[] }).targets[0]!.sku).toBe("RED");
      expect(accepts).toHaveLength(0); return;
    }
    await button.dblclick(); await expect(button).toBeDisabled(); await expect.poll(() => accepts.length).toBe(1);
    expect(accepts[0]).toEqual({ session_id: "checkout", suggestion_id: "suggestion", accepted_skus: ["BLUE"], expected_quote: quote() });
    if (outcome === "session-swap") await page.getByTestId("checkout-replace").dispatchEvent("click");
    release();
    if (outcome === "session-swap") {
      await expect(page.getByTestId("checkout-session")).toHaveText("replacement"); await expect(page.getByTestId("checkout-total")).toHaveText("100");
    } else {
      if (outcome === "accepted") { await expect(page.getByTestId("checkout-total")).toHaveText("203.5");
        await page.screenshot({ path: testInfo.outputPath(`checkout-detail-${width}.png`), fullPage: true }); }
      else { await expect(detail.getByRole("alert")).toBeVisible(); await expect(page.getByTestId("checkout-recovery")).toHaveText("true"); }
      await detail.getByRole("button", { name: "Fechar produto e voltar ao chat", exact: true }).click(); await expect(detail).toHaveCount(0); await expect(origin).toBeVisible();
      expect(starts).toBe(1);
      if (outcome !== "accepted") { await page.getByTestId("checkout-payment").click(); await page.getByTestId("checkout-remove").click(); }
    }
    expect(accepts).toHaveLength(1); expect(paths.some(path => path.startsWith("unexpected:"))).toBe(false);
    // All external requests are intercepted/aborted, including any unrelated
    // library preload; no PSP/LLM or backend authentication is exercised.
    await testInfo.attach("technical-egress", { body: JSON.stringify({ interceptedExternalOrigins: [...new Set(denied)], providerNetworkAllowed: false, backendProof: false }), contentType: "application/json" });
  });
}

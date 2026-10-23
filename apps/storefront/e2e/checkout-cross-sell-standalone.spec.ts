import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { normalCheckoutCrossSellQuoteSchema } from "@zyon/contracts";

const initial = { items: [{ sku: "EXISTING", name: "Existing", quantity: 1, unit_price: 100 }],
  totals: { subtotal: 100, discount: 0, shipping: 0, service_fee: 0, total: 100, total_to_pay: 100 } };
function quoted(sku: string) {
  const blue = sku === "BLUE", variantId = blue ? "blue" : "red", productId = blue ? "product-added" : "product-other";
  const base = blue ? 10000 : 5000, effective = blue ? 9000 : 4500;
  return normalCheckoutCrossSellQuoteSchema.parse({ version: 1, merchantId: "store", sessionId: "checkout", suggestionId: "suggestion", sessionVersion: 2,
    contextHash: "a".repeat(64), basisHash: "b".repeat(64), pricing: { kind: "quote_candidate", version: 1, merchantId: "store",
      items: [{ variantId: "existing", productId: "product-existing", sku: "EXISTING", quantity: 1, baseUnitPriceCents: 10000, unitPriceCents: 10000 },
        { variantId, productId, sku, quantity: 1, baseUnitPriceCents: base, unitPriceCents: effective }],
      originalSubtotalCents: 10000 + base, preservedSavingsCents: 0, allocatedSavingsCents: base - effective, promotionDiscountCents: base - effective,
      cartDiscountCents: 0, merchandiseSubtotalCents: 10000 + effective, payableMerchandiseCents: 10000 + effective, remainingDiscountCents: 0, notice: "discount_limit_reached",
      targets: [{ version: 1, promotionId: "promo", promotionUpdatedAt: "2026-10-20T12:00:00Z", acceptedQuantity: 1,
        originalUnitPriceCents: base, maximumUnitPriceCents: effective, variantId, productId, sku, selectedOptionItemIds: [], source: "cross_sell" }] } });
}
function accepted() {
  const q = quoted("BLUE"), variant = JSON.stringify(["blue", []]);
  return { acknowledgement: { version: 1, status: "accepted", merchantId: "store", sessionId: "checkout", suggestionId: "suggestion",
    persistenceVersion: 3, quoteHash: createHash("sha256").update(JSON.stringify(q)).digest("hex") }, projection_status: "available",
    cart: { currency: "BRL", total: 190, currentDiscount: 0, items: [
      { sku: "EXISTING", name: "Existing", variantId: "existing", product_id: "product-existing", quantity: 1, price: 100 },
      { sku: "BLUE", name: "Complemento azul", variantId: "blue", product_id: "product-added", quantity: 1, price: 90, originalPrice: 100, variant }] },
    experience: { items: [...initial.items, { sku: "BLUE", name: "Complemento azul", quantity: 1, unit_price: 90, variant }],
      totals: { subtotal: 190, discount: 0, shipping: 0, service_fee: 0, total: 190, total_to_pay: 190 } } };
}
for (const width of [390, 1440]) for (const [type, mixed] of [["digital", false], ["service", false], ["digital", true]] as const) {
  test(`canonical/${width}/${type}/${mixed ? "mixed" : "virtual"}: actual SDK and store retain fulfillment and server stage`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const response = accepted(), stage = mixed ? "shipping" : "payment", requests: unknown[] = [], unexpected: string[] = [];
    const metadata = (sku: string) => mixed && sku === "EXISTING"
      ? { productType: "physical", fulfillmentStrategy: "carrier" } : { productType: type, fulfillmentStrategy: type };
    response.cart.items = response.cart.items.map(item => ({ ...item, ...metadata(item.sku) }));
    Reflect.set(response.experience, "stage", stage);
    await page.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== "http://127.0.0.1:5197") return route.abort();
      if (url.pathname === "/embed/start") return route.fulfill({ json: { session_id: "checkout", experience: {
        ...initial, items: initial.items.map(item => ({ ...item, ...metadata(item.sku) })),
      } } });
      if (url.pathname === "/embed/cross-sell/quote") return route.fulfill({ json: quoted(request.postDataJSON().targets[0].sku) });
      if (url.pathname === "/embed/cross-sell/accept") { requests.push(request.postDataJSON()); return route.fulfill({ json: response }); }
      if (url.pathname.startsWith("/embed/") || url.pathname.startsWith("/api/")) {
        unexpected.push(url.pathname); return route.fulfill({ status: 409, json: { code: "unexpected_fixture_operation" } });
      }
      return route.continue();
    });
    await page.goto("/?checkout=1&standalone=1");
    const button = page.getByRole("button", { name: "Complemento azul", exact: true });
    await expect(button).toBeEnabled(); await expect(button).toHaveText(/90,00/); await button.click();
    await expect(page.getByTestId("checkout-total")).toHaveText("190");
    await expect(page.getByTestId("checkout-stage")).toHaveText(stage);
    await expect(page.getByTestId("checkout-cart-status")).toHaveText(mixed ? "awaiting" : "ready_to_pay");
    await expect(page.getByTestId("checkout-fulfillment")).toHaveText(JSON.stringify([
      ["EXISTING", mixed ? "physical" : type, mixed ? "carrier" : type], ["BLUE", type, type],
    ]));
    expect(requests).toHaveLength(1); expect(unexpected).toEqual([]);
    // Intercepted upstream only; not a physical shipping quote or PSP proof.
  });
}
for (const width of [390, 1440]) for (const outcome of ["accepted", "lost-response", "stale-quote"] as const) {
  test(`standalone/${width}/${outcome}: quote-before-click, independent cards and no guessed required options`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const quotes: unknown[] = [], accepts: unknown[] = [], unexpected: string[] = [];
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    await page.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== "http://127.0.0.1:5197") return route.abort();
      if (url.pathname === "/embed/start") return route.fulfill({ json: { session_id: "checkout", experience: initial } });
      if (url.pathname === "/embed/cross-sell/quote") {
        const body = request.postDataJSON(); quotes.push(body);
        expect(body.session_id).toBe("checkout"); expect(body.suggestion_id).toBe("suggestion");
        expect(body.targets).toEqual([{ sku: body.targets[0].sku, variant_id: body.targets[0].sku === "BLUE" ? "blue" : "red", quantity: 1, selected_option_item_ids: [] }]);
        return route.fulfill({ json: quoted(body.targets[0].sku) });
      }
      if (url.pathname === "/embed/cross-sell/accept") {
        accepts.push(request.postDataJSON()); await gate;
        if (outcome === "lost-response") return route.abort("failed");
        if (outcome === "stale-quote") return route.fulfill({ status: 422, json: { code: "cross_sell_quote_review_required" } });
        return route.fulfill({ json: accepted() });
      }
      if (url.pathname.startsWith("/embed/") || url.pathname.startsWith("/api/")) {
        unexpected.push(url.pathname); return route.fulfill({ status: 409, json: { code: "unexpected_fixture_operation" } });
      }
      return route.continue();
    });
    await page.goto("/?checkout=1&standalone=1");
    const blue = page.getByRole("button", { name: "Complemento azul", exact: true });
    const red = page.getByRole("button", { name: "Complemento vermelho", exact: true });
    await expect(blue).toBeEnabled(); await expect(red).toBeEnabled();
    await expect(page.getByRole("status").filter({ hasText: /Você já obteve o desconto máximo permitido/ }).first()).toBeVisible();
    await expect(blue).toHaveText(/90,00/); await expect(red).toHaveText(/45,00/);
    await expect(page.getByRole("button", { name: "Complemento com opções", exact: true })).toBeDisabled();
    expect(quotes).toHaveLength(2); expect(accepts).toHaveLength(0);
    await expect(page.getByTestId("checkout-total")).toHaveText("100");
    await blue.dblclick(); await expect.poll(() => accepts.length).toBe(1); await expect(blue).toBeDisabled();
    expect(accepts[0]).toEqual({ session_id: "checkout", suggestion_id: "suggestion", accepted_skus: ["BLUE"], expected_quote: quoted("BLUE") });
    release();
    if (outcome === "accepted") await expect(page.getByTestId("checkout-total")).toHaveText("190");
    else {
      await expect(page.getByRole("alert").filter({ hasText: outcome === "lost-response" ? /Não foi possível confirmar/ : /nova cotação/ }).first()).toBeVisible();
      await expect(page.getByTestId("checkout-total")).toHaveText("100");
      await expect(red).toBeDisabled();
      if (outcome === "lost-response") { await page.getByTestId("checkout-payment").click(); await page.getByTestId("checkout-remove").click(); }
    }
    expect(accepts).toHaveLength(1); expect(quotes).toHaveLength(2); expect(unexpected).toEqual([]);
    // Actual React/SDK/store; all upstream is controlled. Not server, auth or SQL proof.
  });
}

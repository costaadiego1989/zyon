import test from "node:test";
import assert from "node:assert/strict";
import { ShopifyCommerceAdapter } from "./shopify-commerce.adapter.js";

const MY_SHOP = "test-shop.myshopify.com";

function assertNoAsaasBilling(urls: readonly string[]): void {
  for (const u of urls) {
    assert.ok(
      !/asaas\.com|asaas-api|\/asaas\//i.test(u),
      `Commerce sync must never call Asaas URLs (got ${u})`
    );
  }
}

test("validateCart maps cart_validations fixture to TrustedCartSnapshot", async () => {
  const urls: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    urls.push(url);
    assert.equal((init?.method ?? "GET").toUpperCase(), "GET");
    assert.match(url, new RegExp(`https://${MY_SHOP}/admin/api/2025-10/cart_validations/cref_9\\.json`));
    return Response.json({
      currency: "BRL",
      total_cents: 6400,
      commerce_cart_ref: "cref_9",
      lines: [{ sku: "sku_1", quantity: 2, unit_price_cents: 3200, title: "Item" }]
    });
  };

  const adapter = new ShopifyCommerceAdapter(
    { shopDomain: `https://${MY_SHOP}/`, adminAccessToken: "adm_1", apiVersion: "2025-10" },
    fetchImpl
  );
  const out = await adapter.validateCart({ merchantId: "m1", commerceCartRef: "cref_9" });

  assert.equal(out.currency, "BRL");
  assert.equal(out.totalCents, 6400);
  assert.equal(out.commerceCartRef, "cref_9");
  assert.equal(out.lines.length, 1);
  assert.equal(out.lines[0]!.sku, "sku_1");
  assert.equal(out.lines[0]!.unitPriceCents, 3200);
  assertNoAsaasBilling(urls);
});

test("createPendingOrder POST draft_orders carries cart line prices in currency units", async () => {
  const urls: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    urls.push(url);
    assert.equal(init?.method, "POST");
    assert.ok(url.endsWith("/draft_orders.json"));
    assert.ok(init?.body, "expects JSON body");
    const parsed = JSON.parse(init!.body as string) as {
      draft_order: { line_items: Array<{ sku: string; price: string }> };
    };
    assert.equal(parsed.draft_order.line_items[0]?.price, "25.75");
    return Response.json({ draft_order: { id: 773_311 } });
  };

  const adapter = new ShopifyCommerceAdapter({ shopDomain: MY_SHOP, adminAccessToken: "t" }, fetchImpl);

  const { commerceOrderId } = await adapter.createPendingOrder({
    merchantId: "m1",
    sessionId: "sess_99",
    cart: {
      currency: "BRL",
      totalCents: 2575,
      commerceCartRef: "cref",
      lines: [{ sku: "sku_1", quantity: 1, unitPriceCents: 2575, title: "One" }]
    }
  });

  assert.equal(commerceOrderId, "773311");
  assertNoAsaasBilling(urls);
});

test("markOrderPaid POSTs transactions to scoped order endpoint", async () => {
  const urls: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    urls.push(url);
    assert.equal(init?.method, "POST");
    assert.match(url, /\/orders\/77821\/transactions\.json$/);
    const body = JSON.parse((init!.body ?? "{}") as string) as {
      transaction: { source_name: string };
    };
    assert.equal(body.transaction.source_name, "aacp:pay_xyz");
    return Response.json({ transaction: { id: 1 } });
  };

  const adapter = new ShopifyCommerceAdapter({ shopDomain: MY_SHOP, adminAccessToken: "t" }, fetchImpl);
  await adapter.markOrderPaid({
    merchantId: "m1",
    commerceOrderId: "77821",
    paymentReference: "pay_xyz"
  });
  assertNoAsaasBilling(urls);
});

test("full mocked flow emits only Shopify admin URLs", async () => {
  const urls: string[] = [];
  let step = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    urls.push(url);
    if (step === 0) {
      assert.match(url, /cart_validations/);
      step += 1;
      return Response.json({
        currency: "BRL",
        total_cents: 100,
        commerce_cart_ref: "cart_a",
        lines: [{ sku: "z", quantity: 1, unit_price_cents: 100, title: "Z" }]
      });
    }
    if (step === 1) {
      assert.ok(url.endsWith("/draft_orders.json"));
      step += 1;
      return Response.json({ draft_order: { id: 500 } });
    }
    assert.ok(url.includes("/transactions.json"));
    step += 1;
    return Response.json({ transaction: {} });
  };

  const adapter = new ShopifyCommerceAdapter({ shopDomain: MY_SHOP, adminAccessToken: "t" }, fetchImpl);
  await adapter.validateCart({ merchantId: "m1", commerceCartRef: "cart_a" });
  await adapter.createPendingOrder({
    merchantId: "m1",
    sessionId: "chk_1",
    cart: {
      currency: "BRL",
      totalCents: 100,
      commerceCartRef: "cart_a",
      lines: [{ sku: "z", quantity: 1, unitPriceCents: 100, title: "Z" }]
    }
  });
  await adapter.markOrderPaid({
    merchantId: "m1",
    commerceOrderId: "500",
    paymentReference: "ref_abc"
  });

  assert.equal(step, 3);
  assertNoAsaasBilling(urls);
});

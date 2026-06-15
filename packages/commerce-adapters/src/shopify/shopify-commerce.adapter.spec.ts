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

test("validateCart maps a Storefront API cart to TrustedCartSnapshot", async () => {
  const urls: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    urls.push(url);
    assert.equal((init?.method ?? "GET").toUpperCase(), "POST");
    assert.equal(url, `https://${MY_SHOP}/api/2026-04/graphql.json`);
    return Response.json({
      data: {
        cart: {
          id: "gid://shopify/Cart/cref_9",
          cost: {
            totalAmount: { amount: "64.00", currencyCode: "BRL" },
          },
          lines: {
            nodes: [
              {
                quantity: 2,
                merchandise: {
                  sku: "sku_1",
                  title: "Default Title",
                  price: { amount: "32.00", currencyCode: "BRL" },
                  product: { title: "Item" },
                },
              },
            ],
          },
        },
      },
    });
  };

  const adapter = new ShopifyCommerceAdapter(
    {
      shopDomain: `https://${MY_SHOP}/`,
      adminAccessToken: "adm_1",
      storefrontAccessToken: "storefront_1",
    },
    fetchImpl
  );
  const out = await adapter.validateCart({
    merchantId: "m1",
    commerceCartRef: "gid://shopify/Cart/cref_9",
  });

  assert.equal(out.currency, "BRL");
  assert.equal(out.totalCents, 6400);
  assert.equal(out.commerceCartRef, "gid://shopify/Cart/cref_9");
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

test("markOrderPaid completes the scoped Shopify draft order", async () => {
  const urls: string[] = [];
  let call = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    urls.push(url);
    assert.equal(init?.method, "POST");
    assert.match(url, /\/graphql\.json$/);
    const body = JSON.parse((init!.body ?? "{}") as string) as {
      query: string;
      variables: Record<string, unknown>;
    };
    assert.equal(body.variables.id, "gid://shopify/DraftOrder/77821");
    if (call++ === 0) {
      assert.match(body.query, /query AacpDraftOrder/);
      return Response.json({ data: { draftOrder: { order: null } } });
    }
    assert.match(body.query, /mutation AacpDraftOrderComplete/);
    assert.equal(body.variables.sourceName, "aacp");
    return Response.json({
      data: {
        draftOrderComplete: {
          draftOrder: {
            id: "gid://shopify/DraftOrder/77821",
            order: { id: "gid://shopify/Order/991" },
          },
          userErrors: [],
        },
      },
    });
  };

  const adapter = new ShopifyCommerceAdapter({ shopDomain: MY_SHOP, adminAccessToken: "t" }, fetchImpl);
  await adapter.markOrderPaid({
    merchantId: "m1",
    commerceOrderId: "77821",
    paymentReference: "pay_xyz"
  });
  assert.equal(call, 2);
  assertNoAsaasBilling(urls);
});

test("full mocked flow uses Storefront cart and Shopify admin order APIs", async () => {
  const urls: string[] = [];
  let step = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    urls.push(url);
    if (step === 0) {
      assert.match(url, /\/api\/2026-04\/graphql\.json$/);
      step += 1;
      return Response.json({
        data: {
          cart: {
            id: "cart_a",
            cost: {
              totalAmount: { amount: "1.00", currencyCode: "BRL" },
            },
            lines: {
              nodes: [
                {
                  quantity: 1,
                  merchandise: {
                    sku: "z",
                    title: "Default Title",
                    price: { amount: "1.00", currencyCode: "BRL" },
                    product: { title: "Z" },
                  },
                },
              ],
            },
          },
        },
      });
    }
    if (step === 1) {
      assert.ok(url.endsWith("/draft_orders.json"));
      step += 1;
      return Response.json({ draft_order: { id: 500 } });
    }
    if (step === 2) {
      assert.ok(url.includes("/graphql.json"));
      step += 1;
      return Response.json({
        data: { draftOrder: { order: null } },
      });
    }
    assert.ok(url.includes("/graphql.json"));
    step += 1;
    return Response.json({
      data: {
        draftOrderComplete: {
          draftOrder: {
            id: "gid://shopify/DraftOrder/500",
            order: { id: "gid://shopify/Order/600" },
          },
          userErrors: [],
        },
      },
    });
  };

  const adapter = new ShopifyCommerceAdapter(
    {
      shopDomain: MY_SHOP,
      adminAccessToken: "t",
      storefrontAccessToken: "storefront_t",
    },
    fetchImpl,
  );
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

  assert.equal(step, 4);
  assertNoAsaasBilling(urls);
});

test("cancelOrder resolves the real order and requests cancellation without refund", async () => {
  let call = 0;
  const fetchImpl: typeof fetch = async (_input, init) => {
    const body = JSON.parse((init?.body ?? "{}") as string) as {
      query: string;
      variables: Record<string, unknown>;
    };
    if (call++ === 0) {
      return Response.json({
        data: {
          draftOrder: {
            order: { id: "gid://shopify/Order/600" },
          },
        },
      });
    }
    assert.match(body.query, /mutation AacpOrderCancel/);
    assert.equal(body.variables.orderId, "gid://shopify/Order/600");
    assert.deepEqual(body.variables.refundMethod, {
      originalPaymentMethodsRefund: false,
    });
    assert.equal(body.variables.restock, true);
    return Response.json({
      data: {
        orderCancel: {
          job: { id: "gid://shopify/Job/1", done: false },
          orderCancelUserErrors: [],
        },
      },
    });
  };
  const adapter = new ShopifyCommerceAdapter(
    { shopDomain: MY_SHOP, adminAccessToken: "t" },
    fetchImpl,
  );

  await adapter.cancelOrder({
    merchantId: "m1",
    commerceOrderId: "500",
    reason: "Pedido cancelado pelo cliente",
    restock: true,
  });

  assert.equal(call, 2);
});

test("searchCatalog maps Shopify products and inventory in minor units", async () => {
  const fetchImpl: typeof fetch = async () =>
    Response.json({
      data: {
        shop: { currencyCode: "BRL" },
        products: {
          pageInfo: { hasNextPage: true, endCursor: "cursor_2" },
          nodes: [
            {
              id: "gid://shopify/Product/1",
              title: "Smart Hub",
              handle: "smart-hub",
              description: "Connected home hub",
              productType: "Smart Home",
              status: "ACTIVE",
              featuredMedia: {
                preview: {
                  image: { url: "https://cdn.example.com/hub.jpg" },
                },
              },
              variants: {
                nodes: [
                  {
                    id: "gid://shopify/ProductVariant/1",
                    title: "Graphite",
                    sku: "HUB-001",
                    price: "299.90",
                    inventoryQuantity: 4,
                    inventoryPolicy: "DENY",
                    image: null,
                  },
                ],
              },
            },
          ],
        },
      },
    });
  const adapter = new ShopifyCommerceAdapter(
    { shopDomain: MY_SHOP, adminAccessToken: "t" },
    fetchImpl,
  );

  const page = await adapter.searchCatalog({
    merchantId: "m1",
    query: "hub",
  });

  assert.equal(page.products[0]?.variants[0]?.unitPriceCents, 29_990);
  assert.equal(page.products[0]?.variants[0]?.availableForSale, true);
  assert.equal(page.nextCursor, "cursor_2");
});

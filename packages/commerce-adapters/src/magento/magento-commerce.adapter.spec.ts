import assert from "node:assert/strict";
import test from "node:test";
import { MagentoCommerceAdapter } from "./magento-commerce.adapter.js";

test("Magento adapter authenticates and reads catalog data", async () => {
  const seen: Array<{ url: string; authorization?: string }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    seen.push({ url, authorization: headers.get("authorization") ?? undefined });

    if (url.includes("/store/storeConfigs")) {
      return json([
        {
          id: 1,
          code: "default",
          name: "Main Store",
          base_url: "https://magento.example.com/",
          base_currency_code: "USD",
        },
      ]);
    }
    if (url.includes("/products?")) {
      return json({
        items: [
          {
            id: 123,
            sku: "KEY-001",
            name: "Mechanical Keyboard",
            type_id: "simple",
            price: 299.99,
            status: 1,
            visibility: 4,
            attribute_set_id: 4,
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-01T00:00:00Z",
            description: "<p>Professional mechanical keyboard</p>",
            url_key: "mechanical-keyboard",
            media_gallery_entries: [
              {
                id: 1,
                media_type: "image",
                label: "Product Image",
                position: 0,
                disabled: false,
                types: ["image", "small_image", "thumbnail"],
                file: "/m/e/mechanical-keyboard.jpg",
              },
            ],
            extension_attributes: {
              stock_item: {
                qty: 15,
                is_in_stock: true,
              },
              category_links: [{ position: 0, category_id: "5", name: "Electronics" }],
            },
          },
        ],
        search_criteria: {
          total_count: 1,
          page_size: 20,
          current_page: 1,
        },
      });
    }
    throw new Error(`unexpected_url_${url}`);
  };

  const adapter = new MagentoCommerceAdapter(
    {
      baseUrl: "https://magento.example.com",
      accessToken: "test_token_123",
      storeCode: "default",
    },
    fetchImpl,
  );

  const health = await adapter.testConnection();
  const catalog = await adapter.searchCatalog({
    merchantId: "mrc_1",
    query: "keyboard",
    limit: 20,
  });

  assert.equal(health.currency, "USD");
  assert.equal(health.provider, "magento");
  assert.equal(catalog.products[0]?.title, "Mechanical Keyboard");
  assert.equal(catalog.products[0]?.variants[0]?.sku, "KEY-001");
  assert.equal(catalog.products[0]?.variants[0]?.unitPriceCents, 29_999);
  assert.equal(catalog.nextCursor, null);
  assert.match(seen[1]?.authorization ?? "", /^Bearer /);
});

test("Magento adapter validates and marks cart/order", async () => {
  const calls: Array<{ url: string; body?: string }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, body: typeof init?.body === "string" ? init.body : undefined });

    if (url.includes("/guest-carts/") && url.includes("/totals")) {
      return json({
        grand_total: 120.5,
        base_grand_total: 120.5,
        subtotal: 120.5,
        base_subtotal: 120.5,
        discount_amount: 0,
        base_discount_amount: 0,
        subtotal_with_discount: 120.5,
        base_subtotal_with_discount: 120.5,
        shipping_amount: 0,
        base_shipping_amount: 0,
        tax_amount: 0,
        base_tax_amount: 0,
        weee_tax_applied_row: 0,
        quote_currency_code: "USD",
        items: [
          {
            item_id: 1,
            sku: "SKU-1",
            name: "Test Product",
            product_id: 42,
            quantity: 2,
            price: 60.25,
            product_type: "simple",
            quote_id: "cart_123",
          },
        ],
        items_qty: 2,
      });
    }

    if (url.includes("/payment-information")) {
      return json({ order_id: "100" });
    }

    throw new Error(`unexpected_url_${url}`);
  };

  const adapter = new MagentoCommerceAdapter(
    {
      baseUrl: "https://magento.example.com",
      accessToken: "test_token_123",
    },
    fetchImpl,
  );

  const cart = await adapter.validateCart({
    merchantId: "mrc_1",
    commerceCartRef: "cart_123",
  });

  const order = await adapter.createPendingOrder({
    merchantId: "mrc_1",
    sessionId: "sess_1",
    cart,
  });

  await adapter.markOrderPaid({
    merchantId: "mrc_1",
    commerceOrderId: order.commerceOrderId,
    paymentReference: "nonce_abc123",
  });

  assert.equal(cart.totalCents, 12_050);
  assert.equal(cart.lines[0]?.unitPriceCents, 6_025);
  assert.equal(cart.currency, "USD");
  assert.equal(order.commerceOrderId, "cart_123");
  assert.match(calls[1]?.body ?? "", /payment_method_nonce/);
  assert.match(calls[1]?.body ?? "", /nonce_abc123/);
});

test("Magento adapter finds product by SKU", async () => {
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);

    if (url.includes("/products?") && url.includes("sku")) {
      return json({
        items: [
          {
            id: 456,
            sku: "MOUSE-001",
            name: "Wireless Mouse",
            type_id: "simple",
            price: 49.99,
            status: 1,
            visibility: 4,
            attribute_set_id: 4,
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-01T00:00:00Z",
            media_gallery_entries: [],
            extension_attributes: {
              stock_item: { qty: 30, is_in_stock: true },
            },
          },
        ],
      });
    }

    throw new Error(`unexpected_url_${url}`);
  };

  const adapter = new MagentoCommerceAdapter(
    {
      baseUrl: "https://magento.example.com",
      accessToken: "test_token",
    },
    fetchImpl,
  );

  const product = await adapter.findCatalogProductBySku({
    merchantId: "mrc_1",
    sku: "MOUSE-001",
  });

  assert.notEqual(product, null);
  assert.equal(product?.title, "Wireless Mouse");
  assert.equal(product?.variants[0]?.sku, "MOUSE-001");
});

test("Magento adapter handles 404 on SKU lookup", async () => {
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("/products?")) {
      return new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`unexpected_url_${url}`);
  };

  const adapter = new MagentoCommerceAdapter(
    {
      baseUrl: "https://magento.example.com",
      accessToken: "test_token",
    },
    fetchImpl,
  );

  const product = await adapter.findCatalogProductBySku({
    merchantId: "mrc_1",
    sku: "NONEXISTENT",
  });

  assert.equal(product, null);
});

test("Magento adapter throws on invalid credentials", async () => {
  const fetchImpl: typeof fetch = async () => {
    return new Response(JSON.stringify({ message: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  };

  const adapter = new MagentoCommerceAdapter(
    {
      baseUrl: "https://magento.example.com",
      accessToken: "invalid_token",
    },
    fetchImpl,
  );

  try {
    await adapter.testConnection();
    assert.fail("Should have thrown");
  } catch (err) {
    assert.match(
      err instanceof Error ? err.message : String(err),
      /magento_invalid_credentials/,
    );
  }
});

test("Magento adapter rejects missing base URL", () => {
  assert.throws(() => {
    new MagentoCommerceAdapter({
      baseUrl: "",
      accessToken: "token",
    });
  }, /magento_base_url_required/);
});

test("Magento adapter rejects missing credentials", () => {
  assert.throws(() => {
    new MagentoCommerceAdapter({
      baseUrl: "https://magento.example.com",
      accessToken: "",
    });
  }, /magento_credentials_required/);
});

function json(body: unknown, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "content-type": "application/json",
      ...headers,
    },
  });
}

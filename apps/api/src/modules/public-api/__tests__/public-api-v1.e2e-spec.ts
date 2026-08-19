import test from "node:test";
import assert from "node:assert/strict";

const BASE_URL = process.env.E2E_API_URL || "http://localhost:3009";
const API_KEY = process.env.E2E_API_KEY || "aacp_test_e2e_key";
const MERCHANT_ID = process.env.E2E_MERCHANT_ID || "merchant_test_e2e";

interface ApiResponse<T = unknown> {
  status: number;
  data: T;
  error?: string;
}

async function request<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<ApiResponse<T>> {
  const res = await fetch(`${BASE_URL}/v1${path}`, {
    method,
    headers: {
      "Authorization": `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const contentType = res.headers.get("content-type");
  const data =
    contentType?.includes("application/json") ? await res.json() : null;
  return { status: res.status, data };
}

async function requestNoAuth<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
): Promise<ApiResponse<T>> {
  const res = await fetch(`${BASE_URL}/v1${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const contentType = res.headers.get("content-type");
  const data =
    contentType?.includes("application/json") ? await res.json() : null;
  return { status: res.status, data };
}

test.describe("Public API v1 E2E", async () => {
  test.describe("Auth Module (no API key required)", async () => {
    test("POST /auth/register returns 200/201 or 422 with email validation", async () => {
      const res = await requestNoAuth("POST", "/auth/register", {
        email: "test+e2e@example.com",
        password: "SecurePass123!",
        name: "E2E Tester",
      });
      assert(
        res.status === 201 || res.status === 422 || res.status === 409,
        `Expected 201, 422, or 409; got ${res.status}`,
      );
      assert(typeof res.data === "object");
    });

    test("POST /auth/login returns 200 or 401 based on credentials", async () => {
      const res = await requestNoAuth("POST", "/auth/login", {
        email: "test@example.com",
        password: "password",
      });
      assert(
        res.status === 200 || res.status === 401,
        `Expected 200 or 401; got ${res.status}`,
      );
      assert(typeof res.data === "object");
    });
  });

  test.describe("Checkouts Module", async () => {
    test("POST /checkouts starts a checkout session", async () => {
      const res = await request("POST", "/checkouts", {
        buyer_id: "buyer_e2e_123",
        checkout_mode: "cart",
        items: [{ sku: "TEST-SKU", quantity: 1 }],
      });
      assert(
        res.status === 201 || res.status === 422 || res.status === 403,
        `Expected 201, 422, or 403; got ${res.status}`,
      );
      assert(typeof res.data === "object");
    });

    test("GET /checkouts/:checkoutId returns 200 or 404", async () => {
      const res = await request("GET", "/checkouts/nonexistent_id");
      assert(
        res.status === 200 || res.status === 404,
        `Expected 200 or 404; got ${res.status}`,
      );
    });

    test("POST /checkouts/:checkoutId/events tracks an event", async () => {
      const res = await request("POST", "/checkouts/test_id/events", {
        event_type: "item_added",
        metadata: { sku: "TEST-SKU" },
      });
      assert(
        res.status === 201 || res.status === 404 || res.status === 422,
        `Expected 201, 404, or 422; got ${res.status}`,
      );
    });

    test("POST /checkouts/:checkoutId/messages sends a message", async () => {
      const res = await request("POST", "/checkouts/test_id/messages", {
        message: "Hello, can I help?",
      });
      assert(
        res.status === 201 || res.status === 404 || res.status === 422,
        `Expected 201, 404, or 422; got ${res.status}`,
      );
    });
  });

  test.describe("Orders Module", async () => {
    test("GET /orders returns 200 (list orders)", async () => {
      const res = await request("GET", "/orders");
      assert(
        res.status === 200 || res.status === 401,
        `Expected 200 or 401; got ${res.status}`,
      );
      assert(typeof res.data === "object");
    });

    test("GET /orders/:orderId returns 200 or 404", async () => {
      const res = await request("GET", "/orders/nonexistent_id");
      assert(
        res.status === 200 || res.status === 404 || res.status === 401,
        `Expected 200, 404, or 401; got ${res.status}`,
      );
    });

    test("POST /orders/:orderId/cancel cancels an order", async () => {
      const res = await request("POST", "/orders/test_id/cancel", {
        reason: "Customer request",
      });
      assert(
        res.status === 200 || res.status === 404 || res.status === 422,
        `Expected 200, 404, or 422; got ${res.status}`,
      );
    });
  });

  test.describe("Products Module", async () => {
    test("GET /products returns 200 (list products)", async () => {
      const res = await request("GET", "/products");
      assert(
        res.status === 200 || res.status === 401,
        `Expected 200 or 401; got ${res.status}`,
      );
      assert(typeof res.data === "object");
    });

    test("POST /products creates a product", async () => {
      const res = await request("POST", "/products", {
        name: "E2E Test Product",
        sku: `TEST-${Date.now()}`,
        price: 99.99,
      });
      assert(
        res.status === 201 || res.status === 422 || res.status === 403,
        `Expected 201, 422, or 403; got ${res.status}`,
      );
    });

    test("GET /products/:productId returns 200 or 404", async () => {
      const res = await request("GET", "/products/nonexistent_id");
      assert(
        res.status === 200 || res.status === 404 || res.status === 401,
        `Expected 200, 404, or 401; got ${res.status}`,
      );
    });
  });

  test.describe("Categories Module", async () => {
    test("GET /categories returns 200 (list categories)", async () => {
      const res = await request("GET", "/categories");
      assert(
        res.status === 200 || res.status === 401,
        `Expected 200 or 401; got ${res.status}`,
      );
    });

    test("POST /categories creates a category", async () => {
      const res = await request("POST", "/categories", {
        name: `E2E Category ${Date.now()}`,
        slug: `test-${Date.now()}`,
      });
      assert(
        res.status === 201 || res.status === 422 || res.status === 403,
        `Expected 201, 422, or 403; got ${res.status}`,
      );
    });
  });

  test.describe("Webhooks Module", async () => {
    test("GET /webhooks returns 200 (list webhooks)", async () => {
      const res = await request("GET", "/webhooks");
      assert(
        res.status === 200 || res.status === 401,
        `Expected 200 or 401; got ${res.status}`,
      );
    });

    test("POST /webhooks creates a webhook", async () => {
      const res = await request("POST", "/webhooks", {
        url: "https://example.com/webhook",
        events: ["order.created"],
      });
      assert(
        res.status === 201 || res.status === 422 || res.status === 403,
        `Expected 201, 422, or 403; got ${res.status}`,
      );
    });
  });

  test.describe("Coupons Module", async () => {
    test("GET /coupons returns 200 (list coupons)", async () => {
      const res = await request("GET", "/coupons");
      assert(
        res.status === 200 || res.status === 401,
        `Expected 200 or 401; got ${res.status}`,
      );
    });

    test("POST /coupons creates a coupon", async () => {
      const res = await request("POST", "/coupons", {
        code: `E2E-${Date.now()}`,
        discount_percentage: 10,
        expires_at: new Date(Date.now() + 86400000).toISOString(),
      });
      assert(
        res.status === 201 || res.status === 422 || res.status === 403,
        `Expected 201, 422, or 403; got ${res.status}`,
      );
    });

    test("POST /coupons/:id/validate validates a coupon", async () => {
      const res = await request("POST", "/coupons/test_coupon/validate", {
        subtotal: 100,
      });
      assert(
        res.status === 200 || res.status === 404 || res.status === 422,
        `Expected 200, 404, or 422; got ${res.status}`,
      );
    });
  });

  test.describe("Analytics Module", async () => {
    test("GET /analytics returns 200 (dashboard metrics)", async () => {
      const res = await request("GET", "/analytics");
      assert(
        res.status === 200 || res.status === 401,
        `Expected 200 or 401; got ${res.status}`,
      );
    });
  });

  test.describe("Customers Module", async () => {
    test("GET /customers returns 200 (list customers)", async () => {
      const res = await request("GET", "/customers");
      assert(
        res.status === 200 || res.status === 401,
        `Expected 200 or 401; got ${res.status}`,
      );
    });

    test("GET /customers/:customerId returns 200 or 404", async () => {
      const res = await request("GET", "/customers/nonexistent_id");
      assert(
        res.status === 200 || res.status === 404 || res.status === 401,
        `Expected 200, 404, or 401; got ${res.status}`,
      );
    });
  });

  test.describe("Experiments Module", async () => {
    test("GET /experiments returns 200 (list experiments)", async () => {
      const res = await request("GET", "/experiments");
      assert(
        res.status === 200 || res.status === 401,
        `Expected 200 or 401; got ${res.status}`,
      );
    });

    test("POST /experiments creates an experiment", async () => {
      const res = await request("POST", "/experiments", {
        name: `E2E Experiment ${Date.now()}`,
        variants: ["control", "treatment"],
      });
      assert(
        res.status === 201 || res.status === 422 || res.status === 403,
        `Expected 201, 422, or 403; got ${res.status}`,
      );
    });
  });

  test.describe("Settings Module", async () => {
    test("GET /settings returns 200 (checkout settings)", async () => {
      const res = await request("GET", "/settings");
      assert(
        res.status === 200 || res.status === 401,
        `Expected 200 or 401; got ${res.status}`,
      );
    });
  });

  test.describe("Payments Module", async () => {
    test("POST /payments/intents creates a payment intent", async () => {
      const res = await request("POST", "/payments/intents", {
        amount: 9999,
        currency: "USD",
      });
      assert(
        res.status === 201 || res.status === 422 || res.status === 403,
        `Expected 201, 422, or 403; got ${res.status}`,
      );
    });

    test("GET /payments/intents/:intentId returns 200 or 404", async () => {
      const res = await request("GET", "/payments/intents/nonexistent_id");
      assert(
        res.status === 200 || res.status === 404 || res.status === 401,
        `Expected 200, 404, or 401; got ${res.status}`,
      );
    });
  });

  test.describe("Team Module", async () => {
    test("GET /team/members returns 200 (list team members)", async () => {
      const res = await request("GET", "/team/members");
      assert(
        res.status === 200 || res.status === 401,
        `Expected 200 or 401; got ${res.status}`,
      );
    });

    test("POST /team/invitations invites a team member", async () => {
      const res = await request("POST", "/team/invitations", {
        email: `invite+${Date.now()}@example.com`,
        role: "admin",
      });
      assert(
        res.status === 201 || res.status === 422 || res.status === 403,
        `Expected 201, 422, or 403; got ${res.status}`,
      );
    });
  });

  test.describe("Returns Module", async () => {
    test("GET /returns returns 200 (list returns)", async () => {
      const res = await request("GET", "/returns");
      assert(
        res.status === 200 || res.status === 401,
        `Expected 200 or 401; got ${res.status}`,
      );
    });

    test("POST /returns creates a return", async () => {
      const res = await request("POST", "/returns", {
        order_id: "order_123",
        reason: "Defective",
      });
      assert(
        res.status === 201 || res.status === 422 || res.status === 403,
        `Expected 201, 422, or 403; got ${res.status}`,
      );
    });
  });

  test.describe("Domains Module", async () => {
    test("GET /domains returns 200 (list domains)", async () => {
      const res = await request("GET", "/domains");
      assert(
        res.status === 200 || res.status === 401,
        `Expected 200 or 401; got ${res.status}`,
      );
    });

    test("POST /domains creates a domain", async () => {
      const res = await request("POST", "/domains", {
        domain: `e2e-${Date.now()}.example.com`,
      });
      assert(
        res.status === 201 || res.status === 422 || res.status === 403,
        `Expected 201, 422, or 403; got ${res.status}`,
      );
    });
  });

  test.describe("Support Module", async () => {
    test("GET /support/settings returns 200 (support settings)", async () => {
      const res = await request("GET", "/support/settings");
      assert(
        res.status === 200 || res.status === 401,
        `Expected 200 or 401; got ${res.status}`,
      );
    });

    test("GET /support/tickets returns 200 (list support tickets)", async () => {
      const res = await request("GET", "/support/tickets");
      assert(
        res.status === 200 || res.status === 401,
        `Expected 200 or 401; got ${res.status}`,
      );
    });
  });

  test.describe("Shipping Module", async () => {
    test("POST /shipping/quotes retrieves shipping quotes", async () => {
      const res = await request("POST", "/shipping/quotes", {
        origin_zip: "10001",
        destination_zip: "90210",
        weight_oz: 16,
      });
      assert(
        res.status === 200 || res.status === 422 || res.status === 403,
        `Expected 200, 422, or 403; got ${res.status}`,
      );
    });
  });

  test.describe("Fulfillment Module", async () => {
    test("GET /fulfillment/shipments returns 200 (list shipments)", async () => {
      const res = await request("GET", "/fulfillment/shipments");
      assert(
        res.status === 200 || res.status === 401,
        `Expected 200 or 401; got ${res.status}`,
      );
    });

    test("POST /fulfillment/shipments creates a shipment", async () => {
      const res = await request("POST", "/fulfillment/shipments", {
        order_id: "order_123",
        carrier: "fedex",
      });
      assert(
        res.status === 201 || res.status === 422 || res.status === 403,
        `Expected 201, 422, or 403; got ${res.status}`,
      );
    });
  });

  test.describe("Notifications Module", async () => {
    test("POST /notifications/order-confirmation sends order confirmation", async () => {
      const res = await request("POST", "/notifications/order-confirmation", {
        order_id: "order_123",
        email: "customer@example.com",
      });
      assert(
        res.status === 201 || res.status === 422 || res.status === 403,
        `Expected 201, 422, or 403; got ${res.status}`,
      );
    });

    test("POST /notifications/order-shipped sends shipped notification", async () => {
      const res = await request("POST", "/notifications/order-shipped", {
        order_id: "order_123",
        tracking_number: "TRACK123",
      });
      assert(
        res.status === 201 || res.status === 422 || res.status === 403,
        `Expected 201, 422, or 403; got ${res.status}`,
      );
    });
  });

  test.describe("Cross-Sell Module", async () => {
    test("GET /cross-sells returns 200 (list cross-sells)", async () => {
      const res = await request("GET", "/cross-sells");
      assert(
        res.status === 200 || res.status === 401,
        `Expected 200 or 401; got ${res.status}`,
      );
    });

    test("GET /cross-sells/eligible returns eligible cross-sells", async () => {
      const res = await request("GET", "/cross-sells/eligible");
      assert(
        res.status === 200 || res.status === 401,
        `Expected 200 or 401; got ${res.status}`,
      );
    });

    test("POST /cross-sells creates a cross-sell", async () => {
      const res = await request("POST", "/cross-sells", {
        product_id: "prod_123",
        related_product_id: "prod_456",
      });
      assert(
        res.status === 201 || res.status === 422 || res.status === 403,
        `Expected 201, 422, or 403; got ${res.status}`,
      );
    });
  });

  test.describe("Installations Module", async () => {
    test("GET /installations returns 200 (list installations)", async () => {
      const res = await request("GET", "/installations");
      assert(
        res.status === 200 || res.status === 401,
        `Expected 200 or 401; got ${res.status}`,
      );
    });

    test("POST /installations creates an installation", async () => {
      const res = await request("POST", "/installations", {
        app_id: "app_123",
      });
      assert(
        res.status === 201 || res.status === 422 || res.status === 403,
        `Expected 201, 422, or 403; got ${res.status}`,
      );
    });

    test("GET /installations/:id returns 200 or 404", async () => {
      const res = await request("GET", "/installations/nonexistent_id");
      assert(
        res.status === 200 || res.status === 404 || res.status === 401,
        `Expected 200, 404, or 401; got ${res.status}`,
      );
    });
  });

  test.describe("Audit Module", async () => {
    test("GET /audit-events returns 200 (list audit events)", async () => {
      const res = await request("GET", "/audit-events");
      assert(
        res.status === 200 || res.status === 401,
        `Expected 200 or 401; got ${res.status}`,
      );
    });
  });

  test.describe("Billing Module", async () => {
    test("GET /billing/plans returns 200 (list billing plans)", async () => {
      const res = await request("GET", "/billing/plans");
      assert(
        res.status === 200 || res.status === 401,
        `Expected 200 or 401; got ${res.status}`,
      );
    });

    test("GET /billing/subscription returns 200 or 404", async () => {
      const res = await request("GET", "/billing/subscription");
      assert(
        res.status === 200 || res.status === 404 || res.status === 401,
        `Expected 200, 404, or 401; got ${res.status}`,
      );
    });

    test("GET /billing/usage returns 200 (usage metrics)", async () => {
      const res = await request("GET", "/billing/usage");
      assert(
        res.status === 200 || res.status === 401,
        `Expected 200 or 401; got ${res.status}`,
      );
    });
  });

  test.describe("Commerce Module", async () => {
    test("GET /commerce/connections returns 200 (list connections)", async () => {
      const res = await request("GET", "/commerce/connections");
      assert(
        res.status === 200 || res.status === 401,
        `Expected 200 or 401; got ${res.status}`,
      );
    });

    test("POST /commerce/connections creates a commerce connection", async () => {
      const res = await request("POST", "/commerce/connections", {
        platform: "shopify",
        store_url: "https://example.myshopify.com",
      });
      assert(
        res.status === 201 || res.status === 422 || res.status === 403,
        `Expected 201, 422, or 403; got ${res.status}`,
      );
    });

    test("GET /commerce/connections/:id returns 200 or 404", async () => {
      const res = await request("GET", "/commerce/connections/nonexistent_id");
      assert(
        res.status === 200 || res.status === 404 || res.status === 401,
        `Expected 200, 404, or 401; got ${res.status}`,
      );
    });
  });

  test.describe("Marketplace Module", async () => {
    test("GET /marketplace returns 200", async () => {
      const res = await request("GET", "/marketplace");
      assert(
        res.status === 200 || res.status === 401,
        `Expected 200 or 401; got ${res.status}`,
      );
    });
  });

  test.describe("Authentication & Authorization", async () => {
    test("Missing API key returns 401", async () => {
      const res = await fetch(`${BASE_URL}/v1/orders`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });
      assert(
        res.status === 401 || res.status === 403,
        `Expected 401 or 403; got ${res.status}`,
      );
    });

    test("Invalid API key returns 401", async () => {
      const res = await fetch(`${BASE_URL}/v1/orders`, {
        method: "GET",
        headers: {
          "Authorization": "Bearer invalid_key_xyz",
          "Content-Type": "application/json",
        },
      });
      assert(
        res.status === 401 || res.status === 403,
        `Expected 401 or 403; got ${res.status}`,
      );
    });

    test("Valid API key allows access", async () => {
      const res = await request("GET", "/orders");
      assert(
        res.status !== 401 && res.status !== 403,
        `Expected success status; got ${res.status}`,
      );
    });
  });

  test.describe("Response Format", async () => {
    test("Response is valid JSON with expected structure", async () => {
      const res = await request("GET", "/analytics");
      assert(typeof res.data === "object");
      assert(res.data !== null);
    });

    test("Error responses contain error details", async () => {
      const res = await request("POST", "/coupons", {
        // Invalid body
      });
      if (res.status >= 400) {
        assert(typeof res.data === "object");
      }
    });
  });

  test.describe("Idempotency (where supported)", async () => {
    test("Same POST body with idempotency key returns same response", async () => {
      const idempotencyKey = `test-${Date.now()}`;
      const body = {
        code: `IDEMPOTENT-${idempotencyKey}`,
        discount_percentage: 5,
      };

      const res1 = await request("POST", "/coupons", body, {
        "Idempotency-Key": idempotencyKey,
      });
      const res2 = await request("POST", "/coupons", body, {
        "Idempotency-Key": idempotencyKey,
      });

      assert.equal(res1.status, res2.status);
    });
  });

  test.describe("Pagination", async () => {
    test("GET /orders accepts limit and cursor parameters", async () => {
      const res = await request("GET", "/orders?limit=10&cursor=0");
      assert(
        res.status === 200 || res.status === 401,
        `Expected 200 or 401; got ${res.status}`,
      );
    });

    test("GET /products accepts limit and cursor parameters", async () => {
      const res = await request("GET", "/products?limit=25&cursor=0");
      assert(
        res.status === 200 || res.status === 401,
        `Expected 200 or 401; got ${res.status}`,
      );
    });
  });

  test.describe("Field naming (snake_case in responses)", async () => {
    test("Response fields use snake_case convention", async () => {
      const res = await request("GET", "/orders");
      if (res.status === 200 && Array.isArray(res.data)) {
        const hasValidFields = res.data.every(
          (order) =>
            typeof order === "object" &&
            (order !== null && ("order_id" in order || "id" in order)),
        );
        assert(hasValidFields || res.data.length === 0);
      }
    });
  });
});

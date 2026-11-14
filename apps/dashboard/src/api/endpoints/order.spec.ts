import { expect, test } from "vitest";
import { orderEndpoints } from "./order.js";

test("loads the authenticated order detail and timeline through the tenant order endpoint", async () => {
  const requests: Array<{ url: string; method?: string; credentials?: RequestCredentials }> = [];
  const detail = {
    id: "order/123",
    session_id: "session_1",
    external_order_id: "ORDER-123",
    status: "shipped",
    total: 19990,
    currency: "BRL",
    tracking_code: "BR123",
    customer: null,
    cart: {},
    completed_at: "2026-09-10T10:00:00.000Z",
    cancelled_at: null,
    cancellation_reason: null,
    payment_method: "pix",
    payment_provider: "asaas",
    paid_at: "2026-09-10T10:01:00.000Z",
    timeline: [{
      id: "tracking-1",
      type: "tracking",
      status: "in_transit",
      description: "Em trânsito",
      occurredAt: "2026-09-10T12:00:00.000Z",
      data: { location: "São Paulo, SP" },
    }],
  };
  const api = orderEndpoints(
    "https://api.example.test/",
    (async (input, init) => {
      requests.push({
        url: String(input),
        method: init?.method,
        credentials: init?.credentials,
      });
      return new Response(JSON.stringify(detail), {
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch,
  );

  await expect(api.getOrderDetail("order/123")).resolves.toEqual(detail);
  expect(requests).toEqual([{
    url: "https://api.example.test/v1/orders/order%2F123",
    method: "GET",
    credentials: "include",
  }]);
});

test("submits a shipping label purchase with the supplied idempotency key", async () => {
  const requests: Array<{ url: string; method?: string; body?: string | null; idempotencyKey?: string | null; credentials?: RequestCredentials }> = [];
  const api = orderEndpoints(
    "https://api.example.test/",
    (async (input, init) => {
      const headers = new Headers(init?.headers);
      requests.push({
        url: String(input),
        method: init?.method,
        body: init?.body as string | null | undefined,
        idempotencyKey: headers.get("Idempotency-Key"),
        credentials: init?.credentials,
      });
      return new Response(JSON.stringify({
        purchase_id: "purchase_123",
        tracking_code: "ME123456789BR",
        label_url: "https://label.example.test/purchase_123.pdf",
      }), { headers: { "Content-Type": "application/json" } });
    }) as typeof fetch,
  );

  await expect(api.purchaseShippingLabel({
    order_id: "external-order-123",
    service_id: 1,
    from_zip: "01001-000",
    to_zip: "01310-100",
    to_name: "Maria Silva",
    to_document: "12345678900",
    packages: [{ weightKg: 1, widthCm: 20, heightCm: 10, lengthCm: 30, quantity: 1 }],
  }, "dashboard_shipping_label_attempt_123")).resolves.toEqual({
    purchase_id: "purchase_123",
    tracking_code: "ME123456789BR",
    label_url: "https://label.example.test/purchase_123.pdf",
  });

  expect(requests).toEqual([{
    url: "https://api.example.test/v1/shipping/labels",
    method: "POST",
    body: JSON.stringify({
      order_id: "external-order-123",
      service_id: 1,
      from_zip: "01001-000",
      to_zip: "01310-100",
      to_name: "Maria Silva",
      to_document: "12345678900",
      packages: [{ weightKg: 1, widthCm: 20, heightCm: 10, lengthCm: 30, quantity: 1 }],
    }),
    idempotencyKey: "dashboard_shipping_label_attempt_123",
    credentials: "include",
  }]);
});

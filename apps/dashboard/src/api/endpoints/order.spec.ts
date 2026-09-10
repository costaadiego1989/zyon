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

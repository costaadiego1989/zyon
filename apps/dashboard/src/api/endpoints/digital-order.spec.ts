import { expect, test } from "vitest";
import { orderEndpoints } from "./order.js";

test("digital status and retry use encoded tenant-scoped routes and the authenticated session", async () => {
  const seen: Array<{ url: string; method?: string; credentials?: RequestCredentials }> = [];
  const api = orderEndpoints("https://api.example.test", (async (url, init) => {
    seen.push({ url: String(url), method: init?.method, credentials: init?.credentials });
    return new Response(JSON.stringify({ products: [], status: "queued" }), { headers: { "Content-Type": "application/json" } });
  }) as typeof fetch);
  await api.getDigitalOrderAccess("merchant/1", "order/2");
  await api.retryDigitalDelivery("merchant/1", "delivery/3");
  expect(seen).toEqual([
    { url: "https://api.example.test/v1/merchants/merchant%2F1/orders/order%2F2/digital-access", method: "GET", credentials: "include" },
    { url: "https://api.example.test/v1/merchants/merchant%2F1/digital-deliveries/delivery%2F3/retry", method: "POST", credentials: "include" },
  ]);
});

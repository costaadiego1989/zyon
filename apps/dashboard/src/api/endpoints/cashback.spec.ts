import { expect, it } from "vitest";
import { cashbackEndpoints } from "./cashback.js";

it("CB-18 sends customer filters and pagination to the merchant-authenticated server without client merchant scope", async () => {
  let url = "";
  const api = cashbackEndpoints("https://api.example.test", (async input => {
    url = String(input); return new Response(JSON.stringify({ items: [], total: 0, page: 2, pageSize: 10 }));
  }) as typeof fetch);
  await api.getCashbackCustomers({ q: "Ana + B", filter: "never_used", page: 2, pageSize: 10 });
  const query = new URL(url);
  expect(query.pathname).toBe("/v1/dashboard/cashback/customers");
  expect(Object.fromEntries(query.searchParams)).toEqual({ q: "Ana + B", filter: "never_used", page: "2", pageSize: "10" });
  expect(query.searchParams.has("merchantId")).toBe(false);
});

it("CB-22 preserves the signed adjustment, explicit null expiry and retry key while encoding the buyer path", async () => {
  let requestUrl = "", payload: unknown, retryKey: string | null = null;
  const api = cashbackEndpoints("https://api.example.test", (async (input, init) => {
    requestUrl = String(input); payload = JSON.parse(String(init?.body)); retryKey = new Headers(init?.headers).get("Idempotency-Key");
    return new Response("{}");
  }) as typeof fetch);
  const adjustment = { amountCents: 1250, reason: "Correção autorizada do pedido", idempotencyKey: "cashback-retry-1", expiryDays: null };
  await api.adjustCashbackCustomer("buyer/a", adjustment);
  expect(requestUrl).toBe("https://api.example.test/v1/dashboard/cashback/customers/buyer%2Fa/adjustments");
  expect(payload).toEqual(adjustment); expect(retryKey).toBe("cashback-retry-1");
});

it("CB-18 exports the selected dataset and filters through authenticated fetch and reports an HTTP failure", async () => {
  const requests: string[] = [];
  const api = cashbackEndpoints("https://api.example.test", (async input => {
    requests.push(String(input)); return new Response("data,valor\ncliente,1", { headers: { "Content-Type": "text/csv" } });
  }) as typeof fetch);
  const blob = await api.exportCashback({ kind: "customers", q: "Ana", filter: "used" });
  expect(await blob.text()).toBe("data,valor\ncliente,1");
  expect(Object.fromEntries(new URL(requests[0]).searchParams)).toEqual({ kind: "customers", q: "Ana", filter: "used" });
  const denied = cashbackEndpoints("https://api.example.test", (async () => new Response("denied", { status: 403 })) as typeof fetch);
  await expect(denied.exportCashback({ kind: "transactions" })).rejects.toMatchObject({ status: 403 });
});

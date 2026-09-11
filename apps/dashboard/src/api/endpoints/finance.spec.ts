import { expect, test } from "vitest";
import { financeEndpoints } from "./finance.js";

test("loads payment allocation history through the tenant-scoped finance endpoint", async () => {
  const requests: Array<{ url: string; method?: string; credentials?: RequestCredentials }> = [];
  const api = financeEndpoints(
    "https://api.example.test/",
    (async (input, init) => {
      requests.push({ url: String(input), method: init?.method, credentials: init?.credentials });
      return new Response(JSON.stringify({
        payment_intent_id: "intent/123",
        scope_note: "Histórico de alocações; não representa saldo disponível.",
        snapshots: [],
      }), { headers: { "Content-Type": "application/json" } });
    }) as typeof fetch,
  );

  await expect(api.getPaymentAllocationHistory("intent/123")).resolves.toMatchObject({
    payment_intent_id: "intent/123",
    snapshots: [],
  });
  expect(requests).toEqual([{
    url: "https://api.example.test/v1/dashboard/finance/payment-intents/intent%2F123/allocation-history",
    method: "GET",
    credentials: "include",
  }]);
});

test("loads delayed merchant payout status through the finance endpoint", async () => {
  const requests: Array<{ url: string; method?: string; credentials?: RequestCredentials }> = [];
  const api = financeEndpoints(
    "https://api.example.test/",
    (async (input, init) => {
      requests.push({ url: String(input), method: init?.method, credentials: init?.credentials });
      return new Response(JSON.stringify({ generated_at: "2026-09-11T00:00:00.000Z", currency: "BRL", scope_note: "Repasse protegido", items: [] }), { headers: { "Content-Type": "application/json" } });
    }) as typeof fetch,
  );

  await expect(api.getMerchantPayouts()).resolves.toMatchObject({ currency: "BRL", items: [] });
  expect(requests).toEqual([{
    url: "https://api.example.test/v1/dashboard/finance/payouts",
    method: "GET",
    credentials: "include",
  }]);
});

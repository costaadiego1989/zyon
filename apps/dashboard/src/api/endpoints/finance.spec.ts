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

import { expect, test } from "vitest";
import { merchantEndpoints } from "./merchants.js";

test("submits product feedback through the authenticated merchant endpoint", async () => {
  const requests: Array<{ url: string; method?: string; body?: string | null; credentials?: RequestCredentials }> = [];
  const api = merchantEndpoints(
    "https://api.example.test/",
    (async (input, init) => {
      requests.push({
        url: String(input),
        method: init?.method,
        body: typeof init?.body === "string" ? init.body : null,
        credentials: init?.credentials,
      });
      return new Response(JSON.stringify({
        id: "feedback_1",
        category: "bug",
        createdAt: "2026-09-13T12:00:00.000Z",
      }), { headers: { "Content-Type": "application/json" } });
    }) as typeof fetch,
  );

  await expect(api.submitPlatformFeedback({
    category: "bug",
    message: "A imagem não aparece no catálogo.",
  })).resolves.toEqual({
    id: "feedback_1",
    category: "bug",
    createdAt: "2026-09-13T12:00:00.000Z",
  });

  expect(requests).toEqual([{
    url: "https://api.example.test/v1/merchants/me/platform-feedback",
    method: "POST",
    body: '{"category":"bug","message":"A imagem não aparece no catálogo."}',
    credentials: "include",
  }]);
});

test("lists, creates and activates stores through merchant-scoped endpoints", async () => {
  const requests: Array<{ url: string; method?: string; body?: string | null }> = [];
  const api = merchantEndpoints(
    "https://api.example.test/",
    (async (input, init) => {
      const url = String(input);
      requests.push({ url, method: init?.method, body: typeof init?.body === "string" ? init.body : null });
      const payload = url.endsWith("/stores") && init?.method === "GET"
        ? { data: [{ id: "store_1", name: "Loja principal", slug: "principal", role: "owner" }] }
        : url.endsWith("/stores")
          ? { id: "store_2", name: "Nova loja", slug: "nova-loja", role: "owner" }
          : { merchant_id: "store_2" };
      return new Response(JSON.stringify(payload), { headers: { "Content-Type": "application/json" } });
    }) as typeof fetch,
  );

  await expect(api.listMerchantStores()).resolves.toEqual([
    { id: "store_1", name: "Loja principal", slug: "principal", role: "owner" },
  ]);
  await expect(api.createMerchantStore({ name: "Nova loja", slug: "nova-loja" })).resolves.toEqual(
    { id: "store_2", name: "Nova loja", slug: "nova-loja", role: "owner" },
  );
  await expect(api.activateMerchantStore("store_2")).resolves.toEqual({ merchant_id: "store_2" });
  expect(requests).toEqual([
    { url: "https://api.example.test/v1/merchants/me/stores", method: "GET", body: null },
    { url: "https://api.example.test/v1/merchants/me/stores", method: "POST", body: '{"name":"Nova loja","slug":"nova-loja"}' },
    { url: "https://api.example.test/v1/merchants/me/stores/store_2/activate", method: "POST", body: "{}" },
  ]);
});

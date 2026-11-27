import { expect, test } from "vitest";
import { merchantEndpoints } from "./merchants.js";

test.each([false, true])("maps the authenticated profile actor from the current API (wrapped=%s)", async (wrapped) => {
  const profile = { id: "merchant-1", name: "Loja", role: "owner", userId: "actor-1" };
  const api = merchantEndpoints("https://api.example.test", (async () =>
    new Response(JSON.stringify(wrapped ? { data: profile } : profile))) as typeof fetch);

  await expect(api.merchantProfile()).resolves.toEqual({ ...profile, role: "OWNER", user_id: "actor-1" });
});

test("retains the legacy authenticated actor without substituting the merchant identity", async () => {
  const profile = { id: "merchant-1", name: "Loja", role: "staff", user_id: "actor-2" };
  const api = merchantEndpoints("https://api.example.test", (async () =>
    new Response(JSON.stringify(profile))) as typeof fetch);

  await expect(api.merchantProfile()).resolves.toEqual({ ...profile, role: "STAFF" });
});

test("maps team member API identities and joined_at for the dashboard", async () => {
  const api = merchantEndpoints("https://api.example.test", (async () => new Response(JSON.stringify({ members: [
    { member_id: "membership-1", user_id: "user-1", email: "owner@example.test", role: "OWNER", joined_at: "2026-11-16T12:00:00Z" },
  ], total: 1 }))) as typeof fetch);
  await expect(api.listTeam("merchant-1")).resolves.toEqual({ members: [
    { id: "membership-1", userId: "user-1", email: "owner@example.test", role: "OWNER", joinedAt: "2026-11-16T12:00:00Z" },
  ], invites: [] });
});

test("preserves existing dashboard team member responses and absent dates", async () => {
  const api = merchantEndpoints("https://api.example.test", (async () => new Response(JSON.stringify({ members: [
    { id: "membership-2", userId: "user-2", email: "staff@example.test", role: "STAFF", joinedAt: null },
  ], invites: [] }))) as typeof fetch);
  await expect(api.listTeam("merchant-2")).resolves.toEqual({ members: [
    { id: "membership-2", userId: "user-2", email: "staff@example.test", role: "STAFF", joinedAt: null },
  ], invites: [] });
});

test("preserves a non-null camel-case team member joined date exactly", async () => {
  const member = { id: "membership-valid", userId: "user-valid", email: "admin@example.test", role: "ADMIN", joinedAt: "2024-02-29T12:00:00Z" };
  const api = merchantEndpoints("https://api.example.test", (async () => new Response(JSON.stringify({ members: [member], invites: [] }))) as typeof fetch);
  await expect(api.listTeam("merchant-valid")).resolves.toEqual({ members: [member], invites: [] });
});

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

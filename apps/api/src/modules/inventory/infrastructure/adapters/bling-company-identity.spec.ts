import assert from "node:assert/strict";
import test from "node:test";
import { fetchBlingCompanyId } from "./bling-company-identity.js";

test("Bling webhook routing uses the canonical company identity endpoint", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let request: RequestInfo | URL | undefined;
  globalThis.fetch = async (input) => {
    request = input;
    return new Response(JSON.stringify({ data: { id: "company_from_bling" } }), { status: 200 });
  };

  assert.equal(await fetchBlingCompanyId("access-token"), "company_from_bling");
  assert.equal(request, "https://api.bling.com.br/Api/v3/empresas/me/dados-basicos");
});

test("Bling webhook routing rejects a response without the canonical company ID", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => new Response(JSON.stringify({ data: {} }), { status: 200 });

  await assert.rejects(() => fetchBlingCompanyId("access-token"), /bling_company_identity_missing/);
});

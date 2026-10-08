import { test } from "node:test";
import assert from "node:assert/strict";
import { MelhorEnvioCarrierAdapter } from "./melhor-envio.carrier.js";

const labelId = "c5900ccd-8a4f-4c47-8172-85e4f69d3470", userId = "a5900ccd-8a4f-4c47-8172-85e4f69d3470";
const identity = { version: 1 as const, provider: "melhor-envio" as const, environment: "test" as const, originMerchantId: "host", providerUserId: userId };
async function scenario(options: { rotated?: boolean; posted?: boolean; ackOnly?: boolean; submit?: boolean; missing?: boolean } = {}) {
  const priorFetch = globalThis.fetch, priorBase = process.env.MELHOR_ENVIO_BASE_URL;
  process.env.MELHOR_ENVIO_BASE_URL = "https://sandbox.melhorenvio.com.br";
  const requests: Array<{ method: string; path: string; body: any }> = []; let canceled = false;
  globalThis.fetch = async (url: any, init: any) => {
    const path = new URL(String(url)).pathname; requests.push({ path, method: init.method, body: init.body ? JSON.parse(init.body) : undefined });
    if (path === "/api/v2/me") return Response.json({ id: options.rotated ? labelId : userId });
    if (path.endsWith("/cancellable")) return Response.json({ [labelId]: { cancellable: true } });
    if (path.endsWith("/cancel")) { canceled = !options.ackOnly; return Response.json({ canceled: true }); }
    return Response.json({ id: labelId, status: canceled ? "canceled" : options.posted ? "posted" : "released",
      paid_at: "2026-10-01T15:00:00Z", posted_at: options.posted ? "2026-10-01T17:00:00Z" : null, delivered_at: null,
      canceled_at: canceled ? "2026-10-07T15:00:00Z" : null, conciliation: null });
  };
  try {
    const carrier = new MelhorEnvioCarrierAdapter({ resolveToken: async (merchantId, scope) => {
      assert.equal(merchantId, "host"); assert.deepEqual(scope, { allowPlatformFallback: false }); return options.missing ? undefined : "test-only-token";
    } });
    const result = await carrier.cancelLabel({ merchantId: "host", carrierOrderId: labelId, accountIdentity: identity, submit: options.submit ?? true });
    return { result, requests };
  } finally { globalThis.fetch = priorFetch; if (priorBase === undefined) delete process.env.MELHOR_ENVIO_BASE_URL; else process.env.MELHOR_ENVIO_BASE_URL = priorBase; }
}
test("native cancellation binds original OAuth account, checks eligibility and confirms by GET", async () => {
  const { result, requests } = await scenario(); assert.equal(result.status, "canceled"); assert.equal(result.walletRefundStatus, "unproven");
  assert.equal(requests.filter(row => row.path.endsWith("/cancel")).length, 1);
  assert.deepEqual(requests.find(row => row.path.endsWith("/cancel"))?.body, { order: { id: labelId, reason_id: "2", description: "Cancelamento por devolucao aprovada do pedido" } });
  assert.equal(requests.at(-1)?.method, "GET");
});
test("POST acknowledgement alone cannot claim cancellation or wallet credit", async () => {
  const { result } = await scenario({ ackOnly: true }); assert.equal(result.status, "unknown"); assert.equal(result.walletRefundStatus, "unproven");
});
test("OAuth rotation, missing own credentials and posted labels cannot trigger cancellation", async () => {
  for (const options of [{ rotated: true }, { missing: true }, { posted: true }]) {
    const { result, requests } = await scenario(options); assert.notEqual(result.status, "canceled");
    assert.equal(requests.filter(row => row.path.endsWith("/cancel")).length, 0);
  }
});
test("uncertain cancellation recovery uses GET only", async () => {
  const { result, requests } = await scenario({ submit: false }); assert.equal(result.status, "unknown");
  assert.equal(requests.filter(row => row.method === "POST").length, 0);
});

import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createJourneyProviderModule } from "./storefront-journey-provider-module.mjs";
import { verifyJourneyPreflight } from "./storefront-journey-guards.mjs";
import { createStorefrontJourneyTransport } from "./storefront-journey-transport.mjs";
import { SANDBOX_LLM_APPROVAL } from "./storefront-sandbox-llm-budget.mjs";

// Metadata/binding contracts ONLY, no Nest init/HTTP/SQL/Redis/provider calls.
// Capabilities below deliberately use verifier doubles, not actual auth proof.
async function unitCapability() {
  const manifest = { version: 1, runId: randomUUID(), merchantId: randomUUID(), buyerId: randomUUID(), sessionId: `conv_${randomUUID()}`,
    apiOrigin: "http://127.0.0.1:19987", postgresRunId: randomUUID(), redisRunId: randomUUID(), postgresPort: 19985, redisPort: 19986 };
  const principal = { runId: manifest.runId, merchantId: manifest.merchantId, buyerId: manifest.buyerId, sessionId: manifest.sessionId };
  return verifyJourneyPreflight({ manifest, principalToken: "explicit-unit-double-only", verifyPrincipal: async () => principal,
    verifyResources: async () => ({ ...principal, apiOrigin: manifest.apiOrigin, postgresRunId: manifest.postgresRunId,
      redisRunId: manifest.redisRunId, postgresPort: manifest.postgresPort, redisPort: manifest.redisPort }) });
}
test("global test module exports exactly approved optional provider token, no repo/auth replacement", async () => {
  const binding = await createJourneyProviderModule("dist-test");
  const providers = Reflect.getMetadata("providers", binding.module), exports = Reflect.getMetadata("exports", binding.module);
  assert.equal(providers.length, 1); assert.deepEqual(exports, [providers[0].provide]);
  assert.equal(Reflect.getMetadata("__module:global__", binding.module), true);
  assert.equal(Reflect.getMetadata("imports", binding.module), undefined);
  assert.equal(typeof providers[0].useValue, "function");
  await assert.rejects(providers[0].useValue("primary")("https://must-not-send.invalid"), /journey_verified_transport_not_installed/);
});
test("binding needs opaque preflight capability and cannot retry after failed verification", async () => {
  const binding = await createJourneyProviderModule("dist-test");
  await assert.rejects(binding.bindVerifiedTransport({ capability: { trusted: true }, transport: {} }), /journey_capability_required/);
  await assert.rejects(binding.bindVerifiedTransport({ capability: await unitCapability(), transport: { fetchFactory() {}, runOperation() {} } }), /journey_transport_binding_is_single_use/);
});
test("factory is lazy until verified transport and binds exactly once", async () => {
  const binding = await createJourneyProviderModule("dist-test"), calls = [];
  const factory = Reflect.getMetadata("providers", binding.module)[0].useValue;
  const fetchBeforeBinding = factory("primary");
  const capability = await unitCapability();
  const transport = createStorefrontJourneyTransport({ capability, record() {}, budget: { status: () => SANDBOX_LLM_APPROVAL,
    fetchForStep: () => async () => { calls.push("primary"); return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "{}" } }] })); } } });
  await binding.bindVerifiedTransport({ capability, transport });
  await transport.runOperation({ operationId: randomUUID(), stage: "turn" }, () => fetchBeforeBinding(SANDBOX_LLM_APPROVAL.endpoint,
    { method: "POST", body: JSON.stringify({ response_format: { type: "json_object" } }) }));
  assert.deepEqual(calls, ["primary"]);
  await assert.rejects(binding.bindVerifiedTransport({ capability, transport }), /journey_transport_binding_is_single_use/);
  assert.throws(() => factory("hidden-client"), /journey_provider_channel_invalid/);
});

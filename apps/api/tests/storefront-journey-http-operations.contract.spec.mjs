import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID, randomBytes } from "node:crypto";
import { createJourneyHttpOperations } from "./storefront-journey-http-operations.mjs";
import { journeyArtifactModuleUrl } from "./storefront-journey-canonical-bindings.mjs";
import { verifyJourneyPreflight } from "./storefront-journey-guards.mjs";
import { createStorefrontJourneyTransport } from "./storefront-journey-transport.mjs";
import { SANDBOX_LLM_APPROVAL } from "./storefront-sandbox-llm-budget.mjs";

// REAL loopback HTTP and canonical signature classes. Resources and provider
// budget below are declared doubles, NOT actual SQL/Redis/DeepSeek proof.
async function fixture(work, { providerFailure = false, swallowProviderFailure = false } = {}) {
  const [{ BuyerJwtService }, { RealtimeCapabilityService }] = await Promise.all([
    import(journeyArtifactModuleUrl("dist-test", "modules/buyer-account/domain/services/buyer-jwt.service")),
    import(journeyArtifactModuleUrl("dist-test", "shared/auth/realtime-capability")),
  ]);
  let bridge, handlerCalls = 0, providerCalls = 0, lateResult;
  const late = new Promise(resolve => { lateResult = resolve; });
  const server = createServer((req, res) => bridge.middleware(req, res, () => {
    handlerCalls++;
    // Use setImmediate to demonstrate real server async context, not direct call.
    setImmediate(async () => {
      try {
        await transport.fetchFactory("primary")(SANDBOX_LLM_APPROVAL.endpoint, {
          method: "POST", body: JSON.stringify({ response_format: { type: "json_object" }, messages: [] }),
        });
        res.setHeader("content-type", "application/json"); res.end('{"ok":true}');
        setImmediate(async () => {
          try {
            await transport.fetchFactory("primary")(SANDBOX_LLM_APPROVAL.endpoint, {
              method: "POST", body: JSON.stringify({ response_format: { type: "json_object" }, messages: [{ content: "late" }] }),
            });
            lateResult("unexpected_provider_permit");
          } catch (error) { lateResult(error.message); }
        });
      } catch { res.statusCode = swallowProviderFailure ? 200 : 500; res.end('{"code":"controlled_failure"}'); }
    });
  }));
  await new Promise(resolve => server.listen({ host: "127.0.0.1", port: 0, exclusive: true }, resolve));
  const apiOrigin = `http://127.0.0.1:${server.address().port}`;
  const manifest = { version: 1, runId: randomUUID(), merchantId: randomUUID(), buyerId: randomUUID(), sessionId: `conv_${randomUUID()}`,
    apiOrigin, postgresRunId: randomUUID(), redisRunId: randomUUID(), postgresPort: 19985, redisPort: 19986 };
  const principal = { runId: manifest.runId, merchantId: manifest.merchantId, buyerId: manifest.buyerId, sessionId: manifest.sessionId };
  const capability = await verifyJourneyPreflight({ manifest, principalToken: "unit-resource-double-only", verifyPrincipal: async () => principal,
    verifyResources: async () => ({ ...principal, apiOrigin, postgresRunId: manifest.postgresRunId, redisRunId: manifest.redisRunId,
      postgresPort: manifest.postgresPort, redisPort: manifest.redisPort }) });
  const buyerJwt = new BuyerJwtService(randomBytes(48).toString("base64url"), 600), capabilities = new RealtimeCapabilityService(randomBytes(48).toString("base64url"));
  const headers = { origin: apiOrigin, authorization: `Bearer ${capabilities.issue({ purpose: "storefront-conversation", merchantId: manifest.merchantId,
    resourceId: manifest.sessionId, origin: apiOrigin, aiUserId: `buyer:${manifest.buyerId}` }).token}`,
    "x-buyer-authorization": `Bearer ${buyerJwt.sign({ globalUserId: manifest.buyerId, merchantId: manifest.merchantId, email: "synthetic@example.invalid" })}` };
  const transport = createStorefrontJourneyTransport({ capability, record() {}, budget: { status: () => SANDBOX_LLM_APPROVAL,
    fetchForStep: () => async () => { providerCalls++; if (providerFailure) throw Error("unit_provider_failure");
      return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: '{"ok":true}' } }] })); } } });
  try {
    bridge = await createJourneyHttpOperations({ capability, transport, buyerJwt, capabilities, listener: server, artifactTree: "dist-test", routePrefix: "" });
    await work({ bridge, headers, apiOrigin, path: `/storefront/conversations/${manifest.sessionId}/messages`,
      counts: () => ({ handlerCalls, providerCalls }), late: () => late,
      foreignBuyerToken: buyerJwt.sign({ globalUserId: randomUUID(), merchantId: manifest.merchantId, email: "foreign-synthetic@example.invalid" }) });
  } finally {
    if (bridge) bridge.dispose();
    server.closeAllConnections(); await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}
test("real HTTP callback reopens operation context through a private one-shot slot", async () => fixture(async f => {
  const operationId = randomUUID(), slot = await f.bridge.register({ operationId, stage: "turn" });
  const response = await fetch(f.apiOrigin + f.path, { method: "POST", headers: { ...f.headers, "x-aacp-journey-slot": slot } });
  assert.equal(response.status, 200); await response.text();
  assert.deepEqual(await f.bridge.waitForOperation(operationId), { outcome: "completed", code: "none" });
  assert.deepEqual(f.counts(), { handlerCalls: 1, providerCalls: 1 });
  assert.equal(await f.late(), "journey_operation_required");
  assert.deepEqual(f.counts(), { handlerCalls: 1, providerCalls: 1 });
}));
test("missing/replayed slots and changed signed principal never reach handler/provider", async () => fixture(async f => {
  const send = (slot, changes = {}) => fetch(f.apiOrigin + f.path, { method: "POST", headers: { ...f.headers,
    ...(slot ? { "x-aacp-journey-slot": slot } : {}), ...changes } });
  const missing = await send(); assert.equal(missing.status, 403); await missing.text();
  const operationId = randomUUID(), slot = await f.bridge.register({ operationId, stage: "turn" });
  const wrong = await send(slot, { "x-buyer-authorization": "Bearer invalid" }); assert.equal(wrong.status, 403); await wrong.text();
  const replay = await send(slot); assert.equal(replay.status, 403); await replay.text();
  assert.deepEqual(await f.bridge.waitForOperation(operationId), { outcome: "failed", code: "journey_http_admission_failed" });
  assert.deepEqual(f.counts(), { handlerCalls: 0, providerCalls: 0 });
}));
test("slot cannot choose another method/path or add a body/stage grant", async () => fixture(async f => {
  const operationId = randomUUID(), slot = await f.bridge.register({ operationId, stage: "turn" });
  const response = await fetch(f.apiOrigin + f.path + "?trusted=true", { method: "POST", headers: { ...f.headers, "x-aacp-journey-slot": slot },
    body: JSON.stringify({ trusted: true, stage: "nudge" }) });
  assert.equal(response.status, 403); await response.text();
  assert.deepEqual(f.counts(), { handlerCalls: 0, providerCalls: 0 });
  await assert.rejects(f.bridge.register({ operationId: randomUUID(), stage: "turn", path: "/arbitrary", trusted: true }));
}));
test("concurrent slot replay permits exactly one real HTTP handler", async () => fixture(async f => {
  const operationId = randomUUID(), slot = await f.bridge.register({ operationId, stage: "turn" });
  const replies = await Promise.all([0, 1].map(() => fetch(f.apiOrigin + f.path, { method: "POST", headers: { ...f.headers, "x-aacp-journey-slot": slot } })));
  assert.deepEqual(replies.map(reply => reply.status).sort(), [200, 403]);
  await Promise.all(replies.map(reply => reply.text()));
  assert.equal((await f.bridge.waitForOperation(operationId)).outcome, "completed");
  assert.deepEqual(f.counts(), { handlerCalls: 1, providerCalls: 1 });
}));
test("valid signature for another buyer and wrong origin remain refused", async () => fixture(async f => {
  for (const changed of [{ "x-buyer-authorization": `Bearer ${f.foreignBuyerToken}` }, { origin: "https://foreign.invalid" }]) {
    const operationId = randomUUID(), slot = await f.bridge.register({ operationId, stage: "turn" });
    const reply = await fetch(f.apiOrigin + f.path, { method: "POST", headers: { ...f.headers, ...changed, "x-aacp-journey-slot": slot } });
    assert.equal(reply.status, 403); await reply.text();
    assert.equal((await f.bridge.waitForOperation(operationId)).outcome, "failed");
  }
  assert.deepEqual(f.counts(), { handlerCalls: 0, providerCalls: 0 });
}));
test("HTTP fallback200 cannot erase failed provider operation or trigger a retry", async () => fixture(async f => {
  const operationId = randomUUID(), slot = await f.bridge.register({ operationId, stage: "turn" });
  const reply = await fetch(f.apiOrigin + f.path, { method: "POST", headers: { ...f.headers, "x-aacp-journey-slot": slot } });
  assert.equal(reply.status, 200); await reply.text();
  assert.deepEqual(await f.bridge.waitForOperation(operationId), { outcome: "failed", code: "journey_http_operation_failed" });
  assert.deepEqual(f.counts(), { handlerCalls: 1, providerCalls: 1 });
}, { providerFailure: true, swallowProviderFailure: true }));

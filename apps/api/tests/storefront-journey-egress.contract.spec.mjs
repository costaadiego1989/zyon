import assert from "node:assert/strict";
import test from "node:test";
import net from "node:net";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { verifyJourneyPreflight } from "./storefront-journey-guards.mjs";
import { installStorefrontJourneyEgress } from "./storefront-journey-egress.mjs";
import { initializeSyntheticSandboxLlmBudget, createSyntheticSandboxDeepSeekBudget, SANDBOX_LLM_APPROVAL } from "./storefront-sandbox-llm-budget.mjs";

const request = () => ({ method: "POST", headers: { authorization: "Bearer synthetic-contract", "content-type": "application/json" },
  body: JSON.stringify({ model: "deepseek-chat", max_tokens: 220, response_format: { type: "json_object" }, messages: [{ role: "user", content: "synthetic" }] }) });
async function fixture(work) {
  const m = { version: 1, runId: randomUUID(), merchantId: randomUUID(), buyerId: randomUUID(), sessionId: randomUUID(),
    apiOrigin: "http://127.0.0.1:19987", postgresRunId: randomUUID(), redisRunId: randomUUID(), postgresPort: 19985, redisPort: 19986 };
  const principal = { runId: m.runId, merchantId: m.merchantId, buyerId: m.buyerId, sessionId: m.sessionId };
  const capability = await verifyJourneyPreflight({ manifest: m, principalToken: "synthetic-contract",
    verifyPrincipal: async () => principal, verifyResources: async () => ({ ...principal, apiOrigin: m.apiOrigin,
      postgresRunId: m.postgresRunId, redisRunId: m.redisRunId, postgresPort: m.postgresPort, redisPort: m.redisPort }) });
  const directory = await mkdtemp(join(tmpdir(), "aacp-journey-egress-"));
  const original = globalThis.fetch; let sends = 0, fence;
  try {
    // Unit fake only. No HTTP, provider, canonical auth or marker proof here.
    globalThis.fetch = async () => { sends++; return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: '{"ok":true}' } }] })); };
    fence = await installStorefrontJourneyEgress({ capability });
    const ledger = join(directory, "ledger"); initializeSyntheticSandboxLlmBudget({ directory: ledger });
    const budget = createSyntheticSandboxDeepSeekBudget({ directory: ledger, fetchFn: (...args) => globalThis.fetch(...args) });
    const transport = fence.createTransport({ budget, record() {} });
    await work({ fence, transport, budget, sends: () => sends });
  } finally {
    fence?.dispose(); globalThis.fetch = original;
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(resolve(directory).startsWith(join(resolve(tmpdir()), "aacp-journey-egress-")));
    await rm(directory, { recursive: true, force: true });
  }
}
test("only a fetchForStep execution window can reach the provider and all original globals are restored", async () => {
  const originalFetch = globalThis.fetch, originalConnect = net.Socket.prototype.connect;
  await fixture(async ({ fence, transport, budget, sends }) => {
    await transport.runOperation({ operationId: randomUUID(), stage: "classifier" }, () => transport.fetchFactory("primary")(SANDBOX_LLM_APPROVAL.endpoint, request()));
    assert.equal(budget.status().attemptedCalls, 1); assert.equal(sends(), 1);
    assert.deepEqual(fence.evidence(), { budgetedFetches: 1, deniedFetches: 0, deniedSockets: 0, activeWindows: 0, externalPspOrGeocoderEnabled: false });
  });
  assert.equal(globalThis.fetch, originalFetch); assert.equal(net.Socket.prototype.connect, originalConnect);
});
test("unwrapped vision/voice/provider fetch and raw sockets fail closed before transport", async () => {
  await fixture(async ({ fence, budget, sends }) => {
    for (const url of [SANDBOX_LLM_APPROVAL.endpoint, "https://api.openai.com/v1/realtime", "https://api.openai.com/v1/chat/completions"]) {
      await assert.rejects(globalThis.fetch(url, request()), /journey_unaccounted_fetch_forbidden/);
    }
    const socket = new net.Socket();
    try { assert.throws(() => socket.connect({ host: "api.deepseek.com", port: 443 }), /journey_unaccounted_socket_forbidden/); }
    finally { socket.destroy(); }
    assert.equal(sends(), 0); assert.equal(budget.status().attemptedCalls, 0);
    assert.equal(fence.evidence().deniedFetches, 3); assert.equal(fence.evidence().deniedSockets, 1);
  });
});
test("catching unaccounted provider errors cannot convert the operation into passing journey proof", async () => {
  await fixture(async ({ transport, budget, sends }) => {
    await assert.rejects(transport.runOperation({ operationId: randomUUID(), stage: "nudge" }, async () => {
      await assert.rejects(globalThis.fetch(SANDBOX_LLM_APPROVAL.endpoint, request()), /journey_unaccounted_fetch_forbidden/);
      return "deterministic fallback";
    }), /journey_egress_violation/);
    assert.equal(sends(), 0); assert.equal(budget.status().attemptedCalls, 0);
  });
});

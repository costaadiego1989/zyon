import "reflect-metadata";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { verifyJourneyPreflight } from "./storefront-journey-guards.mjs";
import { createStorefrontJourneyTransport } from "./storefront-journey-transport.mjs";
import { initializeSyntheticSandboxLlmBudget, createSyntheticSandboxDeepSeekBudget } from "./storefront-sandbox-llm-budget.mjs";

// Clean child only. Synthetic configuration and contract verifier/repository
// doubles are NOT real authentication, DI bootstrap, SQL or journey proof.
process.env.LOCAL_LLM_API_KEY = "synthetic-journey-primary";
process.env.LOCAL_LLM_BASE_URL = "https://api.deepseek.com/v1";
process.env.LOCAL_LLM_MODEL = "deepseek-chat";
process.env.OPENROUTER_API_KEY = "synthetic-journey-fallback";
process.env.OPENROUTER_BASE_URL = "https://api.deepseek.com/v1";
process.env.OPENROUTER_MODEL = "deepseek-chat";
process.env.STOREFRONT_LLM_OUTPUT_MODE = "json_schema";
const { StorefrontConversationAdapter: Adapter, STOREFRONT_PROVIDER_FETCH_FACTORY: token } = await import(
  "../src/modules/storefront/infrastructure/adapters/storefront-conversation.adapter.ts");
const injection = Reflect.getMetadata("self:paramtypes", Adapter);
const transportDependency = injection.find(entry => entry.param === token);
assert.ok(transportDependency && Number.isInteger(transportDependency.index));
const transportIndex = transportDependency.index;
assert.ok(transportIndex >= 6);
assert.ok(Reflect.getMetadata("optional:paramtypes", Adapter).includes(transportIndex));
const construct = factory => {
  const args = Array(transportIndex + 1).fill(undefined);
  for (let index = 0; index < 6; index++) args[index] = {};
  args[transportIndex] = factory;
  return Reflect.construct(Adapter, args);
};

const wire = value => new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(value) } }],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }), { headers: { "content-type": "application/json" } });
const fixtureFetch = async (_url, options) => {
  const body = JSON.parse(options.body), name = body.response_format?.json_schema?.name;
  if (name === "storefront_intent_v2") return wire({ schemaVersion: 2, domain: "STORE_COMMERCE", intent: "COMPLEX_QUESTION",
    confidence: 0.99, requiresTool: false, needsProductDiscovery: false });
  if (name === "storefront_copy_review_v1") return wire({ schemaVersion: 1, verdict: "ALLOW", confidence: 0.99 });
  return wire({ schemaVersion: 1, message: "Veja os produtos disponíveis na loja.", ...(name === "storefront_nudge_v1" ? { offerIndex: null } : {}) });
};
const directory = await mkdtemp(join(tmpdir(), "aacp-journey-adapter-"));
try {
  const ledger = join(directory, "ledger"); initializeSyntheticSandboxLlmBudget({ directory: ledger });
  const budget = createSyntheticSandboxDeepSeekBudget({ directory: ledger, fetchFn: fixtureFetch });
  const manifest = { version: 1, runId: randomUUID(), merchantId: randomUUID(), buyerId: randomUUID(), sessionId: randomUUID(), apiOrigin: "http://127.0.0.1:19987",
    postgresRunId: randomUUID(), redisRunId: randomUUID(), postgresPort: 19985, redisPort: 19986 };
  const principal = { runId: manifest.runId, merchantId: manifest.merchantId, buyerId: manifest.buyerId, sessionId: manifest.sessionId };
  const capability = await verifyJourneyPreflight({ manifest, principalToken: "synthetic-contract-only",
    verifyPrincipal: async () => principal, verifyResources: async () => ({ ...principal, apiOrigin: manifest.apiOrigin,
      postgresRunId: manifest.postgresRunId, redisRunId: manifest.redisRunId, postgresPort: manifest.postgresPort, redisPort: manifest.redisPort }) });
  const traces = [], channels = [];
  const transport = createStorefrontJourneyTransport({ capability, budget, record: event => traces.push(event) });
  const adapter = construct(channel => { channels.push(channel); return transport.fetchFactory(channel); });
  assert.deepEqual(channels, ["primary", "fallback"]);
  const primary = Reflect.get(adapter, "copyProvider"), copy = Reflect.get(adapter, "copyService"), agent = Reflect.get(adapter, "agent");
  assert.equal(Reflect.get(agent, "provider"), primary); assert.equal(Reflect.get(copy, "copyProvider"), primary);
  const operation = stage => ({ operationId: randomUUID(), stage });
  assert.equal(await transport.runOperation(operation("classifier"), () => adapter.classifyConversationScope({ userMessage: "Quais produtos há na loja?", history: [] })), "STORE_COMMERCE");
  await transport.runOperation(operation("nudge"), () => adapter.generateNudge({ merchantId: manifest.merchantId, trigger: "idle_30_seconds",
    stage: "browsing", agentTone: "Cordial", availableOffers: [], fallback: "Veja os produtos da loja." }));
  await transport.runOperation(operation("copy"), () => copy.generateVariantCopy("Cordial", "Apresente os produtos da loja.", "Veja os produtos da loja."));
  assert.equal(budget.status().attemptedCalls, 5, "classifier_copy_nudge_and_semantic_reviews_must_share_budget");
  await assert.rejects(transport.runOperation(operation("turn"), () => Reflect.get(agent, "fallbackProvider").chat({ messages: [{ role: "user", content: "synthetic" }] })), /journey_fallback_forbidden/);
  assert.equal(budget.status().attemptedCalls, 5);
  assert.throws(() => construct(() => undefined), /storefront_provider_transport_invalid/);
  assert.throws(() => construct(channel => channel === "primary" ? fixtureFetch : undefined), /storefront_provider_transport_invalid/);

  const originalFetch = globalThis.fetch; let defaultCalls = 0;
  try {
    globalThis.fetch = async (...args) => { defaultCalls++; return fixtureFetch(...args); };
    const unchanged = construct(undefined), defaultPrimary = Reflect.get(unchanged, "copyProvider");
    await defaultPrimary.chat({ messages: [{ role: "user", content: "synthetic" }] });
    await Reflect.get(Reflect.get(unchanged, "agent"), "fallbackProvider").chat({ messages: [{ role: "user", content: "synthetic" }] });
    assert.equal(defaultCalls, 2, "absent_factory_keeps_existing_global_fetch_default");
  } finally { globalThis.fetch = originalFetch; }
  assert.doesNotMatch(JSON.stringify(traces), /synthetic-journey|messages|content|headers|availableOffers/);
  console.log(JSON.stringify({ adapterConstructor: "real", nestDecorators: "real", primaryRouting: true,
    classifierCopyNudgeAndReviews: 5, fallbackDenied: true, defaultProductionPathUnchanged: true,
    syntheticLedgerOnly: true, realProviderCalls: 0, actualAuthOrDatabaseProof: false, fullJourneyProof: false }));
} finally {
  assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
  assert.ok(resolve(directory).startsWith(join(resolve(tmpdir()), "aacp-journey-adapter-")));
  await rm(directory, { recursive: true, force: true });
}

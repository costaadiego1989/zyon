import test from "node:test";
import assert from "node:assert/strict";
import { StorefrontObserver, observeStorefrontOperation, observeStorefrontChat, recordStorefrontDecision, observeStorefrontHandlers,
  type StorefrontObservation } from "./storefront-observation.js";
import { createAllowedScopeAgent } from "../agents/storefront-scope.fixture.js";
import { classifyStorefrontIntent } from "../ai/structured-intent-classifier.js";
import { MetricsService } from "../../../../shared/observability/metrics.service.js";
import type { OpenRouterProvider } from "@zyon/conversation-engine";
import { trace } from "@opentelemetry/api";
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { StorefrontConversationAdapter } from "../adapters/storefront-conversation.adapter.js";
import { AgentCopyService } from "../copy/agent-copy.service.js";
import { StorefrontToolOutcomeUnknownError } from "../../domain/errors/store-tool-outcome-unknown.error.js";

const usage = { promptTokens: 20, completionTokens: 10, totalTokens: 30 };
const input = { merchantId: "PRIVATE_MERCHANT", sessionId: "PRIVATE_CART", userMessage: "PRIVATE_EMAIL@example.com", history: [], storeCategory: "others" };
const response = { content: JSON.stringify({ schemaVersion: 1, message: "Como posso ajudar?" }), usage };
function fixture(options: ConstructorParameters<typeof StorefrontObserver>[0] = {}) {
  const events: StorefrontObservation[] = [];
  const observer = new StorefrontObserver({ enabled: true, ...options, record: event => { events.push(event); options.record?.(event); } });
  return { observer, events };
}

test("disabled observer preserves result and emits nothing", async () => {
  const { observer, events } = fixture({ enabled: false });
  assert.equal(await observer.turn(() => observeStorefrontOperation("tool", async () => 42, { tool: "get_cart" })), 42);
  assert.deepEqual(events, []);
});

test("nested operations share opaque turn id and have parent operation ids", async () => {
  const { observer, events } = fixture();
  await observer.turn(() => observeStorefrontOperation("agent", () => observeStorefrontOperation("tool", async () => 42, { tool: "get_cart" })));
  const turn = events.find(e => e.stage === "turn")!;
  const agent = events.find(e => e.stage === "agent")!;
  const tool = events.find(e => e.stage === "tool")!;
  assert.equal(agent.parentId, turn.operationId);
  assert.equal(tool.parentId, agent.operationId);
  assert.ok(events.every(e => e.turnId === turn.turnId && Number.isFinite(e.durationMs) && e.durationMs >= 0));
});

test("parallel turns do not mix correlation", async () => {
  const { observer, events } = fixture();
  await Promise.all(Array.from({ length: 6 }, () => observer.turn(async () => {
    await Promise.resolve();
    await observeStorefrontOperation("tool", async () => undefined, { tool: "get_cart" });
  })));
  const turns = events.filter(e => e.stage === "turn");
  assert.equal(new Set(turns.map(e => e.turnId)).size, 6);
  for (const turn of turns) assert.equal(events.filter(e => e.turnId === turn.turnId).length, 2);
});

test("sink failure cannot repeat or change business operation", async () => {
  const observer = new StorefrontObserver({ enabled: true, record: () => { throw new Error("PRIVATE_SINK_ERROR"); } });
  let writes = 0;
  assert.equal(await observer.turn(() => observeStorefrontOperation("tool", async () => ++writes)), 1);
  assert.equal(writes, 1);
});

test("business exception preserves exact identity without exposing message or stack", async () => {
  const { observer, events } = fixture();
  const error = new Error("PRIVATE_TOKEN_PRIVATE_EMAIL@example.com");
  await assert.rejects(observer.turn(() => observeStorefrontOperation("tool", async () => { throw error; })), e => e === error);
  assert.ok(events.every(e => e.outcome === "error" && e.reason === "exception"));
  assert.ok(!JSON.stringify(events).includes("PRIVATE"));
});

test("unknown tool metadata and extra decision fields never enter telemetry", async () => {
  const { observer, events } = fixture();
  await observer.turn(async () => {
    await observeStorefrontOperation("tool", async () => undefined, { tool: "PRIVATE_EMAIL@example.com" });
    recordStorefrontDecision("validation", "fallback", "invalid_output", { prompt: "PRIVATE_PROMPT" } as never);
  });
  assert.equal(events.find(e => e.stage === "tool")?.tool, "unknown");
  assert.ok(!JSON.stringify(events).includes("PRIVATE"));
});

for (const reason of ["out_of_scope", "scope_unclear"] as const) {
  test(`scope decision is observable with bounded labels and no buyer text: ${reason}`, async () => {
    const { observer, events } = fixture();
    await observer.turn(async () => {
      recordStorefrontDecision("agent", "rejected", reason, { prompt: "PRIVATE_SCOPE_PROMPT" } as never);
      recordStorefrontDecision("agent", "rejected", "PRIVATE_UNBOUNDED_REASON" as never);
    });
    const decisions = events.filter(event => event.kind === "decision");
    assert.equal(decisions.length, 1);
    assert.equal(decisions[0].stage, "agent");
    assert.equal(decisions[0].outcome, "rejected");
    assert.equal(decisions[0].reason, reason);
    assert.ok(!JSON.stringify(events).includes("PRIVATE"));
  });
}

test("provider usage and known-model estimated USD cents are recorded once", async () => {
  const { observer, events } = fixture();
  let calls = 0;
  const provider = { chat: async () => { calls++; return response; } };
  assert.equal(await observer.turn(() => observeStorefrontChat(provider, { messages: [{ role: "user", content: "PRIVATE_PROMPT" }], model: "openai/gpt-4o-mini" }, "primary", "main")), response);
  assert.equal(calls, 1);
  const event = events.find(e => e.stage === "provider")!;
  assert.equal(event.usageKnown, true);
  assert.equal(event.promptTokens, 20);
  assert.equal(event.completionTokens, 10);
  assert.ok(event.estimatedCostUsdCents! > 0);
  assert.ok(!JSON.stringify(events).includes("PRIVATE"));
});

for (const badUsage of [undefined, { ...usage, promptTokens: -1 }, { ...usage, totalTokens: Infinity }, { ...usage, totalTokens: 999 }, { promptTokens: "20", completionTokens: 10, totalTokens: 30 }]) {
  test(`unusable provider usage is unknown, not fabricated: ${JSON.stringify(badUsage)}`, async () => {
    const { observer, events } = fixture();
    await observer.turn(() => observeStorefrontChat({ chat: async () => ({ ...response, usage: badUsage }) } as never, { messages: [] }, "primary", "main"));
    const event = events.find(e => e.stage === "provider")!;
    assert.equal(event.usageKnown, false);
    assert.equal(event.promptTokens, undefined);
    assert.equal(event.estimatedCostUsdCents, undefined);
  });
}

test("unpriced model never receives the budget tracker's default price", async () => {
  const { observer, events } = fixture();
  await observer.turn(() => observeStorefrontChat({ chat: async () => response }, { messages: [], model: "PRIVATE_UNKNOWN_MODEL" }, "primary", "main"));
  const event = events.find(e => e.stage === "provider")!;
  assert.equal(event.usageKnown, true);
  assert.equal(event.estimatedCostUsdCents, undefined);
  assert.ok(!JSON.stringify(events).includes("PRIVATE"));
});
test("explicit RAW-usage unknown provenance cannot become measured zero in telemetry", async () => {
  const { observer, events } = fixture();
  await observer.turn(() => observeStorefrontChat({ chat: async () => ({ ...response, usageKnown: false,
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } }) }, { messages: [], model: "openai/gpt-4o-mini" }, "primary", "output_review"));
  const event = events.find(value => value.stage === "provider")!;
  assert.equal(event.usageKnown, false); assert.equal(event.promptTokens, undefined); assert.equal(event.completionTokens, undefined);
  assert.equal(event.estimatedCostUsdCents, undefined);
});

test("classifier fallback is observable without changing its no-retry behavior", async () => {
  const { observer, events } = fixture();
  let calls = 0;
  const result = await observer.turn(() => classifyStorefrontIntent({ chat: async () => { calls++; return { content: "PRIVATE_INVALID_JSON", usage }; } }, { userMessage: input.userMessage, history: [] }));
  assert.equal(result.source, "fallback");
  assert.equal(calls, 1);
  assert.ok(events.some(e => e.stage === "classifier" && e.outcome === "fallback"));
  assert.ok(events.some(e => e.stage === "provider" && e.phase === "classifier"));
  assert.ok(!JSON.stringify(events).includes("PRIVATE"));
});

test("invalid model output is observable, not a successful validated answer", async () => {
  const { observer, events } = fixture();
  const agent = createAllowedScopeAgent({ provider: { chat: async () => ({ content: "PRIVATE_RAW_OUTPUT", usage }) } as unknown as OpenRouterProvider, toolHandlers: {} as never });
  await observer.turn(() => agent.run(input));
  assert.ok(events.some(e => e.stage === "validation" && e.outcome === "fallback" && e.reason === "invalid_output"));
  assert.ok(!JSON.stringify(events).includes("PRIVATE"));
});

test("agent traces provider fallback and tools without adding execution", async () => {
  const { observer, events } = fixture();
  let primary = 0, fallback = 0, reads = 0;
  const agent = createAllowedScopeAgent({ provider: { chat: async () => { primary++; throw new Error("PRIVATE_PROVIDER_ERROR"); } } as unknown as OpenRouterProvider,
    fallbackProvider: { chat: async () => ++fallback === 1 ? { content: "", usage, toolCalls: [{ id: "PRIVATE_CALL_ID", name: "list_categories", args: {} }] } : response } as unknown as OpenRouterProvider,
    toolHandlers: { listCategories: async () => { reads++; return { categories: [] }; } } as never });
  await observer.turn(() => agent.run(input));
  assert.equal(primary, 1); assert.equal(fallback, 2); assert.equal(reads, 1);
  assert.ok(events.some(e => e.stage === "provider" && e.provider === "primary" && e.outcome === "error"));
  assert.ok(events.some(e => e.stage === "provider" && e.provider === "fallback"));
  assert.ok(events.some(e => e.stage === "tool" && e.tool === "list_categories"));
  assert.ok(!JSON.stringify(events).includes("PRIVATE"));
});

test("Prometheus uses bounded labels and no customer identifiers", async () => {
  const metrics = new MetricsService();
  const { observer } = fixture({ metrics });
  await observer.turn(() => observeStorefrontChat({ chat: async () => response }, { messages: [], model: "openai/gpt-4o-mini" }, "primary", "main"));
  const text = await metrics.getMetrics();
  assert.match(text, /storefront_llm_operations_total\{stage="provider",outcome="ok",reason="completed"\} 1/);
  assert.match(text, /storefront_llm_tokens_total\{phase="main",provider="primary",kind="prompt"\} 20/);
  assert.match(text, /storefront_llm_estimated_cost_usd_cents_total/);
  assert.ok(!text.includes("PRIVATE"));
  assert.ok(!text.includes("turn_id="));
  metrics.registry.clear();
});

test("decision counters are separate and never distort operation duration", async () => {
  const metrics = new MetricsService();
  const { observer } = fixture({ metrics });
  await observer.turn(async () => recordStorefrontDecision("validation", "fallback", "invalid_output"));
  const text = await metrics.getMetrics();
  assert.match(text, /storefront_llm_decisions_total\{stage="validation",outcome="fallback",reason="invalid_output"\} 1/);
  assert.ok(!text.includes('storefront_llm_operation_duration_seconds_count{stage="validation"}'));
  metrics.registry.clear();
});

test("disabled direct handlers retain exact identity and no extra validation", () => {
  const handlers = { getCart: async () => ({}) } as never;
  assert.equal(observeStorefrontHandlers(handlers, "PRIVATE_CART"), handlers);
});

test("direct handler observation preserves result identity and receiver without replay", async () => {
  const { observer, events } = fixture();
  const raw = { categories: [], privateField: "PRIVATE_TOOL_DATA" };
  let reads = 0;
  const handlers = { listCategories: async function () { assert.equal(this, handlers); reads++; return raw; } };
  const output = await observer.turn(() => observeStorefrontHandlers(handlers as never, "PRIVATE_CART").listCategories());
  assert.equal(output, raw); assert.equal(reads, 1);
  assert.equal(events.filter(e => e.stage === "tool" && e.kind === "operation").length, 1);
  assert.ok(!JSON.stringify(events).includes("PRIVATE"));
});

test("invalid direct result is observed but returned unchanged to existing validator", async () => {
  const { observer, events } = fixture();
  const raw = { PRIVATE_RESULT: true };
  const result = await observer.turn(() => observeStorefrontHandlers({ getCart: async () => raw } as never, "PRIVATE_CART").getCart({ cartId: "PRIVATE_CART" }));
  assert.equal(result, raw);
  assert.ok(events.some(e => e.kind === "decision" && e.reason === "invalid_output"));
  assert.ok(!JSON.stringify(events).includes("PRIVATE"));
});

test("uncertain direct write keeps exact error identity and is never replayed", async () => {
  const { observer, events } = fixture();
  const error = new StorefrontToolOutcomeUnknownError();
  let writes = 0;
  await assert.rejects(observer.turn(() => observeStorefrontHandlers({ applyCoupon: async () => { writes++; throw error; } } as never, "PRIVATE_CART").applyCoupon({ couponCode: "PRIVATE_COUPON" })), e => e === error);
  assert.equal(writes, 1);
  assert.ok(events.some(e => e.outcome === "unknown" && e.reason === "cart_outcome_unknown"));
  assert.ok(!JSON.stringify(events).includes("PRIVATE"));
});

test("UI action joins adapter turn and does not invent an LLM call", async () => {
  const { observer, events } = fixture();
  const adapter = Object.create(StorefrontConversationAdapter.prototype) as StorefrontConversationAdapter;
  Object.assign(adapter, { observer, structuredRouting: true, handlerDeps: { prisma: {}, productRepo: { listCategories: async () => [] } } });
  const result = await adapter.reply({ ...input, uiAction: { tool: "list_categories", args: {} } });
  assert.ok(result.message);
  assert.equal(events.filter(e => e.stage === "turn").length, 1);
  assert.ok(events.some(e => e.stage === "tool" && e.tool === "list_categories"));
  assert.ok(!events.some(e => e.stage === "provider"));
});

for (const enabled of [false, true]) {
  test(`adapter creates opt-in nudge observation: enabled=${enabled}`, async () => {
    const previous = process.env.STOREFRONT_LLM_OBSERVABILITY;
    const previousKey = process.env.LOCAL_LLM_API_KEY;
    try {
      process.env.LOCAL_LLM_API_KEY = "test-observation-not-a-real-key";
      if (enabled) process.env.STOREFRONT_LLM_OBSERVABILITY = "enabled";
      else delete process.env.STOREFRONT_LLM_OBSERVABILITY;
      const adapter = new StorefrontConversationAdapter({} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
      const logs: unknown[] = [];
      Object.assign(adapter, { logger: { log: (event: unknown) => logs.push(event) }, copyService: { generateNudge: async () => "Tudo certo" } });
      assert.equal(await adapter.generateNudge({} as never), "Tudo certo");
      assert.equal(logs.length, enabled ? 1 : 0);
    } finally {
      if (previousKey === undefined) delete process.env.LOCAL_LLM_API_KEY;
      else process.env.LOCAL_LLM_API_KEY = previousKey;
      if (previous === undefined) delete process.env.STOREFRONT_LLM_OBSERVABILITY;
      else process.env.STOREFRONT_LLM_OBSERVABILITY = previous;
    }
  });
}

test("copy failures report only bounded metadata without losing provider usage", async () => {
  const { observer, events } = fixture();
  const copy = new AgentCopyService({ chat: async () => ({ content: "PRIVATE_INVALID_COPY", usage }) });
  assert.equal(await observer.turn(() => copy.generateVariantCopy("PRIVATE_STYLE", "PRIVATE_INSTRUCTION", "Vamos escolher?")), "Vamos escolher?");
  assert.ok(events.some(e => e.stage === "provider" && e.provider === "copy" && e.phase === "variant" && e.promptTokens === 20));
  assert.ok(events.some(e => e.kind === "decision" && e.reason === "invalid_output"));
  assert.ok(!JSON.stringify(events).includes("PRIVATE"));
});

test("agent error logs never retain raw provider exception", async () => {
  const logs: unknown[] = [];
  const agent = createAllowedScopeAgent({ provider: { chat: async () => { throw new Error("PRIVATE_TOKEN_EMAIL@example.com"); } } as unknown as OpenRouterProvider, toolHandlers: {} as never });
  Object.assign(agent, { logger: { error: (...args: unknown[]) => logs.push(args) } });
  await agent.run(input);
  assert.ok(logs.length > 0);
  assert.ok(!JSON.stringify(logs).includes("PRIVATE"));
});

test("record boundary rejects unexpected fields even if called directly", () => {
  const { observer, events } = fixture();
  observer.record({ schemaVersion: 1, kind: "decision", turnId: "PRIVATE", operationId: "PRIVATE", stage: "tool", outcome: "ok", reason: "completed", durationMs: 0 } as never);
  assert.deepEqual(events, []);
});

test("invalid decision enums cannot leak through span events or logs", async () => {
  const { observer, events } = fixture();
  await observer.turn(async () => {
    recordStorefrontDecision("PRIVATE_STAGE" as never, "fallback", "invalid_output");
    recordStorefrontDecision("validation", "PRIVATE_OUTCOME" as never, "invalid_output");
    recordStorefrontDecision("validation", "fallback", "PRIVATE_REASON" as never);
  });
  assert.equal(events.length, 1);
  assert.ok(!JSON.stringify(events).includes("PRIVATE"));
});

test("real in-memory OTel spans retain parentage, usage and bounded decisions only", async () => {
  const exporter = new InMemorySpanExporter();
  const sdk = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  trace.setGlobalTracerProvider(sdk);
  try {
    const { observer, events } = fixture();
    await observer.turn(() => observeStorefrontOperation("agent", async () => {
      await observeStorefrontChat({ chat: async () => response }, { messages: [{ role: "user", content: "PRIVATE_PROMPT" }] }, "primary", "main");
      recordStorefrontDecision("validation", "fallback", "invalid_output");
    }));
    await sdk.forceFlush();
    const spans = exporter.getFinishedSpans();
    assert.equal(spans.length, 3);
    const turn = spans.find(s => s.name === "storefront.turn")!;
    const agent = spans.find(s => s.name === "storefront.agent")!;
    const provider = spans.find(s => s.name === "storefront.provider")!;
    assert.equal(agent.parentSpanContext?.spanId, turn.spanContext().spanId);
    assert.equal(provider.parentSpanContext?.spanId, agent.spanContext().spanId);
    assert.equal(provider.attributes["gen_ai.usage.input_tokens"], 20);
    assert.ok(agent.events.some(e => e.name === "storefront.decision"));
    assert.ok(events.filter(e => e.kind === "operation").every(e => e.traceId === turn.spanContext().traceId));
    assert.ok(!JSON.stringify(spans.map(s => ({ attributes: s.attributes, events: s.events, status: s.status }))).includes("PRIVATE"));
  } finally { trace.disable(); await sdk.shutdown(); }
});


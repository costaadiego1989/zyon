import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { trace } from "@opentelemetry/api";
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { GenerateNudgeUseCase, type GenerateNudgeInput } from "../../application/use-cases/generate-nudge.use-case.js";
import { STOREFRONT_CONVERSATION_PORT, type NudgeCopyInput } from "../../domain/ports/conversation.port.js";
import { STOREFRONT_COPY_FALLBACK } from "../../domain/contracts/storefront-copy.schemas.js";
import { nudgeOfferSuffix } from "../../domain/contracts/storefront-copy.schemas.js";
import { STOREFRONT_USE_CASE_OBSERVATION } from "../../domain/ports/storefront-use-case-observation.port.js";
import { StorefrontConversationAdapter } from "../adapters/storefront-conversation.adapter.js";
import { AgentCopyService } from "../copy/agent-copy.service.js";
import { StorefrontObserver, type StorefrontObservation } from "./storefront-observation.js";
import { StorefrontUseCaseObserver } from "./storefront-use-case-observer.js";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { MetricsService } from "../../../../shared/observability/metrics.service.js";
import { SafeSpanExporter } from "../../../../shared/observability/safe-span-exporter.js";
import { CorrelationIdStorage } from "../../../../shared/logger/correlation-id.storage.js";

const input: GenerateNudgeInput = { merchant_id: "PRIVATE_MERCHANT", trigger: "idle_30_seconds", stage: "browsing", fallback: "Posso ajudar você a escolher?" };
const valid = "Vamos escolher juntos?";
const usage = { promptTokens: 20, completionTokens: 10, totalTokens: 30 };
function fixture(options: { result?: unknown; enabled?: boolean; record?: () => void; metrics?: MetricsService } = {}) {
  const events: StorefrontObservation[] = [], logs: unknown[] = [];
  const calls = { reads: 0, generated: [] as NudgeCopyInput[] };
  const observer = new StorefrontUseCaseObserver({ enabled: options.enabled ?? true, metrics: options.metrics,
    record: event => { events.push(event); options.record?.(); } });
  const adapterObserver = new StorefrontObserver({ enabled: options.enabled ?? true, record: event => events.push(event) });
  const copy = { generateNudge: async (context: NudgeCopyInput) => {
    calls.generated.push(context);
    if (options.result instanceof Error) throw options.result;
    return Object.hasOwn(options, "result") ? options.result : valid;
  } };
  // Real adapter entrypoint, without constructing external providers or dependencies.
  const adapter = Object.create(StorefrontConversationAdapter.prototype) as StorefrontConversationAdapter;
  Object.assign(adapter, { observer: adapterObserver, copyService: copy });
  const prisma = { promptExperiment: { findFirst: async () => { calls.reads++; return null; } },
    agentRule: { findFirst: async () => { calls.reads++; return { identity: { tone: "PRIVATE_STYLE" } }; } },
    checkoutSetting: { findUnique: async () => { calls.reads++; return null; } } };
  const useCase = new GenerateNudgeUseCase(adapter, prisma as never, undefined, undefined, observer);
  Object.assign(useCase, { logger: { warn: (...values: unknown[]) => logs.push(values) } });
  return { useCase, observer, events, logs, calls, copy, adapter, prisma };
}
const ops = (events: StorefrontObservation[]) => events.filter(event => event.kind === "operation");
const privateAbsent = (value: unknown) => assert.ok(!JSON.stringify(value).includes("PRIVATE"));

test("nudge observes input, safe fallback, context, generation, output and response in one turn", async () => {
  const f = fixture();
  assert.deepEqual(await f.useCase.execute(input), { message: valid });
  assert.equal(f.calls.generated.length, 1);
  const operations = ops(f.events), turn = operations.find(event => event.stage === "turn")!;
  assert.ok(turn); assert.equal(operations.filter(event => event.stage === "turn").length, 1);
  assert.deepEqual(operations.filter(event => event.stage === "validation").map(event => event.boundary), ["input", "fallback", "context", "output", "response"]);
  assert.equal(operations.filter(event => event.stage === "generation" && event.boundary === "generation").length, 1);
  assert.ok(operations.filter(event => event !== turn).every(event => event.parentId === turn.operationId));
  assert.equal(new Set(f.events.map(event => event.turnId)).size, 1);
  assert.equal(f.events.filter(event => event.stage === "persistence" || event.stage === "tool").length, 0);
  privateAbsent([f.events, f.logs]);
});

for (const [label, body] of [
  ["null", null], ["array", []], ["tenant", { ...input, merchant_id: "" }],
  ["trigger", { ...input, trigger: "PRIVATE_UNKNOWN" }], ["fallback type", { ...input, fallback: 42 }],
  ["authority", { ...input, authorizedDiscount: 90 }],
] as const) {
  test(`nudge invalid ${label} is observed and rejected before reads or generation`, async () => {
    const f = fixture();
    await assert.rejects(f.useCase.execute(body as never), (error: { getStatus(): number; message: string }) =>
      error.getStatus() === 400 && error.message === "invalid_storefront_nudge_input");
    assert.equal(f.calls.reads, 0); assert.equal(f.calls.generated.length, 0);
    assert.ok(f.events.some(event => event.kind === "decision" && event.boundary === "input" && event.reason === "invalid_input" && event.outcome === "rejected"));
    assert.equal(f.events.find(event => event.stage === "turn")?.outcome, "error");
    privateAbsent([f.events, f.logs]);
  });
}

test("nudge invalid loaded context returns safe fallback without invoking adapter", async () => {
  const f = fixture();
  f.prisma.agentRule.findFirst = async () => ({ identity: { tone: { PRIVATE_CONTEXT: true } } }) as never;
  assert.deepEqual(await f.useCase.execute(input), { message: input.fallback });
  assert.equal(f.calls.generated.length, 0);
  assert.ok(f.events.some(event => event.kind === "decision" && event.boundary === "context" && event.reason === "invalid_context" && event.outcome === "fallback"));
  assert.ok(ops(f.events).some(event => event.boundary === "response"));
  assert.equal(f.events.find(event => event.stage === "turn")?.outcome, "ok");
  privateAbsent([f.events, f.logs]);
});

for (const [label, result] of [
  ["null", null], ["object", { message: "PRIVATE_VALUE" }], ["empty", " "], ["oversized", "x".repeat(2001)],
  ["unsafe", "Seu pagamento foi aprovado."], ["invented offer", "Vamos? Confira as condições: cupom PRIVATE_FAKE com 90% de desconto."],
] as const) {
  test(`nudge ${label} output is observed and replaced without replay`, async () => {
    const f = fixture({ result });
    assert.deepEqual(await f.useCase.execute(input), { message: input.fallback });
    assert.equal(f.calls.generated.length, 1);
    assert.ok(f.events.some(event => event.kind === "decision" && event.boundary === "output" && event.outcome === "fallback" && event.reason === "invalid_output"));
    assert.equal(f.events.find(event => event.stage === "turn")?.outcome, "ok");
    privateAbsent([f.events, f.logs]);
  });
}

test("nudge port exception records error plus fallback, not a failed public turn or retry", async () => {
  const f = fixture({ result: new Error("PRIVATE_PROVIDER_CREDENTIALS") });
  assert.deepEqual(await f.useCase.execute(input), { message: input.fallback });
  assert.equal(f.calls.generated.length, 1);
  assert.equal(f.events.find(event => event.kind === "operation" && event.stage === "generation")?.outcome, "error");
  assert.ok(f.events.some(event => event.kind === "decision" && event.boundary === "generation" && event.reason === "exception" && event.outcome === "fallback"));
  assert.equal(f.events.find(event => event.stage === "turn")?.outcome, "ok");
  assert.equal(ops(f.events).filter(event => event.boundary === "response").length, 1);
  privateAbsent([f.events, f.logs]);
});

test("unsafe configured fallback is sanitized and observed separately from valid generation", async () => {
  const f = fixture();
  assert.deepEqual(await f.useCase.execute({ ...input, fallback: "Seu pagamento foi aprovado." }), { message: valid });
  assert.equal(f.calls.generated[0]?.fallback, STOREFRONT_COPY_FALLBACK);
  assert.ok(f.events.some(event => event.kind === "decision" && event.boundary === "fallback" && event.reason === "safety_rejected"));
});

test("context fallback also uses sanitized configured copy", async () => {
  const f = fixture(); f.prisma.agentRule.findFirst = async () => ({ identity: { tone: 42 } }) as never;
  assert.deepEqual(await f.useCase.execute({ ...input, fallback: "Seu pagamento foi aprovado." }), { message: STOREFRONT_COPY_FALLBACK });
  assert.equal(f.calls.generated.length, 0);
  assert.equal(f.events.filter(event => event.kind === "decision" && event.outcome === "fallback").length, 2);
});

test("a valid port response equal to fallback is not inferred to be a provider failure", async () => {
  const f = fixture({ result: input.fallback });
  assert.deepEqual(await f.useCase.execute(input), { message: input.fallback });
  assert.ok(ops(f.events).some(event => event.boundary === "output"));
  assert.equal(f.events.filter(event => event.kind === "decision").length, 0);
});

test("disabled nudge observer preserves response and emits nothing", async () => {
  const f = fixture({ enabled: false });
  assert.deepEqual(await f.useCase.execute(input), { message: valid });
  assert.deepEqual(f.events, []); assert.equal(f.calls.generated.length, 1);
});

test("nudge recorder failure cannot change output or repeat generation", async () => {
  const f = fixture({ record: () => { throw new Error("PRIVATE_SINK_ERROR"); } });
  assert.deepEqual(await f.useCase.execute(input), { message: valid }); assert.equal(f.calls.generated.length, 1);
});

test("parallel nudge calls keep independent turn ids across async reads and generation", async () => {
  const f = fixture(); await Promise.all(Array.from({ length: 6 }, () => f.useCase.execute(input)));
  const turns = f.events.filter(event => event.stage === "turn");
  assert.equal(new Set(turns.map(event => event.turnId)).size, 6);
  for (const turn of turns) assert.equal(ops(f.events).filter(event => event.turnId === turn.turnId).length, 7);
  assert.equal(f.calls.generated.length, 6);
});

test("nudge joins an active observer without duplicate turn ownership", async () => {
  const f = fixture(), parentEvents: StorefrontObservation[] = [];
  const parent = new StorefrontObserver({ enabled: true, record: event => parentEvents.push(event) });
  await parent.turn(() => f.useCase.execute(input));
  assert.deepEqual(f.events, []); assert.equal(parentEvents.filter(event => event.stage === "turn").length, 1);
  assert.equal(ops(parentEvents).length, 7);
});

test("generation and semantic review usage are both counted once under the nudge turn", async () => {
  const metrics = new MetricsService(), f = fixture({ metrics }); let calls = 0;
  Object.assign(f.adapter, { copyService: new AgentCopyService({ chat: async () => {
    calls++; return { content: JSON.stringify(calls === 1
      ? { schemaVersion: 1, message: valid, offerIndex: null }
      : { schemaVersion: 1, verdict: "ALLOW", confidence: 0.99 }), usage };
  } }, { model: "openai/gpt-4o-mini" }) });
  assert.deepEqual(await f.useCase.execute(input), { message: valid });
  const provider = f.events.filter(event => event.kind === "operation" && event.stage === "provider");
  assert.equal(calls, 2); assert.equal(provider.length, 2);
  assert.ok(provider.every(event => event.promptTokens === 20 && event.completionTokens === 10));
  const generation = f.events.find(event => event.kind === "operation" && event.stage === "generation")!;
  assert.ok(provider.every(event => event.parentId === generation.operationId));
  assert.equal(f.events.filter(event => event.stage === "turn").length, 1);
  const text = await metrics.getMetrics();
  assert.ok(text.includes('storefront_llm_tokens_total{phase="nudge",provider="copy",kind="prompt"} 40'));
  assert.ok(text.includes('storefront_llm_tokens_total{phase="nudge",provider="copy",kind="completion"} 20'));
  assert.ok(!text.includes("boundary=")); privateAbsent([text, f.events, f.logs]);
});

test("provider failure caught by real copy service keeps its evidence without falsely failing generation", async () => {
  const f = fixture(); let calls = 0;
  Object.assign(f.adapter, { copyService: new AgentCopyService({ chat: async () => { calls++; throw new Error("PRIVATE_PROVIDER"); } }) });
  assert.deepEqual(await f.useCase.execute(input), { message: input.fallback }); assert.equal(calls, 1);
  assert.equal(f.events.find(event => event.kind === "operation" && event.stage === "provider")?.outcome, "error");
  assert.equal(f.events.find(event => event.kind === "operation" && event.stage === "generation")?.outcome, "ok");
  assert.ok(f.events.some(event => event.kind === "decision" && event.phase === "nudge" && event.reason === "exception"));
  privateAbsent([f.events, f.logs]);
});

test("nudge observation preserves trusted offer suffix exactly without new financial authorization", async () => {
  const f = fixture(); const offer = "desconto progressivo de até 10% ao concluir a compra";
  f.prisma.checkoutSetting.findUnique = async () => ({ interventionPolicy: { progressiveDiscount: { enabled: true, maxProgressivePercent: 10, mode: "progressive_only" } } }) as never;
  f.copy.generateNudge = async context => { f.calls.generated.push(context); return valid + nudgeOfferSuffix(offer); };
  assert.deepEqual(await f.useCase.execute(input), { message: valid + nudgeOfferSuffix(offer) });
  assert.equal(f.calls.generated.length, 1); assert.deepEqual(f.calls.generated[0]?.availableOffers, [offer]);
  assert.equal(f.events.filter(event => event.kind === "decision").length, 0);
});

test("nudge port cannot mutate offers to validate an invented benefit after observation", async () => {
  const f = fixture();
  f.copy.generateNudge = async context => { f.calls.generated.push(context); context.availableOffers.push("cupom PRIVATE_FAKE com 90% de desconto");
    return valid + nudgeOfferSuffix(context.availableOffers[0]!); };
  assert.deepEqual(await f.useCase.execute(input), { message: input.fallback });
  assert.equal(f.calls.generated.length, 1);
  assert.ok(f.events.some(event => event.kind === "decision" && event.boundary === "output" && event.reason === "invalid_output"));
  privateAbsent([f.events, f.logs]);
});

test("nudge read errors and caller correlation never enter projected observation", async () => {
  const f = fixture({ result: null });
  f.prisma.promptExperiment.findFirst = async () => { throw new Error("PRIVATE_SQL"); };
  await CorrelationIdStorage.run("PRIVATE_HEADER", () => f.useCase.execute(input));
  privateAbsent([f.events, f.logs]);
});

test("safe export keeps generation/fallback metadata and real span parentage", async () => {
  const memory = new InMemorySpanExporter();
  const sdk = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(new SafeSpanExporter(memory, "zyon-api"))] });
  trace.setGlobalTracerProvider(sdk);
  try {
    const f = fixture({ result: new Error("PRIVATE_EXCEPTION") });
    await f.useCase.execute({ ...input, fallback: "Seu pagamento foi aprovado." }); await sdk.forceFlush();
    const spans = memory.getFinishedSpans(), turn = spans.find(span => span.name === "storefront.turn")!;
    assert.ok(turn); assert.equal(spans.length, 6);
    assert.ok(spans.filter(span => span !== turn).every(span => span.parentSpanContext?.spanId === turn.spanContext().spanId));
    const generation = spans.find(span => span.name === "storefront.generation")!;
    assert.equal(generation.attributes["storefront.boundary"], "generation"); assert.equal(generation.status.code, 2);
    const fallback = spans.find(span => span.attributes["storefront.boundary"] === "fallback")!;
    assert.equal(fallback.events[0]?.attributes?.reason, "safety_rejected");
    assert.ok(turn.events.some(event => event.attributes?.stage === "generation" && event.attributes.boundary === "generation"));
    assert.ok(f.events.filter(event => event.kind === "decision").every(event => event.traceId === turn.spanContext().traceId && event.spanId));
    privateAbsent(spans.map(span => ({ name: span.name, attributes: span.attributes, events: span.events, status: span.status })));
  } finally { await sdk.shutdown(); trace.disable(); }
});

for (const observed of [true, false]) {
  test(`Nest nudge resolves optional observation: present=${observed}`, async () => {
    const f = fixture({ enabled: false }), events: StorefrontObservation[] = [];
    @Module({ providers: [GenerateNudgeUseCase,
      { provide: STOREFRONT_CONVERSATION_PORT, useValue: f.adapter }, { provide: PRISMA_CLIENT, useValue: f.prisma },
      ...(observed ? [{ provide: STOREFRONT_USE_CASE_OBSERVATION, useValue: new StorefrontUseCaseObserver({ enabled: true, record: event => events.push(event) }) }] : [])] })
    class LocalModule {}
    const app = await NestFactory.createApplicationContext(LocalModule, { logger: false });
    try {
      assert.deepEqual(await app.get(GenerateNudgeUseCase).execute(input), { message: valid });
      assert.equal(events.filter(event => event.stage === "turn").length, observed ? 1 : 0);
      assert.equal(f.calls.generated.length, 1);
    } finally { await app.close(); }
  });
}

test("nudge application depends only on observation port, not SDK or infrastructure observer", async () => {
  const source = await readFile(new URL("../../../../../src/modules/storefront/application/use-cases/generate-nudge.use-case.ts", import.meta.url), "utf8");
  assert.match(source, /@Inject\(STOREFRONT_USE_CASE_OBSERVATION\)/);
  assert.doesNotMatch(source, /from ["'][^"']*(?:infrastructure\/observability|@opentelemetry)/);
});


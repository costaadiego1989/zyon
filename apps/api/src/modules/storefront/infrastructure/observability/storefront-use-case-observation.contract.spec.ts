import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { SendStoreMessageUseCase, type SendStoreMessageInput } from "../../application/use-cases/send-store-message.use-case.js";
import { StorefrontUseCaseObserver, storefrontUseCaseObservationProvider } from "./storefront-use-case-observer.js";
import { StorefrontObserver, observeStorefrontOperation, type StorefrontObservation } from "./storefront-observation.js";
import { STOREFRONT_USE_CASE_OBSERVATION } from "../../domain/ports/storefront-use-case-observation.port.js";
import { MetricsService } from "../../../../shared/observability/metrics.service.js";
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { trace } from "@opentelemetry/api";
import { SafeSpanExporter } from "../../../../shared/observability/safe-span-exporter.js";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { MERCHANT_REPOSITORY } from "../../../merchant/domain/ports/merchant-repository.port.js";
import { STOREFRONT_CONVERSATION_PORT } from "../../domain/ports/conversation.port.js";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { BUYER_CONVERSATION_REPOSITORY } from "../../../buyer-account/domain/ports/buyer-conversation.port.js";
import { StorefrontConversationAdapter } from "../adapters/storefront-conversation.adapter.js";
import { CorrelationIdStorage } from "../../../../shared/logger/correlation-id.storage.js";
import { MERCHANT_AGENT_RULE_READER } from "../../../agent-rules/domain/ports/merchant-agent-rule-reader.port.js";
import { PrismaMerchantAgentRuleReader } from "../../../agent-rules/infrastructure/merchant-agent-rule-reader.adapter.js";

const input: SendStoreMessageInput = { merchant_id: "PRIVATE_MERCHANT", conversation_id: "PRIVATE_SESSION",
  cart_id: "PRIVATE_SESSION", user_message: "PRIVATE_BUYER_MESSAGE", global_user_id: "PRIVATE_BUYER" };
const reply = { message: "PRIVATE_AGENT_MESSAGE", blocks: [], cartId: input.cart_id, suggestedNext: [] };
function fixture(options: { enabled?: boolean; result?: unknown; record?: () => void } = {}) {
  const events: StorefrontObservation[] = [], logs: unknown[] = [];
  const calls = { reads: 0, generation: 0, writes: [] as unknown[] };
  const observer = new StorefrontUseCaseObserver({ enabled: options.enabled ?? true,
    record: event => { events.push(event); options.record?.(); } });
  const adapterObserver = new StorefrontObserver({ enabled: options.enabled ?? true, record: event => events.push(event) });
  const merchant = { getProfile: async () => { calls.reads++; return { name: "PRIVATE_STORE", storeCategory: "others" }; },
    getStoreSettings: async () => ({}) };
  const conversation = { reply: async (_value: unknown) => adapterObserver.turn(() => observeStorefrontOperation("agent", async () => {
    calls.generation++; return options.result === undefined ? reply : options.result;
  })) };
  const prisma = { agentRule: { findFirst: async () => null }, merchantRule: { findUnique: async () => null },
    checkoutSetting: { findUnique: async () => null }, promptExperiment: { findFirst: async () => null },
    buyerAccount: { findUnique: async () => null } };
  const repository = { upsertConversation: async (value: unknown) => { calls.writes.push(value); } };
  const reader = new PrismaMerchantAgentRuleReader(prisma as never);
  const useCase = new SendStoreMessageUseCase(merchant as never, conversation as never, prisma as never, reader, repository as never, observer);
  Object.assign(useCase, { logger: { log: (...args: unknown[]) => logs.push(args), debug: (...args: unknown[]) => logs.push(args), warn: (...args: unknown[]) => logs.push(args) } });
  return { useCase, observer, adapterObserver, events, logs, calls, merchant, conversation, prisma, reader, repository };
}
const operations = (events: StorefrontObservation[]) => events.filter(event => event.kind === "operation");
const privateAbsent = (value: unknown) => assert.ok(!JSON.stringify(value).includes("PRIVATE"));

test("use-case boundary observes validations and both writes in the adapter's single turn", async () => {
  const f = fixture();
  assert.deepEqual(await f.useCase.execute(input), { message: reply.message, blocks: [], cart_id: input.cart_id,
    conversation_id: input.conversation_id, suggested_next: [] });
  const ops = operations(f.events), turn = ops.find(event => event.stage === "turn")!;
  assert.equal(ops.filter(event => event.stage === "turn").length, 1);
  assert.deepEqual(ops.filter(event => event.stage === "validation").map(event => event.boundary), ["input", "context", "output", "response"]);
  assert.deepEqual(ops.filter(event => event.stage === "persistence").map(event => event.boundary), ["buyer_message", "agent_message"]);
  assert.ok(ops.filter(event => event !== turn).every(event => event.parentId === turn.operationId));
  assert.ok(f.events.every(event => event.turnId === turn.turnId));
  assert.equal(f.calls.generation, 1); assert.equal(f.calls.writes.length, 2);
  privateAbsent([f.events, f.logs]);
});

for (const body of [null, { ...input, user_message: "" }, { ...input, merchant_id: "", PRIVATE_EXTRA: true }]) {
  test(`invalid input is observed before reads, generation or writes: ${body === null ? "null" : Object.keys(body).length}`, async () => {
    const f = fixture();
    await assert.rejects(f.useCase.execute(body as never), (e: any) => e.getStatus() === 400);
    assert.equal(f.calls.reads, 0); assert.equal(f.calls.generation, 0); assert.equal(f.calls.writes.length, 0);
    assert.ok(f.events.some(event => event.kind === "decision" && event.boundary === "input" && event.outcome === "rejected" && event.reason === "invalid_input"));
    assert.equal(f.events.find(event => event.stage === "turn")?.outcome, "error");
    privateAbsent([f.events, f.logs]);
  });
}

test("invalid server context rejects before adapter and records no context values", async () => {
  const f = fixture();
  f.prisma.agentRule.findFirst = async () => ({ identity: { tone: { PRIVATE_CONTEXT: "PRIVATE" } } }) as never;
  await assert.rejects(f.useCase.execute(input), (e: any) => e.getStatus() === 503);
  assert.equal(f.calls.generation, 0); assert.deepEqual(f.calls.writes, []);
  assert.ok(f.events.some(event => event.kind === "decision" && event.boundary === "context" && event.reason === "invalid_context"));
  privateAbsent([f.events, f.logs]);
});

for (const result of [null, { ...reply, cartId: "PRIVATE_FOREIGN_CART" }, { ...reply, blocks: [{ type: "PRIVATE_UNKNOWN", data: {} }] }]) {
  test(`invalid output falls back without replay, including scope: ${result === null ? "null" : "cartId" in result && result.cartId === "PRIVATE_FOREIGN_CART" ? "scope" : "block"}`, async () => {
    const f = fixture({ result });
    const output = await f.useCase.execute(input);
    assert.notEqual(output.message, reply.message); assert.deepEqual(output.blocks, []);
    assert.equal(f.calls.generation, 1); assert.equal(f.calls.writes.length, 2);
    assert.equal((f.calls.writes[1] as any).message.content, output.message);
    assert.ok(f.events.some(event => event.kind === "decision" && event.boundary === "output" && event.outcome === "fallback" && event.reason === "invalid_output"));
    privateAbsent([f.events, f.logs]);
  });
}

for (const failAt of [1, 2]) {
  test(`persistence failure at write ${failAt} preserves response and never retries`, async () => {
    const f = fixture(); let attempted = 0;
    f.repository.upsertConversation = async value => { f.calls.writes.push(value); if (++attempted === failAt) throw new Error("PRIVATE_DB_SQL_AND_CREDENTIALS"); };
    assert.equal((await f.useCase.execute(input)).message, reply.message);
    assert.equal(attempted, failAt); assert.equal(f.calls.generation, 1);
    const writes = operations(f.events).filter(event => event.stage === "persistence");
    assert.equal(writes.length, failAt); assert.equal(writes.at(-1)?.outcome, "error");
    assert.equal(writes.at(-1)?.reason, "exception");
    assert.equal(f.events.find(event => event.stage === "turn")?.outcome, "ok", "best-effort write failure must not masquerade as a failed reply");
    privateAbsent([f.events, f.logs]);
  });
}

test("anonymous turn has no persistence operation or fabricated write success", async () => {
  const f = fixture(); await f.useCase.execute({ ...input, global_user_id: undefined });
  assert.deepEqual(f.calls.writes, []); assert.equal(f.events.filter(event => event.stage === "persistence").length, 0);
});

test("missing optional repository emits no fabricated persistence operation", async () => {
  const f = fixture(); Object.assign(f.useCase, { conversationRepo: undefined });
  await f.useCase.execute(input); assert.equal(f.events.filter(event => event.stage === "persistence").length, 0);
});

test("merchant miss retains 404 and no adapter or persistence work", async () => {
  const f = fixture(); f.merchant.getProfile = async () => null as never;
  await assert.rejects(f.useCase.execute(input), (e: any) => e.getStatus() === 404);
  assert.equal(f.calls.generation, 0); assert.deepEqual(f.calls.writes, []);
  assert.equal(f.events.find(event => event.stage === "turn")?.outcome, "error");
});

test("adapter exception preserves exact identity and performs no writes", async () => {
  const f = fixture(), error = new Error("PRIVATE_PROVIDER_ERROR");
  f.conversation.reply = async () => { f.calls.generation++; throw error; };
  await assert.rejects(f.useCase.execute(input), e => e === error);
  assert.equal(f.calls.generation, 1); assert.deepEqual(f.calls.writes, []); privateAbsent(f.events);
});

test("disabled flag preserves behavior and emits no observations", async () => {
  const f = fixture({ enabled: false }); await f.useCase.execute(input);
  assert.deepEqual(f.events, []); assert.equal(f.calls.writes.length, 2); assert.equal(f.calls.generation, 1);
});

test("recorder failure cannot change the response or replay generation and writes", async () => {
  const f = fixture({ record: () => { throw new Error("PRIVATE_LOG_FAILURE"); } });
  assert.equal((await f.useCase.execute(input)).message, reply.message);
  assert.equal(f.calls.generation, 1); assert.equal(f.calls.writes.length, 2);
});

test("parallel use cases keep input, adapter and writes in separate correlations", async () => {
  const f = fixture(); await Promise.all(Array.from({ length: 6 }, () => f.useCase.execute(input)));
  const turns = f.events.filter(event => event.stage === "turn");
  assert.equal(new Set(turns.map(event => event.turnId)).size, 6);
  for (const turn of turns) assert.equal(operations(f.events).filter(event => event.turnId === turn.turnId).length, 8);
  assert.equal(f.calls.generation, 6); assert.equal(f.calls.writes.length, 12);
});

test("optional read failures and experiment metadata do not leak into use-case logs", async () => {
  const f = fixture();
  f.prisma.checkoutSetting.findUnique = async () => { throw new Error("PRIVATE_SQL"); };
  f.prisma.promptExperiment.findFirst = async () => ({ id: "PRIVATE_EXP", variants: [{ weight: 1, name: "PRIVATE_VARIANT", systemPrompt: "PRIVATE_PROMPT" }] }) as never;
  await f.useCase.execute(input); privateAbsent([f.events, f.logs]);
  f.prisma.promptExperiment.findFirst = async () => { throw new Error("PRIVATE_CREDENTIALS"); };
  await f.useCase.execute(input); privateAbsent([f.events, f.logs]);
});

test("persistence metrics use only bounded labels, not identities or boundaries", async () => {
  const metrics = new MetricsService(), f = fixture();
  Object.assign(f.useCase, { observation: new StorefrontUseCaseObserver({ enabled: true, metrics }) });
  f.repository.upsertConversation = async () => { throw new Error("PRIVATE_DB"); };
  await f.useCase.execute(input);
  const text = await metrics.getMetrics();
  assert.ok(text.includes('storefront_llm_operations_total{stage="persistence",outcome="error",reason="exception"} 1'));
  assert.ok(!text.includes("boundary=")); privateAbsent(text);
});

test("safe exporter keeps validation and persistence spans and bounded boundary decisions", async () => {
  const memory = new InMemorySpanExporter();
  const sdk = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(new SafeSpanExporter(memory, "zyon-api"))] });
  trace.setGlobalTracerProvider(sdk);
  try {
    const f = fixture({ result: null }); await f.useCase.execute(input); await sdk.forceFlush();
    const spans = memory.getFinishedSpans(), root = spans.find(span => span.name === "storefront.turn")!;
    assert.equal(spans.length, 8); assert.ok(root);
    assert.ok(spans.filter(span => span !== root).every(span => span.parentSpanContext?.spanId === root.spanContext().spanId));
    assert.deepEqual(spans.filter(span => span.name === "storefront.persistence").map(span => span.attributes["storefront.boundary"]), ["buyer_message", "agent_message"]);
    const output = spans.find(span => span.attributes["storefront.boundary"] === "output")!;
    assert.equal(output.events[0]?.attributes?.boundary, "output");
    assert.equal(output.events[0]?.attributes?.reason, "invalid_output");
    assert.ok(f.events.filter(event => event.kind === "decision").every(event => event.traceId === root.spanContext().traceId && event.spanId));
    privateAbsent(spans.map(span => ({ name: span.name, attributes: span.attributes, events: span.events, status: span.status })));
    const span = sdk.getTracer("test").startSpan("storefront.persistence", { attributes: { "storefront.boundary": "PRIVATE_VALUE" } });
    span.addEvent("storefront.decision", { stage: "persistence", outcome: "error", reason: "exception", boundary: "PRIVATE_VALUE" });
    span.end(); await sdk.forceFlush();
    assert.equal(memory.getFinishedSpans().at(-1)?.attributes["storefront.boundary"], undefined);
    assert.deepEqual(memory.getFinishedSpans().at(-1)?.events, []);
  } finally { await sdk.shutdown(); trace.disable(); }
});

test("Nest resolves the optional observation token and production provider stays opt-in", async () => {
  const previous = process.env.STOREFRONT_LLM_OBSERVABILITY;
  delete process.env.STOREFRONT_LLM_OBSERVABILITY;
  const f = fixture();
  @Module({ providers: [SendStoreMessageUseCase, storefrontUseCaseObservationProvider,
    { provide: MERCHANT_REPOSITORY, useValue: f.merchant }, { provide: STOREFRONT_CONVERSATION_PORT, useValue: f.conversation },
    { provide: MERCHANT_AGENT_RULE_READER, useValue: f.reader },
    { provide: PRISMA_CLIENT, useValue: f.prisma }, { provide: BUYER_CONVERSATION_REPOSITORY, useValue: f.repository }] })
  class LocalModule {}
  const app = await NestFactory.createApplicationContext(LocalModule, { logger: false });
  try {
    assert.ok(app.get(STOREFRONT_USE_CASE_OBSERVATION) instanceof StorefrontUseCaseObserver);
    const events: unknown[] = [];
    const observer = app.get(STOREFRONT_USE_CASE_OBSERVATION) as unknown as { options: { enabled?: boolean; record: (event: unknown) => void } };
    assert.equal(observer.options.enabled, false);
    observer.options.record = event => events.push(event);
    assert.equal((await app.get(SendStoreMessageUseCase).execute(input)).message, reply.message);
    assert.deepEqual(events, []); assert.equal(f.calls.writes.length, 2);
  } finally {
    await app.close();
    if (previous === undefined) delete process.env.STOREFRONT_LLM_OBSERVABILITY; else process.env.STOREFRONT_LLM_OBSERVABILITY = previous;
  }
});

test("real adapter entrypoint joins an existing use-case turn instead of opening another", async () => {
  const f = fixture();
  const adapter = Object.create(StorefrontConversationAdapter.prototype) as StorefrontConversationAdapter;
  Object.assign(adapter, { observer: f.adapterObserver, replyTurn: async () => {
    f.calls.generation++;
    return observeStorefrontOperation("agent", async () => reply);
  } });
  f.conversation.reply = value => adapter.reply(value as never);
  await f.useCase.execute(input);
  assert.equal(f.events.filter(event => event.stage === "turn").length, 1);
  assert.equal(new Set(f.events.map(event => event.turnId)).size, 1);
  assert.equal(f.calls.generation, 1); assert.equal(f.calls.writes.length, 2);
});

test("an already active observer remains the owner without duplicate outer turns", async () => {
  const f = fixture(), parentEvents: StorefrontObservation[] = [];
  const parent = new StorefrontObserver({ enabled: true, record: event => parentEvents.push(event) });
  await parent.turn(() => f.useCase.execute(input));
  assert.deepEqual(f.events, []);
  assert.equal(parentEvents.filter(event => event.stage === "turn").length, 1);
  assert.equal(operations(parentEvents).length, 8);
});

test("untrusted request correlation is not copied into projected use-case metadata", async () => {
  const f = fixture({ result: null });
  await CorrelationIdStorage.run("PRIVATE_INCOMING_HEADER", () => f.useCase.execute(input));
  privateAbsent([f.events, f.logs]);
});

test("unknown boundary metadata is discarded without suppressing or replaying work", async () => {
  const events: StorefrontObservation[] = [];
  const observer = new StorefrontUseCaseObserver({ enabled: true, record: event => events.push(event) });
  let calls = 0;
  await observer.turn(() => observer.operation("persistence", "PRIVATE_BOUNDARY" as never, async () => ++calls));
  assert.equal(calls, 1); assert.equal(events.length, 2);
  assert.equal(events.find(event => event.stage === "persistence")?.boundary, undefined);
  privateAbsent(events);
});

test("enabled production factory uses injected metrics without changing its flag in memory", async () => {
  const previous = process.env.STOREFRONT_LLM_OBSERVABILITY;
  process.env.STOREFRONT_LLM_OBSERVABILITY = "enabled";
  try {
    const metrics = new MetricsService();
    const observer = storefrontUseCaseObservationProvider.useFactory(metrics) as StorefrontUseCaseObserver;
    const state = observer as unknown as { options: { enabled?: boolean; record: (event: unknown) => void } };
    const events: unknown[] = []; assert.equal(state.options.enabled, true);
    state.options.record = event => events.push(event);
    await observer.turn(() => observer.operation("validation", "input", async () => undefined));
    assert.equal(events.length, 2);
    assert.ok((await metrics.getMetrics()).includes('storefront_llm_operations_total{stage="validation",outcome="ok",reason="completed"} 1'));
  } finally {
    if (previous === undefined) delete process.env.STOREFRONT_LLM_OBSERVABILITY; else process.env.STOREFRONT_LLM_OBSERVABILITY = previous;
  }
});

test("persistence remains awaited and sequential rather than becoming fire-and-forget", async () => {
  const f = fixture(), order: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  f.repository.upsertConversation = async value => {
    f.calls.writes.push(value);
    if (f.calls.writes.length === 1) { order.push("buyer_started"); await gate; order.push("buyer_finished"); }
    else order.push("agent_finished");
  };
  let completed = false;
  const task = f.useCase.execute(input).then(output => { completed = true; return output; });
  // Let the first async write begin, without real timers or external storage.
  for (let i = 0; i < 100 && order.length === 0; i++) await Promise.resolve();
  try {
    assert.deepEqual(order, ["buyer_started"]); assert.equal(completed, false);
    assert.equal(f.events.filter(event => event.stage === "persistence").length, 0);
  } finally { release(); }
  await task;
  assert.deepEqual(order, ["buyer_started", "buyer_finished", "agent_finished"]);
  assert.equal(f.events.filter(event => event.stage === "persistence").length, 2);
});

function requireObservationProviderRegistration(moduleSource: string): ts.Identifier {
  const source = ts.createSourceFile("storefront.module.ts", moduleSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const declaration = source.statements.find((node): node is ts.ClassDeclaration =>
    ts.isClassDeclaration(node) && node.name?.text === "StorefrontModule");
  assert.ok(declaration, "storefront_module_class_required");
  const decorator = ts.getDecorators(declaration)?.find(node => ts.isCallExpression(node.expression)
    && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === "Module");
  assert.ok(decorator && ts.isCallExpression(decorator.expression), "storefront_module_decorator_required");
  const metadata = decorator.expression.arguments[0];
  assert.ok(metadata && ts.isObjectLiteralExpression(metadata), "storefront_module_metadata_required");
  const providers = metadata.properties.find((node): node is ts.PropertyAssignment => ts.isPropertyAssignment(node)
    && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) && node.name.text === "providers");
  assert.ok(providers && ts.isArrayLiteralExpression(providers.initializer), "storefront_module_provider_array_required");
  const registrations = providers.initializer.elements.filter((node): node is ts.Identifier =>
    ts.isIdentifier(node) && node.text === "storefrontUseCaseObservationProvider");
  assert.equal(registrations.length, 1, "observation_provider_registration_required_exactly_once");
  return registrations[0]!;
}

test("composition root registers observation without adding infrastructure observability/OTel imports to application", async () => {
  const source = await readFile(new URL("../../../../../src/modules/storefront/application/use-cases/send-store-message.use-case.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /from ["'][^"']*(?:infrastructure\/observability|@opentelemetry)/);
  const module = await readFile(new URL("../../../../../src/modules/storefront/storefront.module.ts", import.meta.url), "utf8");
  requireObservationProviderRegistration(module);
});

test("composition registration permits other providers first but not exports or comments in place of membership", () => {
  requireObservationProviderRegistration(`@Module({ providers: [OtherProvider, storefrontUseCaseObservationProvider] }) class StorefrontModule {}`);
  for (const metadata of [
    `providers: [OtherProvider], exports: [storefrontUseCaseObservationProvider]`,
    `providers: [OtherProvider /* storefrontUseCaseObservationProvider */]`,
    `providers: ["storefrontUseCaseObservationProvider"]`,
    `providers: [storefrontUseCaseObservationProvider, storefrontUseCaseObservationProvider]`,
  ]) assert.throws(() => requireObservationProviderRegistration(`@Module({ ${metadata} }) class StorefrontModule {}`),
    /observation_provider_registration_required_exactly_once/);
});

test("removing observation provider from the real composition root fails the structural contract", async () => {
  const module = await readFile(new URL("../../../../../src/modules/storefront/storefront.module.ts", import.meta.url), "utf8");
  const registration = requireObservationProviderRegistration(module);
  const withoutProvider = module.slice(0, registration.getStart()) + module.slice(registration.getEnd());
  assert.throws(() => requireObservationProviderRegistration(withoutProvider), /observation_provider_registration_required_exactly_once/);
});


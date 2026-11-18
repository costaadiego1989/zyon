import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createHash } from "node:crypto";
import { StorefrontConversationAdapter } from "./storefront-conversation.adapter.js";
import { PublicBusinessAnswerSession, type SessionDependencies } from "../../../knowledge-base/application/services/public-business-answer-session.js";
import type { StorefrontConversationInput } from "../../domain/ports/conversation.port.js";
import type { StorefrontServiceRead } from "../agents/store-langgraph-agent.js";
import type { BusinessRequestKind } from "../../../knowledge-base/domain/business-answer-request.js";
import type { LiveBusinessSnapshot } from "../../../knowledge-base/application/services/public-business-answer-session.js";
import { InMemorySupportTicketRepository } from "../../../support/infrastructure/in-memory-support-ticket.repository.js";
import { SupportHandoffService } from "../../../support/application/support-handoff.service.js";
import { SupportTicketEventPublisher } from "../../../support/application/support-ticket-event.publisher.js";

const merchantId = "synthetic-t71-store";
const input: StorefrontConversationInput = { merchantId, sessionId: "turn", storeCategory: "services", history: [],
  userMessage: "Conte sobre a empresa", merchantName: "OLD_DIRECT_BRAND",
  storeSettings: { company: { description: "OLD_DIRECT_COMPANY" } } };
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
async function fixture(t: TestContext, purpose: "knowledge" | "existing_company_context" = "knowledge", live = false) {
  for (const [name, value] of Object.entries({ LOCAL_LLM_API_KEY: "synthetic-t71-no-network",
    STOREFRONT_SEMANTIC_ROUTING: "structured", STOREFRONT_LLM_OBSERVABILITY: "disabled" })) {
    const before = process.env[name]; process.env[name] = value;
    t.after(() => { if (before === undefined) delete process.env[name]; else process.env[name] = before; });
  }
  let content = "CURRENT_CANONICAL_COMPANY", modeCurrent = true, opened = 0, captures = 0;
  const handles = new WeakMap<object, string>();
  const reference = () => ({ id: "canonical-company", content, provenance: { origin: "canonical_sql", namespace: "canonical-public",
    merchantId, sourceType: "company", sourceId: merchantId, sourceVersion: "opaque-version", sourceHash: sha(content),
    publicationState: "published", publicWorkVersion: null, embeddingModel: null, embeddingDimensions: null,
    chunkId: "company", contentHash: sha(content) } });
  const evidence = () => live ? [reference(), ...(["service", "professional"] as const).map(type => ({ ...reference(), id: type,
    provenance: { ...reference().provenance, sourceType: type, sourceId: type, chunkId: type } }))] : [reference()];
  const pairs = live ? [{ serviceEvidenceId: "service", professionalEvidenceId: "professional" }] : [];
  const deps = { scope: { assertScope(id: string) { assert.equal(id, merchantId); } }, billing: { async assertAllowed() {} },
    canonical: { async read(request: any) {
      assert.equal(request.merchantId, merchantId); const selection = Object.freeze({}); handles.set(selection, content);
      return { status: "ready", mode: "sources", evidence: evidence(), pairs, partial: true, selection };
    }, async recheck(id: string, selection: object) {
      assert.equal(id, merchantId);
      return handles.get(selection) === content ? { status: "current", evidence: evidence(), pairs }
        : { status: "changed", evidence: [], pairs: [] };
    } }, publicSources: {} } as unknown as SessionDependencies;
  const sessionResult = await PublicBusinessAnswerSession.open({ merchantId, purpose }, deps);
  assert.equal(sessionResult.status, "ready"); if (sessionResult.status !== "ready") assert.fail("test_session_required");
  const session = sessionResult.session;
  const prisma = new Proxy({}, { get(_target, key) {
    if (key === "storefrontWishlistItem") return {};
    assert.fail("unexpected_persistence:" + String(key));
  } });
  const tickets = new InMemorySupportTicketRepository();
  const adapter = new StorefrontConversationAdapter({} as never, {} as never, {} as never,
    { getOrCreate: async () => ({ merchantId, sessionId: "turn", items: [], total: 0 }) } as never, prisma as never,
    new SupportHandoffService(tickets, new SupportTicketEventPublisher()));
  const knowledge = { async openBusinessAnswer(value: unknown) {
    opened++; assert.deepEqual(value, { merchantId, fallbackPurpose: "existing_company_context" });
    return { kind: "services", session, purpose, async assertCurrentServiceMode() { if (!modeCurrent) throw Error("service_mode_changed"); } };
  }, async captureBusinessKnowledge(selected: PublicBusinessAnswerSession, value: any) {
    captures++; assert.equal(purpose, "knowledge"); assert.equal(selected, session); assert.equal(value.merchantId, merchantId);
    assert.equal(value.queryText, input.userMessage); assert.equal(value.mode, "sources");
    const result = await session.captureCanonical({ merchantId, mode: "sources", limit: 20 });
    return { status: result.status, arm: "canonical_sql" };
  }, async execute() { assert.fail("service_turn_must_not_reuse_legacy_context"); } };
  Object.defineProperty(adapter, "queryKnowledge", { value: knowledge });
  const prepared: unknown[] = [], runContexts: any[] = [];
  let generatedMessage = "Current company answer", blocks: unknown[] = [];
  let serviceRequest: BusinessRequestKind | undefined;
  let duringRun: (callback?: StorefrontServiceRead) => Promise<void> = async () => {};
  Object.defineProperty(adapter, "agent", { value: { async prepare(value: unknown) {
    prepared.push(value); return { allowed: true, serviceRequest, async run(context: unknown, callback?: StorefrontServiceRead) {
      await duringRun(callback);
      runContexts.push(context); return { message: generatedMessage, blocks, cartId: "turn", toolsUsed: [],
        routing: { source: "structured", intent: "COMPLEX_QUESTION", confidence: 1, needsProductDiscovery: false },
        safetyValidation: { safe: true } };
    } };
  } }, configurable: true });
  const records: Array<{ admission: any; context: unknown }> = [];
  const reply = (extra: Partial<StorefrontConversationInput> = {}) => adapter.reply(structuredClone({ ...input, ...extra }), undefined,
    (admission, context) => { records.push({ admission, context }); });
  return { adapter, knowledge, prepared, runContexts, records, reply, session, tickets,
    kind: (kind: BusinessRequestKind) => { serviceRequest = kind; },
    onRun: (callback: (read?: StorefrontServiceRead) => Promise<void>) => { duringRun = callback; },
    counts: () => ({ opened, captures }), change: () => { content = "CHANGED_CANONICAL_COMPANY"; },
    changeMode: () => { modeCurrent = false; }, emptyMessage: () => {
      generatedMessage = ""; blocks = [{ type: "notice", data: { message: "Synthetic presentation" } }];
    } };
}

test("T71 service adapter uses one selected source session and captures final canonical proof", async t => {
  const f = await fixture(t), result = await f.reply();
  assert.equal(result.message, "Current company answer"); assert.deepEqual(f.counts(), { opened: 1, captures: 1 });
  assert.equal(f.runContexts.length, 1); assert.equal(f.runContexts[0].groundedBusinessContext, true);
  assert.ok(f.runContexts[0].knowledgeContext.includes("CURRENT_CANONICAL_COMPANY"));
  assert.equal(f.runContexts[0].knowledgeContext.includes("OLD_DIRECT_COMPANY"), false);
  assert.equal(f.records.length, 1); assert.equal(f.records[0].context, "services");
  assert.equal(f.records[0].admission.status, "ready");
  assert.equal(f.records[0].admission.evidence[0].provenance.origin, "canonical_sql");
});
test("T71 source change during final copy discards both old text and presentation blocks", async t => {
  const f = await fixture(t); f.emptyMessage();
  Object.defineProperty(f.adapter, "copyService", { value: { async generateVariantCopy() { f.change(); return "DISCARDED_OLD_COPY"; } } });
  const result = await f.reply();
  assert.equal(result.message.includes("DISCARDED_OLD_COPY"), false); assert.deepEqual(result.blocks, []);
  assert.equal(f.records[0].admission.status, "insufficient"); assert.deepEqual(f.records[0].admission.evidence, []);
});
test("T71 mode change during the turn refuses the old service reply", async t => {
  const f = await fixture(t); f.emptyMessage();
  Object.defineProperty(f.adapter, "copyService", { value: { async generateVariantCopy() { f.changeMode(); return "DISCARDED_SERVICE_REPLY"; } } });
  const result = await f.reply(); assert.equal(result.message.includes("DISCARDED_SERVICE_REPLY"), false);
  assert.deepEqual(result.blocks, []); assert.equal(f.records[0].admission.status, "unavailable");
});
test("T71 a narrow company context does not invoke general semantic knowledge retrieval", async t => {
  const f = await fixture(t, "existing_company_context"); await f.reply();
  assert.deepEqual(f.counts(), { opened: 1, captures: 0 });
  assert.ok(f.runContexts[0].knowledgeContext.includes("CURRENT_CANONICAL_COMPANY"));
});
test("T71 terminal scope refusal does not open or read a public business session", async t => {
  const f = await fixture(t);
  Object.defineProperty(f.adapter, "agent", { value: { async prepare() {
    return { allowed: false, result: { message: "Scope refused" } };
  } } });
  const result = await f.reply(); assert.equal(result.message, "Scope refused");
  assert.deepEqual(f.counts(), { opened: 0, captures: 0 }); assert.deepEqual(f.records, []);
});

test("T71 service adapter performs existing scoped handoff before any regulated-decision generation", async t => {
  const f = await fixture(t); f.kind("professional_decision");
  const result = await f.reply({ cartId: "a-different-commerce-cart" }), tickets = await f.tickets.list(merchantId);
  assert.equal(tickets.length, 1); assert.equal(tickets[0]!.sessionId, "turn");
  assert.match(result.message, /Referência:/); assert.equal(f.runContexts.length, 0);
  assert.deepEqual(f.counts(), { opened: 1, captures: 0 }); assert.deepEqual(result.blocks, []);
  assert.equal(f.records[0].admission.status, "insufficient"); assert.deepEqual(f.records[0].admission.evidence, []);
});

test("T71 service adapter replaces generated live text and blocks with final canonical machine facts", async t => {
  const f = await fixture(t, "knowledge", true); f.kind("live_facts"); f.emptyMessage();
  const request = { productId: "service", professionalId: "professional", fromDate: "2030-01-02", toDate: "2030-01-02" };
  let price = 6100;
  Object.defineProperty(f.knowledge, "attachBusinessLiveRequest", { value: async (session: unknown, value: any) => {
    assert.equal(session, f.session); assert.deepEqual(value, { merchantId, request });
    f.session.attachLive({ ...request, variantId: "variant" }, async () => ({
      facts: { merchantId, productId: "service", variantId: "variant", professionalId: "professional", priceInCents: price,
        currency: "BRL", durationMinutes: 30, timeZone: "UTC", professionalVersion: 1 },
      availability: { status: "empty", slots: [], policyVersion: 1, professionalVersion: 1, timeZone: "UTC", durationMinutes: 30 },
      publicLabels: { serviceName: "Current service", professionalName: "Current professional" },
    } as LiveBusinessSnapshot)); return { status: "attached" };
  } });
  f.onRun(async read => { assert.ok(read); assert.deepEqual(await read(request), { status: "attached" }); price = 7900; });
  Object.defineProperty(f.adapter, "copyService", { value: { async generateVariantCopy() { assert.fail("live_facts_must_not_be_narrated"); } } });
  const result = await f.reply(); assert.match(result.message, /79,00/); assert.doesNotMatch(result.message, /61,00/);
  assert.match(result.message, /período consultado/); assert.deepEqual(result.blocks, []);
  assert.equal(f.records[0].admission.status, "ready"); assert.equal(f.records[0].admission.evidence.length, 3);
});

test("T71 required live response with an absent or failed tool selection cannot retain generated facts", async t => {
  for (const selected of [false, true]) {
    const f = await fixture(t); f.kind("live_facts");
    if (selected) {
      Object.defineProperty(f.knowledge, "attachBusinessLiveRequest", { value: async () => ({ status: "clarification", reason: "variant_required" }) });
      f.onRun(async read => { assert.ok(read); await read({ productId: "service", professionalId: "professional" }); });
    }
    const result = await f.reply(); assert.doesNotMatch(result.message, /Current company answer/);
    assert.deepEqual(result.blocks, []); assert.notEqual(f.records[0].admission.status, "ready");
    assert.deepEqual(f.records[0].admission.evidence, []);
  }
});

test("T57 professional referral preserves canonical handoff when ordinary tool admission refuses", async t => {
  const f = await fixture(t); f.kind("professional_decision");
  const service = (f.adapter as unknown as { handlerDeps: { supportHandoff: SupportHandoffService } }).handlerDeps.supportHandoff;
  Object.defineProperty(service, "createToolHandoff", { value: async () => {
    throw Error("ordinary_tool_must_not_own_professional_referral");
  } });
  const result = await f.reply({ userMessage: "Que tratamento devo seguir?", cartId: "preserved-product-cart" });
  const tickets = await f.tickets.list(merchantId);
  assert.equal(tickets.length, 1);
  assert.equal(tickets[0]!.merchantId, merchantId);
  assert.equal(tickets[0]!.sessionId, "turn");
  assert.equal(tickets[0]!.buyerMessage, "Decisão profissional individual: Que tratamento devo seguir?");
  assert.match(result.message, /Referência:/);
  assert.equal(result.cartId, "preserved-product-cart");
  assert.deepEqual(result.blocks, []);
  assert.equal(f.runContexts.length, 0);
});
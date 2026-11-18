import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { CashbackAssistantContext } from "./cashback-assistant.context.js";
import { CashbackService } from "./cashback.service.js";
import { CashbackRepository } from "../infrastructure/cashback.repository.js";
import { cashbackConfigurationFixture, configurationRules } from "../infrastructure/__tests__/cashback-configuration.fixture.js";
import { PrismaAssistantRepository } from "../../merchant-assistant/infrastructure/prisma-assistant.repository.js";
import { AssistantService } from "../../merchant-assistant/application/assistant.service.js";
import { AssistantKnowledgeRetriever } from "../../merchant-assistant/infrastructure/assistant-knowledge.retriever.js";
import { decideAccess, parseGrants, type AiPolicy } from "../../ai-governance/ai-access-policy.js";
import { AssistantError, type AssistantScope } from "../../merchant-assistant/domain/assistant.port.js";

let f: Awaited<ReturnType<typeof cashbackConfigurationFixture>>, repo: PrismaAssistantRepository, now: Date, policy: AiPolicy | null;
const scope = { merchantId: "merchant-a", actorId: "owner-a", context: "cashback" };
const clock = () => now;
const authorizeActor = async (actor: AssistantScope) => { if (actor.actorId !== "owner-a" || !["merchant-a", "merchant-b"].includes(actor.merchantId)) throw new AssistantError("assistant_forbidden", 403); };
const context = (service = f.service) => new CashbackAssistantContext({ service, conversations: repo, authorizeActor, clock,
  authorizeTool: async (actor, resource) => { if (!decideAccess(policy, { merchantId: actor.merchantId, actorRole: "owner", source: "merchant_assistant" }, "tool", resource, new Set()).allowed) throw new AssistantError("assistant_forbidden", 403); } });
before(async () => {
  f = await cashbackConfigurationFixture();
  await f.db.query("CREATE TABLE merchants(id TEXT PRIMARY KEY); INSERT INTO merchants(id) VALUES ('merchant-a'),('merchant-b')");
  await f.db.query(await readFile(new URL("../../../../prisma/migrations/20261116103000_merchant_assistant/migration.sql", import.meta.url), "utf8"));
});
beforeEach(async () => { await f.reset(); await f.db.query("TRUNCATE merchant_assistant_threads CASCADE"); now = new Date("2026-11-18T12:00:00Z"); policy = null; repo = new PrismaAssistantRepository(f.prisma, clock); });
after(async () => { await f?.close(); });
async function turn(message: string, actor = scope) {
  const thread = await repo.createThread(actor), id = randomUUID(), leaseToken = `lease-${id}`;
  await repo.atomic(actor, thread.id, async tx => { await tx.append({ id, requestKey: id, inputHash: "a".repeat(64), message, budgetAmountMicros: 100n });
    await tx.update(id, { status: "running", leaseToken, leaseUntil: "2026-11-18T12:01:00Z" }); });
  return { scope: actor, threadId: thread.id, turnId: id, leaseToken };
}
const unchanged = async () => {
  assert.equal((await f.db.query("SELECT count(*)::int AS n FROM cashback_ledger_entries")).rows[0].n, 0);
  assert.equal((await f.db.query("SELECT count(*)::int AS n FROM cashback_rule_versions")).rows[0].n, 0);
};

test("CBX-23 guided setup asks the next missing canonical decision and supplies a draft review artifact", async () => {
  const c = context(), input = await turn("Quero configurar cashback"), initial = await f.program();
  const result = await c.execute({ ...input, name: "cashback_next_step", args: {} });
  assert.deepEqual(result.artifacts, [{ type: "cashback_draft", program: initial, missingFields: ["earnRateBps", "minimumEarnCents", "maximumEarnPerOrderCents", "buyerMonthlyEarnLimitCents", "monthlyBudgetCents", "releaseTrigger", "releaseDelayDays", "expiryDays", "minimumRedeemOrderCents", "maximumRedeemBps", "maximumRedeemCents", "combination.allowCoupons", "combination.allowAdvancedRules", "combination.limitMode", "combination.maximumCombinedDiscountBps", "combination.maximumCombinedDiscountCents", "terms"] }]);
  assert.equal((result.data as any).nextStep.field, "earnRateBps"); assert.match((result.data as any).reply, /Qual percentual/);
  assert.deepEqual(await f.program(), initial); await unchanged();
});
test("CBX-24 a valid explicit user choice persists only the partial canonical draft without publication", async () => {
  const input = await turn("5,25%"), initial = await f.program();
  const result = await context().execute({ ...input, name: "cashback_save_draft_answer", args: { field: "earnRateBps", expectedRevision: initial.configurationRevision } });
  const saved = await f.program(); assert.deepEqual(saved.draft, { earnRateBps: 525 }); assert.equal(saved.status, "disabled"); assert.equal(saved.version, 0); assert.equal(saved.published, null);
  assert.deepEqual((result.artifacts[0] as any).program, saved); assert.equal((result.data as any).saved, true); assert.equal((result.data as any).nextStep.field, "minimumEarnCents"); await unchanged();
});
test("the actual stored message binds a value and rejects model value quote or merchant authority arguments", async () => {
  const input = await turn("5%"), before = await f.program();
  for (const extra of [{ value: 9000 }, { sourceQuote: "90%" }, { merchantId: "merchant-b" }, { actorId: "admin" }]) {
    await assert.rejects(context().execute({ ...input, name: "cashback_save_draft_answer", args: { field: "earnRateBps", expectedRevision: before.configurationRevision, ...extra } }), { code: "assistant_tool_arguments_invalid" });
    assert.deepEqual(await f.program(), before);
  }
  const wrong = await context().execute({ ...input, name: "cashback_save_draft_answer", args: { field: "maximumRedeemBps", expectedRevision: before.configurationRevision } });
  assert.equal((wrong.data as any).saved, false); assert.match((wrong.data as any).reply, /Informe/); assert.deepEqual(await f.program(), before);
});
test("invalid actual user answers produce a correction and no receipt or draft row", async () => {
  for (const message of ["5% ou 10%", "talvez 5%", "5", "1000%", "configure como achar melhor"]) {
    const input = await turn(message), before = await f.program();
    const result = await context().execute({ ...input, name: "cashback_save_draft_answer", args: { field: "earnRateBps", expectedRevision: before.configurationRevision } });
    assert.equal((result.data as any).saved, false); assert.deepEqual(await f.program(), before);
  }
  assert.equal((await f.db.query("SELECT count(*)::int AS n FROM cashback_event_receipts")).rows[0].n, 0); await unchanged();
});
test("guided draft operation replay returns the original receipt after a later manual edit", async () => {
  const input = await turn("5%"), initial = await f.program(), args = { field: "earnRateBps", expectedRevision: initial.configurationRevision };
  const first = await context().execute({ ...input, name: "cashback_save_draft_answer", args });
  const saved = await f.program(); const later = await f.service.saveDraft(scope.merchantId, { earnRateBps: 800 }, scope.actorId, { expectedRevision: saved.configurationRevision!, idempotencyKey: "manual-later" });
  const replay = await context().execute({ ...input, name: "cashback_save_draft_answer", args });
  assert.deepEqual(replay, first); assert.deepEqual(await f.program(), later); assert.equal((await f.db.query("SELECT count(*)::int AS n FROM cashback_event_receipts")).rows[0].n, 2);
});
test("stale chat configuration cannot overwrite a newer manual draft", async () => {
  const input = await turn("Ganho: 5%"), initial = await f.program();
  const newer = await f.service.saveDraft(scope.merchantId, { earnRateBps: 800 }, scope.actorId, { expectedRevision: initial.configurationRevision!, idempotencyKey: "manual-first" });
  const result = await context().execute({ ...input, name: "cashback_save_draft_answer", args: { field: "earnRateBps", expectedRevision: initial.configurationRevision } });
  assert.equal((result.data as any).error, "cashback_configuration_changed"); assert.match((result.data as any).reply, /mudou/); assert.deepEqual(await f.program(), newer);
});
test("CBX-26 a conversational activation request returns canonical review guidance and cannot publish", async () => {
  await f.service.saveDraft(scope.merchantId, configurationRules, scope.actorId); const before = await f.program(), input = await turn("Ative o cashback agora");
  const c = context(), result = await c.execute({ ...input, name: "cashback_next_step", args: {} });
  assert.match((result.data as any).reply, /Revisar rascunho/); assert.match((result.data as any).reply, /Publicar e ativar/);
  for (const name of ["cashback_publish", "cashback_pause", "cashback_end", "cashback_adjust_wallet"]) await assert.rejects(c.execute({ ...input, name, args: {} }), { code: "assistant_tool_unavailable" });
  assert.deepEqual(await f.program(), before); await unchanged();
});
test("published rules remain intact when a valid guided answer updates the draft", async () => {
  await f.service.saveDraft(scope.merchantId, configurationRules, scope.actorId); await f.service.publishProgram(scope.merchantId, scope.actorId);
  const input = await turn("Ganho: 6%"), before = await f.program();
  await context().execute({ ...input, name: "cashback_save_draft_answer", args: { field: "earnRateBps", expectedRevision: before.configurationRevision } });
  const saved = await f.program(); assert.equal(saved.status, "active"); assert.equal(saved.version, before.version); assert.deepEqual(saved.published, before.published); assert.deepEqual(saved.draft, { ...configurationRules, earnRateBps: 600 });
});
test("tool governance recognizes only registered cashback tools and respects an explicit tenant denial", async () => {
  const names = context().tools().map(t => t.name);
  assert.deepEqual(names, ["cashback_read_program", "cashback_next_step", "cashback_save_draft_answer"]);
  const grants = parseGrants(names.map(resource => ({ kind: "tool", resource, roles: ["owner"], sources: ["merchant_assistant"] })), new Set()); assert.equal(grants.length, 3);
  policy = { version: 1, grants: [] }; const input = await turn("5%"), before = await f.program();
  await assert.rejects(context().execute({ ...input, name: "cashback_save_draft_answer", args: { field: "earnRateBps", expectedRevision: before.configurationRevision } }), { code: "assistant_forbidden" }); assert.deepEqual(await f.program(), before);
});
test("context rejects an unauthorized actor and another tenant's thread without data writes", async () => {
  const input = await turn("5%"), before = await f.program();
  await assert.rejects(context().execute({ ...input, scope: { ...scope, actorId: "staff-a" }, name: "cashback_read_program", args: {} }), { code: "assistant_forbidden" });
  await assert.rejects(context().execute({ ...input, scope: { ...scope, merchantId: "merchant-b" }, name: "cashback_read_program", args: {} }), { code: "assistant_thread_not_found" });
  assert.deepEqual(await f.program(), before); assert.equal((await f.program("merchant-b")).draft, null);
});
test("an expired turn lease cannot save a financial choice", async () => {
  const input = await turn("5%"), before = await f.program(); now = new Date("2026-11-18T12:02:00Z");
  await assert.rejects(context().execute({ ...input, name: "cashback_save_draft_answer", args: { field: "earnRateBps", expectedRevision: before.configurationRevision } }), { code: "assistant_lease_lost" }); assert.deepEqual(await f.program(), before);
});
test("lease expiry while waiting for the cashback lock is fenced before the canonical write", async () => {
  const input = await turn("5%"), before = await f.program(); let enter!: () => void;
  const waiting = new Promise<void>(resolve => { enter = resolve; });
  class BlockedRepository extends CashbackRepository { override async transaction<T>(merchantId: string, body: Parameters<CashbackRepository["transaction"]>[1]): Promise<T> { enter(); return super.transaction(merchantId, body) as Promise<T>; } }
  const service = new CashbackService(new BlockedRepository(f.prisma));
  await f.db.query("BEGIN"); await f.db.query("SELECT pg_advisory_xact_lock(hashtextextended('cashback:merchant-a',0))");
  const pending = context(service).execute({ ...input, name: "cashback_save_draft_answer", args: { field: "earnRateBps", expectedRevision: before.configurationRevision } });
  try { await waiting; now = new Date("2026-11-18T12:02:00Z"); await f.db.query("COMMIT"); await assert.rejects(pending, { code: "assistant_lease_lost" }); }
  finally { await f.db.query("ROLLBACK"); }
  assert.deepEqual(await f.program(), before); assert.equal((await f.db.query("SELECT count(*)::int AS n FROM cashback_event_receipts")).rows[0].n, 0);
});
test("server guidance overrides a cited model claim of activation and keeps reviewed fallback visible", async () => {
  const input = await turn("Quero configurar cashback"), c = context(); let round = 0;
  const model = { complete: async (request: any) => ({ reply: round++ === 0 ? null : "Ativei o cashback e concedi saldo.", referenceIds: request.knowledge.length ? [request.knowledge[0].reference.id] : [], toolCalls: round === 1 ? [{ id: "read", name: "cashback_next_step", args: {} }] : [], costMicros: 0n, providerRequestId: "local-controlled" }) };
  const service = new AssistantService({ repo, context: c, knowledge: new AssistantKnowledgeRetriever(undefined, clock), clock, model });
  const result = await service.respond(input); assert.match(result.reply, /A busca contextual está indisponível/); assert.match(result.reply, /Qual percentual/); assert.doesNotMatch(result.reply, /Ativei|concedi/); assert.deepEqual(result.references, []); assert.equal((await f.program()).status, "disabled"); await unchanged();
});
test("a cited claim without a successful tool result cannot confirm a saved or active configuration", async () => {
  const input = await turn("5%"), c = context();
  const service = new AssistantService({ repo, context: c, knowledge: new AssistantKnowledgeRetriever(undefined, clock), clock,
    model: { complete: async request => ({ reply: "Salvei e deixei o cashback ativado.", referenceIds: request.knowledge.map(k => k.reference.id).slice(0, 1), toolCalls: [], costMicros: 0n, providerRequestId: "local" }) } });
  const result = await service.respond(input); assert.match(result.reply, /Não confirmei uma alteração/); assert.equal((await f.program()).draft, null); assert.equal((await f.program()).status, "disabled"); await unchanged();
});

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
import { CashbackAssistantReportService } from "./cashback-assistant-report.service.js";
import { cashbackConfigurationChecklist } from "../domain/cashback-configuration-checklist.js";
import { advance, fingerprint, grantCredit } from "../domain/cashback.js";
import {AssistantApiService,publicAssistantTurn} from '../../merchant-assistant/application/assistant-api.service.js';

let f: Awaited<ReturnType<typeof cashbackConfigurationFixture>>, repo: PrismaAssistantRepository, now: Date, policy: AiPolicy | null;
const scope = { merchantId: "merchant-a", actorId: "owner-a", context: "cashback" };
const clock = () => now;
const authorizeActor = async (actor: AssistantScope) => { if (actor.actorId !== "owner-a" || !["merchant-a", "merchant-b"].includes(actor.merchantId)) throw new AssistantError("assistant_forbidden", 403); };
const context = (service = f.service) => new CashbackAssistantContext({ service, reports: new CashbackAssistantReportService(f.queries, clock), conversations: repo, authorizeActor, clock,
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
  assert.deepEqual(result.artifacts, [{ type: "cashback_draft", program: initial, checklist: cashbackConfigurationChecklist({}), missingFields: ["earnRateBps", "minimumEarnCents", "maximumEarnPerOrderCents", "buyerMonthlyEarnLimitCents", "monthlyBudgetCents", "releaseTrigger", "releaseDelayDays", "expiryDays", "minimumRedeemOrderCents", "maximumRedeemBps", "maximumRedeemCents", "combination.allowCoupons", "combination.allowAdvancedRules", "combination.limitMode", "combination.maximumCombinedDiscountBps", "combination.maximumCombinedDiscountCents", "terms"] }]);
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
  assert.deepEqual(names, ["cashback_read_program", "cashback_next_step", "cashback_save_draft_answer", "cashback_report"]);
  const grants = parseGrants(names.map(resource => ({ kind: "tool", resource, roles: ["owner"], sources: ["merchant_assistant"] })), new Set()); assert.equal(grants.length, 4);
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
  const input = await turn("Como funciona o ganho de cashback?"), c = context();
  const service = new AssistantService({ repo, context: c, knowledge: new AssistantKnowledgeRetriever(undefined, clock), clock,
    model: { complete: async request => ({ reply: "Salvei e deixei o cashback ativado.", referenceIds: request.knowledge.map(k => k.reference.id).slice(0, 1), toolCalls: [], costMicros: 0n, providerRequestId: "local" }) } });
  const result = await service.respond(input); assert.match(result.reply, /Não confirmei uma alteração/); assert.equal((await f.program()).draft, null); assert.equal((await f.program()).status, "disabled"); await unchanged();
});
test("new read and save artifacts expose the complete current checklist including explicit false zero and null", async () => {
  await f.service.saveDraft(scope.merchantId, { minimumEarnCents: 0, expiryDays: null, combination: { allowCoupons: false } }, scope.actorId);
  const input = await turn("Mostre o checklist"), result = await context().execute({ ...input, name: "cashback_read_program", args: {} });
  assert.deepEqual((result.artifacts[0] as any).checklist, cashbackConfigurationChecklist((await f.program()).draft!));
  assert.equal((result.data as any).checklist.items.length, 17); assert.equal((result.data as any).checklist.completed, 3); assert.equal((result.data as any).nextStep.field, "earnRateBps");
  const saveInput = await turn("5%"), before = await f.program(), saved = await context().execute({ ...saveInput, name: "cashback_save_draft_answer", args: { field: "earnRateBps", expectedRevision: before.configurationRevision } });
  assert.equal((saved.artifacts[0] as any).checklist.completed, 4); assert.deepEqual((await f.program()).draft, { earnRateBps: 500, minimumEarnCents: 0, expiryDays: null, combination: { allowCoupons: false } });
});
async function financialSnapshot() {
  const tables = ["cashback_programs", "cashback_ledger_entries", "cashback_grants", "cashback_reservations"];
  const values: unknown[] = [];
  for (const table of tables) values.push((await f.db.query(`SELECT row_to_json(t) AS row FROM ${table} t ORDER BY row_to_json(t)::text`)).rows);
  // Normal reconcile writes version/updated_at even when values are unchanged.
  values.push((await f.db.query("SELECT merchant_id,buyer_id,balance FROM cashback_wallets ORDER BY merchant_id,buyer_id")).rows);
  return fingerprint(values);
}
test("CBX-42 a governed report uses canonical metrics and leaves configuration and financial values unchanged", async () => {
  await f.service.saveDraft(scope.merchantId, configurationRules, scope.actorId); await f.service.publishProgram(scope.merchantId, scope.actorId);
  await f.repository.transaction(scope.merchantId, async tx => { const wallet = await f.repository.wallet(tx, scope.merchantId, "buyer-report"), when = new Date("2026-11-01T12:00:00Z"); grantCredit(wallet, { orderId: "report-credit", amountCents: 321, eligibleBaseCents: 6420, rules: configurationRules, ruleVersion: 1, lines: [], availableAt: when.toISOString() }, when); advance(wallet, when); await f.repository.saveWallet(tx, wallet); });
  await f.service.reconcile(scope.merchantId); const before = await financialSnapshot(), input = await turn("Relatório de cashback");
  const result = await context().execute({ ...input, name: "cashback_report", args: { from: "2026-11-01", to: "2026-11-02" } });
  assert.equal(result.artifacts.length, 1); const artifact = result.artifacts[0] as any; assert.equal(artifact.type, "cashback_report"); assert.equal(artifact.report.merchantId, scope.merchantId); assert.equal(artifact.report.metrics.grantedCents, 321); assert.equal(artifact.report.metrics.availableCents, 321);
  assert.match((result.data as any).reply, /Dados financeiros consultados/); assert.match((result.data as any).reply, /Receita associada/); assert.match((result.data as any).reply, /não comprova/); assert.match((result.data as any).reply, /Saldos atuais/); assert.match((result.data as any).reply, /Orçamento/);
  assert.equal(await financialSnapshot(), before);
  policy = { version: 1, grants: [] }; await assert.rejects(context().execute({ ...input, name: "cashback_report", args: {} }), { code: "assistant_forbidden" }); assert.equal(await financialSnapshot(), before);
});
test("CBX-41 invalid or unavailable reports produce a correction without metrics or a fabricated report artifact", async () => {
  const input = await turn("Relatório de cashback"), c = context();
  const invalid = await c.execute({ ...input, name: "cashback_report", args: { from: "2026-02-30", to: "2026-03-01" } });
  assert.deepEqual(invalid.artifacts, []); assert.equal((invalid.data as any).error, "cashback_report_period_invalid"); assert.equal(Object.hasOwn(invalid.data as object, "report"), false); assert.match((invalid.data as any).reply, /datas/);
  await f.db.query("ALTER TABLE cashback_ledger_entries RENAME TO cbx_report_unavailable");
  try { const failed = await c.execute({ ...input, name: "cashback_report", args: {} }); assert.deepEqual(failed.artifacts, []); assert.equal((failed.data as any).error, "cashback_report_unavailable"); assert.doesNotMatch((failed.data as any).reply, /0,00|ROI|lucro/); }
  finally { await f.db.query("ALTER TABLE cbx_report_unavailable RENAME TO cashback_ledger_entries"); }
});
test("CBX-18 questions depending on the store return the pertinent published facts instead of a setup question", async () => {
  await f.service.saveDraft(scope.merchantId, configurationRules, scope.actorId); await f.service.publishProgram(scope.merchantId, scope.actorId);
  await f.service.saveDraft(scope.merchantId, { ...configurationRules, earnRateBps: 900, combination: { ...configurationRules.combination!, allowCoupons: false } }, scope.actorId);
  for (const [message, match] of [["Meu programa permite cupons?", /Cupons: permitido/], ["Qual minha taxa de ganho?", /Ganho: 5%/]] as const) {
    const input = await turn(message); let round = 0;
    const service = new AssistantService({ repo, context: context(), knowledge: new AssistantKnowledgeRetriever(undefined, clock), clock,
      model: { complete: async request => ({ reply: round++ === 0 ? null : "A sua taxa é 99% e não permite cupons.", referenceIds: request.knowledge.map(k => k.reference.id).slice(0, 1), toolCalls: round === 1 ? [{ id: "read", name: "cashback_read_program", args: {} }] : [], costMicros: 0n, providerRequestId: "local" }) } });
    const result = await service.respond(input); assert.match(result.reply, match); assert.match(result.reply, /Regras publicadas/); assert.doesNotMatch(result.reply, /Qual percentual|99%/);
  }
});
test("a model cannot invent report values when it did not consult a successful canonical report", async () => {
  const input = await turn("Quero um relatório de cashback"), before = await financialSnapshot();
  const service = new AssistantService({ repo, context: context(), knowledge: new AssistantKnowledgeRetriever(undefined, clock), clock,
    model: { complete: async request => ({ reply: "Lucro de R$ 9.999 com ROI de 90%.", referenceIds: request.knowledge.map(k => k.reference.id).slice(0, 1), toolCalls: [], costMicros: 0n, providerRequestId: "local" }) } });
  const result = await service.respond(input); assert.match(result.reply, /Não consegui consultar/); assert.doesNotMatch(result.reply, /9.999|90%/); assert.deepEqual(result.artifacts, []); assert.equal(await financialSnapshot(), before);
});
test("a failed report remains unavailable even when the model follows it with invented cited numbers", async () => {
  const input = await turn("Relatório de cashback"), c = context(); let round = 0;
  const service = new AssistantService({ repo, context: c, knowledge: new AssistantKnowledgeRetriever(undefined, clock), clock,
    model: { complete: async request => ({ reply: round++ === 0 ? null : "Foram R$ 50.000 de cashback e ROI de 400%.", referenceIds: request.knowledge.map(k => k.reference.id).slice(0, 1), toolCalls: round === 1 ? [{ id: "report", name: "cashback_report", args: { from: "2026-02-30", to: "2026-03-01" } }] : [], costMicros: 0n, providerRequestId: "local" }) } });
  const result = await service.respond(input); assert.match(result.reply, /datas/); assert.doesNotMatch(result.reply, /50.000|400%/); assert.deepEqual(result.artifacts, []);
});

const intentReceipts=async()=>Number((await f.db.query('SELECT count(*)::int n FROM cashback_event_receipts')).rows[0].n);
async function onlyRead(input:Awaited<ReturnType<typeof turn>>,c=context(),observed:any[]=[]){
 return new AssistantService({repo,context:c,knowledge:new AssistantKnowledgeRetriever(undefined,clock),clock,model:{complete:async request=>{observed.push(structuredClone(request));return {reply:request.step===0?null:'Consultei os fatos atuais.',referenceIds:[],toolCalls:request.step===0?[{id:'only-read',name:'cashback_read_program',args:{}}]:[],costMicros:0n,providerRequestId:'read-only-model'};}}}).respond(input);
}
test('CBX-52 a repeated named amendment uses the current draft rather than an identical old saved message',async()=>{
 const thread=await repo.createThread(scope);await repo.atomic(scope,thread.id,async tx=>{await tx.append({id:'old-choice',requestKey:'old-choice',inputHash:'b'.repeat(64),message:'Ganho: 6%',budgetAmountMicros:100n});await tx.update('old-choice',{status:'completed',reply:'Escolha salva no rascunho. Ganho: 6%.'});});
 await f.service.saveDraft(scope.merchantId,{earnRateBps:500,minimumEarnCents:0,maximumEarnPerOrderCents:null,combination:{allowCoupons:false}},scope.actorId);
 const input=await turn('Ganho: 6%'),observed:any[]=[];const response=await onlyRead(input,context(),observed);const saved=await f.program();assert.equal(saved.draft!.earnRateBps,600);assert.equal(saved.draft!.minimumEarnCents,0);assert.equal(saved.status,'disabled');assert.equal(saved.version,0);assert.equal(saved.published,null);assert.equal(await intentReceipts(),1);assert.match(response.reply,/Escolha salva no rascunho/);assert.match(response.reply,/limite mensal de ganho por cliente/);assert.equal(observed.length,2);assert.equal(observed[0].state.acceptedInput.field,'earnRateBps');assert.equal(observed[0].state.acceptedInput.saved,true);await unchanged();
});
test('CBX-52 a current-step money answer is saved even when the model only reads',async()=>{
 await f.service.saveDraft(scope.merchantId,{earnRateBps:500},scope.actorId);const response=await onlyRead(await turn('R$ 0'));assert.deepEqual((await f.program()).draft,{earnRateBps:500,minimumEarnCents:0});assert.equal(await intentReceipts(),1);assert.match(response.reply,/Escolha salva/);assert.match(response.reply,/limite de ganho por pedido/);await unchanged();
});
test('CBX-52 read save read cannot apply the same money answer to the next field or erase its confirmation',async()=>{
 await f.service.saveDraft(scope.merchantId,{earnRateBps:500},scope.actorId);const input=await turn('R$ 0');const response=await new AssistantService({repo,context:context(),knowledge:new AssistantKnowledgeRetriever(undefined,clock),clock,model:{complete:async request=>{const step=request.step??0;const revision=(await f.program()).configurationRevision;return {reply:step===3?'Fatos consultados.':null,referenceIds:[],toolCalls:step===0||step===2?[{id:`read-${step}`,name:'cashback_read_program',args:{}}]:step===1?[{id:'model-save',name:'cashback_save_draft_answer',args:{field:'maximumEarnPerOrderCents',expectedRevision:revision}}]:[],costMicros:0n,providerRequestId:'read-save-read'};}}}).respond(input);
 assert.deepEqual((await f.program()).draft,{earnRateBps:500,minimumEarnCents:0});assert.equal(await intentReceipts(),1);assert.match(response.reply,/Escolha salva/);assert.match(response.reply,/limite de ganho por pedido/);await unchanged();
});
test('CBX-52 committed save survives a crash and a new lease without advancing the money field or exposing private intent',async()=>{
 await f.service.saveDraft(scope.merchantId,{earnRateBps:500,terms:'PRIVATE-INTENT-PREIMAGE'},scope.actorId);const input=await turn('R$ 0'),initial=await f.program();const crashing=Object.create(f.service) as CashbackService;crashing.saveGuidedDraftAnswer=async(...args:Parameters<CashbackService['saveGuidedDraftAnswer']>)=>{await f.service.saveGuidedDraftAnswer(...args);throw Error('crash-after-commit');};
 await assert.rejects(onlyRead(input,context(crashing)),/crash-after-commit/);assert.equal((await f.program()).draft!.minimumEarnCents,0);assert.equal(await intentReceipts(),1);
 let stored=(await repo.turns(scope,input.threadId)).turns[0]!;const intent=(stored.artifacts as any[]).find(a=>a.type==='cashback_draft_intent');assert.ok(intent);assert.equal(intent.turnId,input.turnId);assert.equal(intent.inputHash,stored.inputHash);assert.equal(intent.field,'minimumEarnCents');assert.equal(intent.expectedRevision,initial.configurationRevision);assert.deepEqual(intent.preimage,initial.draft);assert.equal(JSON.stringify(publicAssistantTurn(stored)).includes('cashback_draft_intent'),false);
 const c=context(),api=new AssistantApiService({repo,context:async()=>c,knowledge:new AssistantKnowledgeRetriever(undefined,clock),enabled:()=>true,dashboardUrl:'',wake:()=>{},admission:{submit:async()=>({turn:stored,revision:0,replayed:true})} as any});for(const publicResult of [await api.thread(scope),await api.page(scope,input.threadId,{}),await api.submit(scope,input.threadId,{message:'R$ 0',expectedRevision:0,idempotencyKey:'public-replay'})])assert.equal(JSON.stringify(publicResult).includes('cashback_draft_intent'),false);
 const renewed={...input,leaseToken:'recovered-lease'};await repo.atomic(scope,input.threadId,async tx=>{await tx.update(input.turnId,{leaseToken:renewed.leaseToken,leaseUntil:'2026-11-18T12:02:00Z'});});const observed:any[]=[];const response=await onlyRead(renewed,context(),observed);stored=(await repo.turns(scope,input.threadId)).turns[0]!;assert.equal(await intentReceipts(),1);assert.equal((await f.program()).draft!.maximumEarnPerOrderCents,undefined);assert.equal((stored.artifacts as any[]).find(a=>a.type==='cashback_draft_intent').expectedRevision,initial.configurationRevision);assert.match(response.reply,/Escolha salva/);assert.equal(JSON.stringify(observed).includes('PRIVATE-INTENT-PREIMAGE'),false);assert.equal(JSON.stringify(observed).includes('cashback_draft_intent'),false);await unchanged();
});
test('CBX-52 a captured revision cannot overwrite a concurrent manual amendment',async()=>{
 await f.service.saveDraft(scope.merchantId,{earnRateBps:500},scope.actorId);const input=await turn('Ganho: 6%'),racing=Object.create(f.service) as CashbackService;let injected=false;racing.saveGuidedDraftAnswer=async(...args:Parameters<CashbackService['saveGuidedDraftAnswer']>)=>{if(!injected){injected=true;const stored=(await repo.turns(scope,input.threadId)).turns[0]!;assert.ok((stored.artifacts as any[]).some(a=>a.type==='cashback_draft_intent'));await f.service.saveDraft(scope.merchantId,{earnRateBps:700},scope.actorId);}return f.service.saveGuidedDraftAnswer(...args);};
 const response=await onlyRead(input,context(racing));assert.equal((await f.program()).draft!.earnRateBps,700);assert.equal(await intentReceipts(),0);assert.match(response.reply,/configuração mudou/);assert.doesNotMatch(response.reply,/Escolha salva/);await unchanged();
});
test('CBX-52 a newer read after the confirmed save is a conflict rather than an overwritten choice',async()=>{
 await f.service.saveDraft(scope.merchantId,{earnRateBps:500},scope.actorId);const input=await turn('Ganho: 6%');let round=0;const response=await new AssistantService({repo,context:context(),knowledge:new AssistantKnowledgeRetriever(undefined,clock),clock,model:{complete:async()=>{if(round++===0){await f.service.saveDraft(scope.merchantId,{earnRateBps:700},scope.actorId);return {reply:null,referenceIds:[],toolCalls:[{id:'read-newer',name:'cashback_read_program',args:{}}],costMicros:0n,providerRequestId:'newer-read'};}if(round===2)return {reply:null,referenceIds:[],toolCalls:[{id:'replay-old-save',name:'cashback_save_draft_answer',args:{field:'earnRateBps',expectedRevision:(await f.program()).configurationRevision}}],costMicros:0n,providerRequestId:'replay-after-newer-read'};return {reply:'Salvo.',referenceIds:[],toolCalls:[],costMicros:0n,providerRequestId:'newer-read-final'};}}}).respond(input);
 assert.equal((await f.program()).draft!.earnRateBps,700);assert.equal(await intentReceipts(),1);assert.match(response.reply,/configuração mudou/);assert.doesNotMatch(response.reply,/Escolha salva/);const artifact=response.artifacts.find(item=>item.type==='cashback_draft');assert.ok(artifact?.type==='cashback_draft');assert.equal(artifact.program.draft!.earnRateBps,700);assert.equal(artifact.program.configurationRevision,(await f.program()).configurationRevision);await unchanged();
});
test('CBX-52 questions reports and ambiguous or invalid units do not create an intent or save',async()=>{
 for(const message of ['Como combinar cupons?','Regulamento: preciso escrever todas as condições?','Relatório de cashback de 2026-11-01 até 2026-11-02','Ganho: 5% ou 10%','5','Ganho: 1000%']){await onlyRead(await turn(message));}assert.equal((await f.program()).draft,null);assert.equal(await intentReceipts(),0);const intents=await f.db.query("SELECT count(*)::int n FROM merchant_assistant_turns t CROSS JOIN LATERAL jsonb_array_elements(t.artifacts) a WHERE a->>'type'='cashback_draft_intent'");assert.equal(intents.rows[0].n,0);await unchanged();
 const {terms:_terms,...partial}=configurationRules;await f.service.saveDraft(scope.merchantId,partial,scope.actorId);const response=await onlyRead(await turn('Regulamento: Crédito promocional para novas compras nesta loja. Consulte todas as condições da loja.'));assert.equal((await f.program()).draft!.terms,'Crédito promocional para novas compras nesta loja. Consulte todas as condições da loja.');assert.match(response.reply,/17 de 17/);assert.equal((await f.program()).published,null);assert.equal(await intentReceipts(),1);await unchanged();
});
test('CBX-52 denied write tools cannot capture a financial mutation through preparation',async()=>{
 policy={version:1,grants:[]};await assert.rejects(onlyRead(await turn('5%')),{code:'assistant_forbidden'});assert.equal((await f.program()).draft,null);assert.equal(await intentReceipts(),0);await unchanged();
});
test('CBX-52 expired leases and foreign actors or threads cannot prepare a draft choice',async()=>{
 const input=await turn('5%');await assert.rejects(onlyRead({...input,scope:{...scope,actorId:'staff-a'}}),{code:'assistant_forbidden'});await assert.rejects(onlyRead({...input,scope:{...scope,merchantId:'merchant-b'}}),{code:'assistant_thread_not_found'});now=new Date('2026-11-18T12:02:00Z');await assert.rejects(onlyRead(input),{code:'assistant_lease_lost'});assert.equal((await f.program()).draft,null);assert.equal((await f.program('merchant-b')).draft,null);assert.equal(await intentReceipts(),0);await unchanged();
});
test('CBX-52 legacy dispatched turns without a private preimage cannot infer a new financial intent',async()=>{
 const input=await turn('5%');await repo.atomic(scope,input.threadId,async tx=>{await tx.update(input.turnId,{providerRequests:[{key:'old-dispatch',kind:'model',status:'completed'}]});});await onlyRead(input);assert.equal((await f.program()).draft,null);assert.equal(await intentReceipts(),0);const stored=(await repo.turns(scope,input.threadId)).turns[0]!;assert.equal((stored.artifacts as any[]).some(a=>a.type==='cashback_draft_intent'),false);await unchanged();
});

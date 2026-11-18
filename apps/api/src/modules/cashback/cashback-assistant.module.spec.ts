import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { AddressInfo } from "node:net";
import { CashbackAssistantModule } from "./cashback-assistant.module.js";
import { CashbackAssistantContext } from "./application/cashback-assistant.context.js";
import { cashbackAssistantFixture } from "./application/__tests__/cashback-assistant.fixture.js";
import { CashbackService } from "./application/cashback.service.js";
import { CashbackQueriesService } from "./application/cashback-queries.service.js";
import { MERCHANT_ASSISTANT_RUNTIME } from "../merchant-assistant/merchant-assistant.module.js";
import { AssistantApiService } from "../merchant-assistant/application/assistant-api.service.js";
import { MerchantAssistantController, AssistantHttpErrorFilter } from "../merchant-assistant/presentation/merchant-assistant.controller.js";
import { JwtService } from "../auth/domain/services/jwt.service.js";
import { AuthGuard } from "../auth/presentation/auth.guard.js";
import { AuthCookieService } from "../auth/domain/services/auth-cookie.service.js";
import { createMerchantAssistantRuntime } from "../merchant-assistant/infrastructure/runtime.js";
import { TenantContextService } from "../../shared/tenant/tenant-context.service.js";

const providers = () => Reflect.getMetadata("providers", CashbackAssistantModule);
async function httpFixture() {
  const f = await cashbackAssistantFixture();
  const jwt = { authenticate: async (token: string) => {
    if (!["owner-a", "admin-a", "staff-a", "owner-b"].includes(token)) throw Error("jwt_invalid_signature");
    return { merchantId: token === "owner-b" ? "merchant-b" : "merchant-a", userId: token, email: "qa@example.test", role: token === "staff-a" ? "staff" : token === "admin-a" ? "admin" : "owner" };
  } } as unknown as JwtService;
  Reflect.defineMetadata("design:paramtypes", [JwtService, AuthCookieService], AuthGuard);
  @Module({ controllers: [MerchantAssistantController], providers: [...providers(),
    { provide: CashbackService, useValue: f.service }, { provide: MERCHANT_ASSISTANT_RUNTIME, useValue: f.runtime }, { provide: AssistantApiService, useValue: f.runtime.api },
    { provide: CashbackQueriesService, useValue: f.queries },
    { provide: JwtService, useValue: jwt }, { provide: AuthCookieService, useValue: new AuthCookieService("aacp_access_token", false) }, AuthGuard, AssistantHttpErrorFilter] }) class HttpHarness {}
  const app = await NestFactory.create(HttpHarness, { logger: false }); await app.listen(0, "127.0.0.1");
  const base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/merchant-assistant/contexts/cashback`;
  return { ...f, app, async request(path = "/thread", token: string | null = "owner-a", body?: unknown) {
    return fetch(base + path, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  }, async close() { await app.close(); await f.close(); } };
}

test("cashback registration uses the shared lazy runtime without model SQL or financial side effects", async () => {
  const forbidden = new Proxy({}, { get: (_target, field) => { throw Error(`construction side effect: ${String(field)}`); } });
  const runtime = createMerchantAssistantRuntime({ prisma: forbidden as any, memberships: forbidden as any, governance: forbidden as any, tenant: new TenantContextService(), env: {} });
  const service = { getProgram() { throw Error("unexpected read"); }, saveGuidedDraftAnswer() { throw Error("unexpected write"); } };
  @Module({ providers: [...providers(), { provide: CashbackService, useValue: service }, { provide: CashbackQueriesService, useValue: { metrics() { throw Error("unexpected report"); } } }, { provide: MERCHANT_ASSISTANT_RUNTIME, useValue: runtime }] }) class LazyHarness {}
  const app = await NestFactory.create(LazyHarness, { logger: false });
  try { assert.equal(app.get(CashbackAssistantContext).descriptor.id, "cashback"); assert.equal(runtime.contexts.has("cashback"), true); assert.deepEqual(runtime.contexts.ids(), ["cashback"]); }
  finally { await app.close(); }
});
test("CBX-22 actual HTTP owner and admin can open disabled cashback while staff anonymous and foreign thread are forbidden", async () => {
  const f = await httpFixture();
  try {
    assert.equal((await f.request("/thread", null)).status, 401); assert.equal((await f.request("/thread", "staff-a")).status, 403);
    const owner = await f.request(), admin = await f.request("/thread", "admin-a"); assert.equal(owner.status, 200); assert.equal(admin.status, 200);
    const value = await owner.json(); assert.equal(value.context.id, "cashback"); assert.equal(value.context.label, "Cashback");
    assert.equal((await f.request(`/threads/${value.id}/turns`, "owner-b")).status, 404); assert.equal((await f.program()).status, "disabled"); assert.equal(f.requests.length, 0);
    await f.db.query("UPDATE merchant_team_members SET role='STAFF' WHERE user_id='owner-a'"); assert.equal((await f.request()).status, 403);
  } finally { await f.close(); }
});
test("real HTTP admission runs the Cashback gateway prompt scoped graph retrieval and canonical draft artifact", async () => {
  const f = await httpFixture();
  try {
    const thread = await (await f.request()).json();
    const accepted = await f.request(`/threads/${thread.id}/turns`, "owner-a", { message: "Quero configurar cashback", idempotencyKey: "local-http", expectedRevision: thread.revision }); assert.equal(accepted.status, 202);
    await f.runtime.worker.drain();
    let current = await f.runtime.api.page({ merchantId: "merchant-a", actorId: "owner-a", context: "cashback" }, thread.id);
    for (let i = 0; i < 80 && current.turns[0]?.status !== "completed"; i++) { await new Promise(resolve => setTimeout(resolve, 25)); current = await f.runtime.api.page({ merchantId: "merchant-a", actorId: "owner-a", context: "cashback" }, thread.id); }
    assert.equal(current.turns[0]?.status, "completed"); assert.match(current.turns[0]!.reply!, /Qual percentual/); assert.equal(current.turns[0]!.artifacts[0]?.type, "cashback_draft");
    const prompt = f.requests[0]?.messages[0].content; assert.match(prompt, /cashback/i); assert.match(prompt, /rascunho/); assert.match(prompt, /Publicar e ativar/); assert.doesNotMatch(prompt, /merchant_ads|campanha|anúncios/);
    assert.deepEqual(f.graphRequests[0], { merchantId: "merchant-a", context: "cashback", query: "Quero configurar cashback", limit: 5 }); assert.equal((await f.program()).draft, null);
    assert.ok((await f.prisma.aiGovernanceDecision.findMany()).some(d => d.resource === "cashback_next_step" && d.allowed && d.actorRole === "owner"));
  } finally { await f.close(); }
});
test("an explicit tenant AI policy denies cashback tools without changing financial configuration", async () => {
  const f = await httpFixture();
  try {
    await f.db.query("INSERT INTO ai_governance_policies(merchant_id,grants,version,updated_by,updated_at) VALUES('merchant-a','[]',1,'owner-a',now())");
    const scope = { merchantId: "merchant-a", actorId: "owner-a", context: "cashback" }, thread = await f.runtime.repo.createThread(scope), id = "policy-turn";
    await f.runtime.repo.atomic(scope, thread.id, async tx => { await tx.append({ id, message: "5%", requestKey: id, inputHash: "b".repeat(64), budgetAmountMicros: 1n }); await tx.update(id, { status: "running", leaseToken: "policy-lease", leaseUntil: new Date(Date.now() + 60000).toISOString() }); });
    const before = await f.program(); await assert.rejects(f.app.get(CashbackAssistantContext).execute({ scope, threadId: thread.id, turnId: id, leaseToken: "policy-lease", name: "cashback_next_step", args: {} }));
    assert.deepEqual(await f.program(), before); assert.ok((await f.prisma.aiGovernanceDecision.findMany()).some(d => !d.allowed && d.resource === "cashback_next_step" && d.reason === "policy_denied")); assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});
test("disabled assistant leaves canonical manual program configuration available", async () => {
  const f = await httpFixture();
  try { f.env.MERCHANT_ASSISTANT_ENABLED = "false"; assert.equal((await f.request()).status, 503); assert.match((await f.program()).configurationRevision!, /^[a-f0-9]{64}$/); assert.equal(f.requests.length, 0); }
  finally { await f.close(); }
});
test("the effective gateway tool message preserves all17 decisions and full long terms without duplicate draft truncation", async () => {
  const f = await httpFixture();
  try {
    const terms = "条款".repeat(5000);
    const { configurationRules } = await import("./infrastructure/__tests__/cashback-configuration.fixture.js");
    await f.service.saveDraft("merchant-a", { ...configurationRules, terms }, "owner-a"); await f.service.publishProgram("merchant-a", "owner-a");
    const draftTerms = "规则".repeat(5000); await f.service.saveDraft("merchant-a", { ...configurationRules, terms: draftTerms, earnRateBps: 750 }, "owner-a");
    f.modelReply(body => body.messages.some((m: any) => m.role === "tool") ? { content: JSON.stringify({ reply: "Confira seu checklist.", referenceIds: [] }) }
      : { tool_calls: [{ id: "read", type: "function", function: { name: "cashback_read_program", arguments: "{}" } }] });
    const thread = await (await f.request()).json(); await f.request(`/threads/${thread.id}/turns`, "owner-a", { message: "Mostre o checklist de cashback", idempotencyKey: "full-checklist", expectedRevision: thread.revision }); await f.runtime.worker.drain();
    const scope = { merchantId: "merchant-a", actorId: "owner-a", context: "cashback" }; let page = await f.runtime.api.page(scope, thread.id);
    for (let i = 0; i < 120 && page.turns[0]?.status !== "completed"; i++) { await new Promise(resolve => setTimeout(resolve, 25)); page = await f.runtime.api.page(scope, thread.id); }
    assert.equal(page.turns[0]?.status, "completed");
    const message = f.requests.flatMap(r => r.messages).find(m => m.role === "tool"), payload = JSON.parse(message.content);
    assert.equal(payload.truncated, undefined); assert.equal(payload.checklist.items.length, 17); assert.equal(payload.checklist.completed, 17); assert.equal(payload.checklist.nextField, null);
    assert.equal(payload.checklist.items.find((i: any) => i.field === "terms").value, draftTerms); assert.equal(payload.checklist.items.find((i: any) => i.field === "earnRateBps").value, 750); assert.equal(payload.published.terms.textIncluded, false); assert.equal(payload.published.terms.characters, terms.length); assert.equal(payload.published.terms.fullTextLocation, "canonical_program_artifact"); assert.equal(payload.published.earnRateBps, 500);
    assert.ok(Buffer.byteLength(message.content, "utf8") > 32000); assert.ok(Buffer.byteLength(JSON.stringify(f.requests.at(-1)), "utf8") < 64000);
    assert.equal((page.turns[0]!.artifacts[0] as any).program.published.terms, terms);
    assert.equal((page.turns[0]!.artifacts[0] as any).checklist.items.find((i: any) => i.field === "terms").value, draftTerms); assert.match(page.turns[0]!.reply!, /17 de 17/);
    const previousCalls = f.requests.length;
    await f.request(`/threads/${thread.id}/turns`, "owner-a", { message: "Qual o regulamento publicado?", idempotencyKey: "published-terms", expectedRevision: page.revision }); await f.runtime.worker.drain();
    page = await f.runtime.api.page(scope, thread.id);
    for (let i = 0; i < 100 && page.turns.at(-1)?.status !== "completed"; i++) { await new Promise(resolve => setTimeout(resolve, 25)); page = await f.runtime.api.page(scope, thread.id); }
    assert.equal(page.turns.at(-1)?.status, "completed"); const faq = JSON.parse(f.requests.slice(previousCalls).flatMap(r => r.messages).find(m => m.role === "tool").content);
    assert.equal(faq.published.terms, terms); const draftRegulation = faq.checklist.items.find((i: any) => i.field === "terms"); assert.equal(draftRegulation.completed, true); assert.equal(draftRegulation.value, undefined); assert.equal(draftRegulation.text.textIncluded, false); assert.equal(draftRegulation.text.characters, draftTerms.length);
    assert.ok(page.turns.at(-1)!.reply!.includes(terms)); assert.equal((page.turns.at(-1)!.artifacts[0] as any).program.draft.terms, draftTerms);
  } finally { await f.close(); }
});
test("actual HTTP report returns scoped canonical numbers for admin and audits an explicit tool denial", async () => {
  const f = await httpFixture();
  try {
    f.modelReply(body => body.messages.some((m: any) => m.role === "tool") ? { content: JSON.stringify({ reply: "Lucro inventado de R$ 99.999 e ROI de 500%.", referenceIds: [] }) }
      : { tool_calls: [{ id: "report", type: "function", function: { name: "cashback_report", arguments: JSON.stringify({ from: "2026-11-01", to: "2026-11-02" }) } }] });
    const thread = await (await f.request("/thread", "admin-a")).json(); const accepted = await f.request(`/threads/${thread.id}/turns`, "admin-a", { message: "Relatório de cashback", idempotencyKey: "admin-report", expectedRevision: thread.revision }); assert.equal(accepted.status, 202); await f.runtime.worker.drain();
    const scope = { merchantId: "merchant-a", actorId: "admin-a", context: "cashback" }; let page = await f.runtime.api.page(scope, thread.id);
    for (let i = 0; i < 100 && page.turns[0]?.status !== "completed"; i++) { await new Promise(resolve => setTimeout(resolve, 25)); page = await f.runtime.api.page(scope, thread.id); }
    assert.equal(page.turns[0]?.status, "completed"); const artifact = page.turns[0]!.artifacts[0] as any;
    assert.equal(artifact.type, "cashback_report"); assert.equal(artifact.report.merchantId, "merchant-a"); assert.equal(artifact.report.metrics.from, "2026-11-01T03:00:00.000Z"); assert.equal(artifact.report.metrics.grantedCents, 0); assert.match(page.turns[0]!.reply!, /Dados financeiros consultados/); assert.doesNotMatch(page.turns[0]!.reply!, /99.999|500%/);
    assert.ok((await f.prisma.aiGovernanceDecision.findMany()).some(d => d.resource === "cashback_report" && d.allowed && d.actorRole === "admin"));
    const modelPayload = JSON.parse(f.requests.flatMap(r => r.messages).find(m => m.role === "tool").content); assert.equal(modelPayload.report.metrics.dailyMovements, undefined); assert.equal(artifact.report.metrics.dailyMovements.length, 2);
    await f.db.query("INSERT INTO ai_governance_policies(merchant_id,grants,version,updated_by,updated_at) VALUES('merchant-a','[]',1,'owner-a',now())");
    const id = "denied-report"; await f.runtime.repo.atomic(scope, thread.id, async tx => { await tx.append({ id, requestKey: id, inputHash: "b".repeat(64), message: "Relatório", budgetAmountMicros: 1n }); await tx.update(id, { status: "running", leaseToken: "report-denied-lease", leaseUntil: new Date(Date.now() + 60000).toISOString() }); });
    await assert.rejects(f.app.get(CashbackAssistantContext).execute({ scope, threadId: thread.id, turnId: id, leaseToken: "report-denied-lease", name: "cashback_report", args: {} }));
    assert.ok((await f.prisma.aiGovernanceDecision.findMany()).some(d => d.resource === "cashback_report" && !d.allowed && d.actorRole === "admin")); assert.equal((await f.program()).draft, null);
  } finally { await f.close(); }
});

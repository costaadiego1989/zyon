import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { SendSupportMessageUseCase } from "./send-support-message.use-case.js";
import { InMemorySupportTicketRepository } from "../infrastructure/in-memory-support-ticket.repository.js";
import { SupportHandoffService } from "./support-handoff.service.js";
import { SupportTicketEventPublisher } from "./support-ticket-event.publisher.js";
import { PublicBusinessAnswerSession, type LiveBusinessSnapshot, type SessionDependencies } from "../../knowledge-base/application/services/public-business-answer-session.js";

const merchantId = "synthetic-t71-support", request = { productId: "service", professionalId: "professional",
  fromDate: "2030-01-02", toDate: "2030-01-02" };
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
async function fixture() {
  let content = "PUBLISHED_PREPARATION", price = 7300, serviceMode = true;
  const handles = new WeakMap<object, string>();
  const sources = () => (["company", "service", "professional"] as const).map(type => ({ id: type, content: type + ":" + content,
    provenance: { origin: "canonical_sql", namespace: "canonical-public", merchantId, sourceType: type,
      sourceId: type === "company" ? merchantId : type, sourceVersion: "opaque", sourceHash: hash(type + ":" + content),
      publicationState: "published", publicWorkVersion: null, embeddingModel: null, embeddingDimensions: null,
      chunkId: type, contentHash: hash(type + ":" + content) } }));
  const pairs = [{ serviceEvidenceId: "service", professionalEvidenceId: "professional" }];
  const opened = await PublicBusinessAnswerSession.open({ merchantId, purpose: "knowledge" }, {
    scope: { assertScope(id) { assert.equal(id, merchantId); } }, billing: { async assertAllowed() {} },
    canonical: { async read() { const selection = Object.freeze({}); handles.set(selection, content);
      return { status: "ready", evidence: sources(), pairs, selection, partial: false }; },
    async recheck(_merchant, handle) { return handles.get(handle) === content
      ? { status: "current", evidence: sources(), pairs } : { status: "changed", evidence: [], pairs: [] }; } },
    publicSources: {},
  } as unknown as SessionDependencies);
  if (opened.status !== "ready") assert.fail("fixture_session_required");
  const session = opened.session, tickets = new InMemorySupportTicketRepository();
  const plans: unknown[] = [], prompts: any[] = [], audit: any[] = [], attached: any[] = [];
  let afterAnswer = () => {};
  const query = { async openBusinessAnswer() { return { kind: "services", purpose: "knowledge", session,
    async assertCurrentServiceMode() { if (!serviceMode) throw Error("service_mode_changed"); } }; },
    async captureBusinessKnowledge(selected: unknown) { assert.equal(selected, session);
      return session.captureCanonical({ merchantId, mode: "sources", limit: 12 }); },
    async attachBusinessLiveRequest(selected: unknown, value: any) {
      assert.equal(selected, session); assert.equal(value.merchantId, merchantId); attached.push(value.request);
      session.attachLive({ ...value.request, variantId: "variant" }, async () => ({
        facts: { merchantId, productId: "service", variantId: "variant", professionalId: "professional", professionalVersion: 1,
          durationMinutes: 30, timeZone: "UTC", currency: "BRL", priceInCents: price },
        availability: { status: "empty", slots: [], professionalVersion: 1, durationMinutes: 30, timeZone: "UTC", policyVersion: 1 },
        publicLabels: { serviceName: "Current service", professionalName: "Current professional" },
      } as LiveBusinessSnapshot));
      price = 7900; return { status: "attached" };
    }, async execute() { assert.fail("service_must_not_reuse_legacy_context"); } };
  const uc = new SendSupportMessageUseCase({ async complete(messages) {
    prompts.push(messages);
    if (messages[0]!.content.startsWith('{"id":"business.answer-plan"')) return JSON.stringify(plans.shift());
    afterAnswer(); return "ANSWER_FROM_PUBLISHED_SOURCE";
  } }, new SupportHandoffService(tickets, new SupportTicketEventPublisher()), query as never,
    undefined, { async execute(value: any) { audit.push(value); } } as never);
  const run = () => uc.execute({ merchant_id: merchantId, session_id: "turn", message: "Qual o preparo publicado desse atendimento?" },
    { brandName: "STALE_DIRECT_BRAND", faqItems: [{ id: "stale", question: "Qual o preparo publicado desse atendimento?", answer: "STALE_DIRECT_FAQ" }] });
  return { uc, run, session, tickets, plans, prompts, audit, attached, change: () => { content = "WITHDRAWN_OR_CHANGED"; },
    changeMode: () => { serviceMode = false; }, onAnswer: (callback: () => void) => { afterAnswer = callback; } };
}

test("T71 support uses current selected public context and excludes old direct FAQ/company fields", async () => {
  const f = await fixture(); f.plans.push({ kind: "informational", liveRequests: [] });
  const output = await f.run(); assert.equal(output.reply, "ANSWER_FROM_PUBLISHED_SOURCE");
  assert.equal(output.handoff, undefined); assert.deepEqual(await f.tickets.list(merchantId), []);
  assert.ok(JSON.stringify(f.prompts).includes("PUBLISHED_PREPARATION"));
  assert.equal(JSON.stringify(f.prompts[0]).includes("PUBLISHED_PREPARATION"), false,
    "published prose must not select the operational professional-referral route");
  assert.doesNotMatch(JSON.stringify(f.prompts), /STALE_DIRECT_BRAND|STALE_DIRECT_FAQ/);
  assert.equal(f.audit[0].admission.status, "ready"); assert.equal(f.audit[0].finalResponse, output.reply);
});

for (const changed of ["source", "mode"] as const) test(`T71 support discards generated facts after last-await ${changed} change`, async () => {
  const f = await fixture(); f.plans.push({ kind: "informational", liveRequests: [] });
  f.onAnswer(changed === "source" ? f.change : f.changeMode);
  const output = await f.run(); assert.doesNotMatch(output.reply, /ANSWER_FROM_PUBLISHED_SOURCE|STALE_DIRECT/);
  assert.notEqual(f.audit[0].admission.status, "ready"); assert.deepEqual(f.audit[0].admission.evidence, []);
  assert.equal(f.audit[0].finalResponse, output.reply);
});

test("T71 support professional decision creates the existing real ticket without generated diagnosis", async () => {
  const f = await fixture(); f.plans.push({ kind: "professional_decision", liveRequests: [] });
  const output = await f.run(), stored = await f.tickets.list(merchantId);
  assert.equal(stored.length, 1); assert.equal(stored[0]!.id, output.handoff?.ticketId);
  assert.equal(stored[0]!.sessionId, "turn"); assert.equal(f.prompts.length, 1);
  assert.doesNotMatch(output.reply, /ANSWER_FROM_PUBLISHED_SOURCE|STALE_DIRECT/);
  assert.equal(f.audit[0].admission.status, "insufficient"); assert.deepEqual(f.audit[0].admission.evidence, []);
});

test("T71 missing public evidence cannot block a professional referral or grant factual authority", async () => {
  const f = await fixture(); f.plans.push({ kind: "professional_decision", liveRequests: [] });
  Object.defineProperty(f.uc, "queryKnowledge", { value: {
    async openBusinessAnswer() { return { kind: "services", purpose: "knowledge", session: f.session,
      async assertCurrentServiceMode() { throw Error("source_selection_unavailable"); } }; },
    async captureBusinessKnowledge() { return { status: "insufficient" }; },
  } });
  const output = await f.run(), tickets = await f.tickets.list(merchantId);
  assert.equal(tickets.length, 1); assert.equal(tickets[0]!.id, output.handoff?.ticketId);
  assert.equal(f.prompts.length, 1); assert.doesNotMatch(output.reply, /ANSWER_FROM_PUBLISHED_SOURCE/);
  assert.equal(f.audit[0].admission.status, "insufficient"); assert.deepEqual(f.audit[0].admission.evidence, []);
});

test("T71 support live answer renders current values and current occupancy without another narration", async () => {
  const f = await fixture(); f.plans.push({ kind: "live_facts", liveRequests: [request] });
  const output = await f.run(); assert.match(output.reply, /79,00/); assert.doesNotMatch(output.reply, /73,00|ANSWER_FROM_PUBLISHED_SOURCE/);
  assert.match(output.reply, /período consultado/); assert.equal(f.prompts.length, 1);
  assert.deepEqual(f.attached, [request]); assert.deepEqual(await f.tickets.list(merchantId), []);
  assert.equal(f.audit[0].admission.status, "ready");
});

test("T71 invalid service planning cannot supply tenant, arbitrary query or live writer authority", async () => {
  const f = await fixture(); f.plans.push({ kind: "live_facts", liveRequests: [{ ...request, merchantId: "foreign" }],
    cypher: "MATCH (n) DELETE n" });
  const output = await f.run(); assert.deepEqual(f.attached, []); assert.equal(f.prompts.length, 1);
  assert.doesNotMatch(output.reply, /ANSWER_FROM_PUBLISHED_SOURCE|DELETE|foreign/);
  assert.deepEqual(await f.tickets.list(merchantId), []);
});

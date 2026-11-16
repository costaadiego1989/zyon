import assert from "node:assert/strict";
import test from "node:test";
import { SendStoreMessageUseCase } from "./send-store-message.use-case.js";
import { PrismaMerchantAgentRuleReader } from "../../../agent-rules/infrastructure/merchant-agent-rule-reader.adapter.js";

const input = { merchant_id: "merchant", conversation_id: "conversation", cart_id: "conversation", user_message: "Conte sobre a loja" };
const reference = { origin: "legacy_sql", namespace: "canonical-legacy", merchantId: "merchant", sourceType: "faq", sourceId: "public-faq",
  sourceVersion: "current", sourceHash: "a".repeat(64), publicWorkVersion: null, publicationState: "published", embeddingModel: null,
  embeddingDimensions: null, chunkId: "chunk", contentHash: "b".repeat(64) } as const;
const evidence = () => ({ status: "ready", evidence: [{ id: "chunk", content: "PUBLIC", provenance: { ...reference } }] });
const reply = { message: "Informacao publica da loja.", blocks: [], cartId: "conversation", suggestedNext: [] };
function fixture(output: unknown = reply, auditFailure?: Error, emitEvidence = true) {
  const records: any[] = [];
  const prisma = { merchantRule: { findUnique: async () => null }, checkoutSetting: { findUnique: async () => null },
    agentRule: { findFirst: async () => null }, promptExperiment: { findFirst: async () => null }, buyerAccount: { findUnique: async () => null } };
  const port = { reply: async (_input: unknown, _deferred: unknown, capture?: (value: unknown) => void) => {
    const admission = evidence();if (emitEvidence) capture?.(admission);
    admission.evidence[0]!.provenance.sourceId = "MUTATED-AFTER-CAPTURE";
    return output;
  } };
  const audit = { execute: async (value: unknown) => { if (auditFailure) throw auditFailure;records.push(value); } };
  const useCase = new (SendStoreMessageUseCase as any)({ getProfile: async () => ({ name: "Loja", storeCategory: "books" }),
    getStoreSettings: async () => ({}) }, port, prisma, new PrismaMerchantAgentRuleReader(prisma as any), undefined, undefined, audit);
  Object.assign(useCase, { logger: { debug() {}, log() {}, warn() {} } });
  return { useCase, records, withoutAudit: () => { (useCase as any).knowledgeAudit = undefined; } };
}

test("T69 storefront audits the validated application response without changing the wire schema", async t => {
  await t.test("retains exact public proof and a stable snapshot through its private callback", async () => {
    const f = fixture();const result = await f.useCase.execute(input);
    assert.deepEqual(result, { message: reply.message, blocks: [], cart_id: "conversation", conversation_id: "conversation", suggested_next: [] });
    assert.equal(f.records.length, 1);assert.equal(f.records[0].channel, "storefront");
    assert.equal(f.records[0].finalResponse, result.message);
    assert.deepEqual(f.records[0].admission.evidence[0].provenance, reference);
  });
  await t.test("strict output fallback and WhatsApp presentation bind the actual selected text", async () => {
    const f = fixture({ ...reply, unknownField: "DISCARDED_PROVIDER_CANARY" });
    const result = await f.useCase.execute(input, undefined, "whatsapp");
    assert.notEqual(result.message, reply.message);assert.equal(JSON.stringify(result).includes("DISCARDED_PROVIDER_CANARY"), false);
    assert.equal(f.records.length, 1);assert.equal(f.records[0].channel, "whatsapp");
    assert.equal(f.records[0].finalResponse, result.message);
    assert.deepEqual(f.records[0].admission.evidence[0].provenance, reference);
  });
  await t.test("persistence failures and missing audit cannot become unlogged validated success", async () => {
    const failure = new Error("synthetic_audit_error"), f = fixture(reply, failure);
    await assert.rejects(f.useCase.execute(input), error => error === failure);
    const missing = fixture();missing.withoutAudit();
    await assert.rejects(missing.useCase.execute(input), /knowledge_response_audit_unavailable/);
    const legacy = fixture(reply, undefined, false);legacy.withoutAudit();
    assert.equal((await legacy.useCase.execute(input)).message, reply.message);
  });
});

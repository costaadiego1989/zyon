import assert from "node:assert/strict";
import test from "node:test";
import { SendStoreMessageUseCase } from "./send-store-message.use-case.js";
import { PrismaMerchantAgentRuleReader } from "../../../agent-rules/infrastructure/merchant-agent-rule-reader.adapter.js";

function fixture(failure?: Error) {
  const order: string[] = [];
  const prisma = { merchantRule: { findUnique: async () => null }, checkoutSetting: { findUnique: async () => null },
    agentRule: { findFirst: async () => null }, promptExperiment: { findFirst: async () => null }, buyerAccount: { findUnique: async () => null } };
  const port = { async reply(_input: unknown, _deferred: unknown, capture: (...args: any[]) => void) {
    capture({ status: "ready", evidence: [{ id: "canonical", content: "Public company", provenance: {
      origin: "canonical_sql", namespace: "canonical-public", merchantId: "merchant", sourceType: "company", sourceId: "merchant",
      sourceVersion: "current", sourceHash: "a".repeat(64), publicationState: "published", publicWorkVersion: null,
      embeddingModel: null, embeddingDimensions: null, chunkId: "company", contentHash: "b".repeat(64),
    } }] }, "services");
    return { message: "Current public company", blocks: [], cartId: "conversation", suggestedNext: [] };
  } };
  const repository = { async upsertConversation(value: any) { order.push(value.message.role); } };
  const audit = { async execute(value: any) { order.push("audit"); assert.equal(value.finalResponse, "Current public company"); if (failure) throw failure; } };
  const useCase = new (SendStoreMessageUseCase as any)({ getProfile: async () => ({ name: "Company", storeCategory: "services" }),
    getStoreSettings: async () => ({}) }, port, prisma, new PrismaMerchantAgentRuleReader(prisma as any), repository, undefined, audit);
  return { useCase, order };
}
const input = { merchant_id: "merchant", conversation_id: "conversation", cart_id: "conversation",
  user_message: "Conte sobre a empresa", global_user_id: "synthetic-buyer" };
test("T71 service source audit completes before the agent reply enters history", async () => {
  const f = fixture(); assert.equal((await f.useCase.execute(input)).message, "Current public company");
  assert.deepEqual(f.order, ["audit", "buyer", "agent"]);
});
test("T71 a service source audit failure never persists an unlogged agent answer", async () => {
  const failure = new Error("synthetic_audit_refused"), f = fixture(failure);
  await assert.rejects(f.useCase.execute(input), error => error === failure);
  assert.deepEqual(f.order, ["audit"]);
});

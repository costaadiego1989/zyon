import assert from "node:assert/strict";
import test from "node:test";
import { SendSupportMessageUseCase } from "./send-support-message.use-case.js";

const merchantId = "synthetic-public-audit";
const content = "Politica publica atual da loja.";
const reference = { origin: "legacy_sql", namespace: "canonical-legacy", merchantId,
  sourceType: "policy", sourceId: "returns", sourceVersion: "12", sourceHash: "a".repeat(64),
  publicWorkVersion: null, publicationState: "published", embeddingModel: null,
  embeddingDimensions: null, chunkId: "current-public-chunk", contentHash: "b".repeat(64) } as const;
const admission = () => ({ status: "ready", chunks: [{ id: "current-public-chunk", merchantId,
  sourceType: "policy", sourceId: "returns", content }],
  evidence: [{ id: "current-public-chunk", content, provenance: { ...reference } }] });
const input = { merchant_id: merchantId, session_id: "synthetic-audit-session", message: "Qual e a politica de devolucao?" };

test("T69 support preserves admitted sources through the final reply", async t => {
  await t.test("audits exact public references while private order context stays out of admission", async () => {
    const recorded: any[] = [], prompts: any[] = [];
    const useCase = new (SendSupportMessageUseCase as any)(
      { complete: async (messages: unknown) => { prompts.push(messages); return "Consulte a politica oficial da loja."; } },
      { createHandoff: async () => { throw new Error("unexpected_handoff"); } },
      { execute: async () => admission() },
      { getRecentOrdersContext: async () => "ORDER_PRIVATE_CANARY" },
      { execute: async (value: unknown) => { recorded.push(value); } },
    );
    const result = await useCase.execute(input, { buyerGlobalUserId: "verified-own-buyer" });
    assert.equal(result.reply, "Consulte a politica oficial da loja.");
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0].merchantId, merchantId);
    assert.equal(recorded[0].channel, "support");
    assert.equal(recorded[0].finalResponse, result.reply);
    assert.equal(recorded[0].admission.status, "ready");
    assert.deepEqual(recorded[0].admission.evidence[0].provenance, reference);
    assert.equal(JSON.stringify(recorded[0].admission).includes("ORDER_PRIVATE_CANARY"), false);
    assert.equal(JSON.stringify(prompts).includes("ORDER_PRIVATE_CANARY"), true);
  });
  await t.test("an audit persistence error remains visible instead of returning an unlogged factual success", async () => {
    const failure = new Error("synthetic_audit_write_failed");
    const useCase = new (SendSupportMessageUseCase as any)(
      { complete: async () => "Consulte a politica oficial da loja." },
      { createHandoff: async () => { throw new Error("unexpected_handoff"); } },
      { execute: async () => admission() }, undefined,
      { execute: async () => { throw failure; } },
    );
    await assert.rejects(useCase.execute(input), error => error === failure);
  });
  await t.test("validated evidence cannot silently bypass a missing audit collaborator", async () => {
    const chat = { complete: async () => "Consulte a politica oficial da loja." };
    const handoff = { createHandoff: async () => { throw new Error("unexpected_handoff"); } };
    const useCase = new (SendSupportMessageUseCase as any)(chat, handoff, { execute: async () => admission() });
    await assert.rejects(useCase.execute(input), /knowledge_response_audit_unavailable/);
    const legacy = new (SendSupportMessageUseCase as any)(chat, handoff, { execute: async () => ({ chunks: admission().chunks }) });
    assert.equal((await legacy.execute(input)).reply, "Consulte a politica oficial da loja.");
  });
  await t.test("audits the selected safe fallback rather than the discarded model response", async () => {
    const recorded: any[] = [];
    const useCase = new (SendSupportMessageUseCase as any)(
      { complete: async () => null },
      { createHandoff: async () => { throw new Error("unexpected_handoff"); } },
      { execute: async () => admission() }, undefined,
      { execute: async (value: unknown) => { recorded.push(value); } },
    );
    const result = await useCase.execute(input, { faqItems: [{ id: "configured", question: input.message, answer: "Resposta segura configurada." }] });
    assert.equal(result.reply, "Resposta segura configurada.");
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0].finalResponse, result.reply);
    assert.deepEqual(recorded[0].admission.evidence[0].provenance, reference);
  });
});

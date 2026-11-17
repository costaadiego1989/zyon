// TEST FIRST, SOURCE ONLY. Synthetic ports prove branch composition, not embeddings/SQL runtime.
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { TenantContextService } from "../../../../shared/tenant/tenant-context.service.js";
import { ServiceBusinessAnswerFactory } from "./service-business-answer.factory.js";
import { PublicBusinessAnswerSession, type SessionDependencies } from "./public-business-answer-session.js";
import { GRAPH_EMBEDDING_ID } from "../../../graph-rag/domain/graph-embedding-model.js";
import type { PublicBusinessReadResult, PublicBusinessGraphHit } from "../../../graph-rag/domain/public-business-result.js";
import type { PublicEvidenceResult, ValidatedPublicEvidence } from "../../domain/public-source-evidence.js";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const content = "Public selected service description", version = "public-v1:00000000000000000001";
const hit: PublicBusinessGraphHit = { merchantId: "own", sourceType: "service", sourceId: "svc", publicRevision: 1,
  sourceHash: "a".repeat(64), modelId: GRAPH_EMBEDDING_ID, dimensions: 384, projectedAt: 1, schemaVersion: 1, active: true,
  chunkId: "chunk", contentHash: sha(content), vectorScore: .8, score: .8 };
const evidence: ValidatedPublicEvidence = { id: "chunk", content, provenance: { origin: "public_graph", namespace: "public-business-v1",
  merchantId: "own", sourceType: "service", sourceId: "svc", sourceVersion: "canonical-current", sourceHash: hit.sourceHash,
  publicWorkVersion: version, publicationState: "published", embeddingModel: GRAPH_EMBEDDING_ID, embeddingDimensions: 384,
  chunkId: "chunk", contentHash: sha(content) } };
function fixture() {
  const tenant = new TenantContextService(), calls: string[] = [], canonicalRequests: unknown[] = [], graphRequests: unknown[] = [];
  let denied = false, graph: PublicBusinessReadResult = { status: "ready", kind: "public_business", mode: "sources", hits: [hit], partial: true };
  const admissions: PublicEvidenceResult[] = [];
  const prisma = { $transaction: async (work: (tx: Prisma.TransactionClient) => Promise<unknown>) => work({
    $queryRaw: async () => [{ id: "own" }], merchant: { findUnique: async () => ({ businessMode: "services", businessModeSelectedAt: new Date(0), businessModeNeedsReview: false }) },
  } as unknown as Prisma.TransactionClient) } as unknown as PrismaClient;
  const deps: SessionDependencies = { scope: { assertScope: id => { assert.equal(tenant.get()?.merchantId, id); } },
    billing: { assertAllowed: async () => { if (denied) throw Error("denied"); } },
    canonical: { read: async request => { calls.push("canonical"); canonicalRequests.push(request); return { status: "unavailable", reason: "canonical_unavailable", evidence: [], pairs: [] }; },
      recheck: async () => ({ status: "unavailable", reason: "canonical_unavailable", evidence: [], pairs: [] }) },
    publicSources: { revalidate: async () => { calls.push("public-admission"); return admissions.shift() ?? { status: "ready", evidence: [evidence] }; },
      revalidatePairs: async () => { calls.push("pair-admission"); return { status: "insufficient", evidence: [], pairs: [] }; },
      revalidateLegacy: async () => assert.fail("public route never mints legacy proof") } };
  const factory = new ServiceBusinessAnswerFactory(prisma, tenant, deps.billing, deps.canonical, deps.publicSources,
    { searchPublicBusiness: async request => { calls.push("graph"); graphRequests.push(request); return graph; } },
    { attach: async () => { calls.push("live"); return { status: "attached" }; } });
  const run = (work: (session: PublicBusinessAnswerSession) => Promise<void>, fallbackPurpose: "existing_company_context" | "existing_support_faq" | "existing_store_policy" = "existing_company_context") =>
    tenant.run({ merchantId: "own", role: "buyer", userId: "verified" }, async () => {
      const opened = await factory.open({ merchantId: "own", fallbackPurpose }); if (opened.kind !== "services") assert.fail("service session required"); await work(opened.session);
    });
  return { factory, deps, run, calls, canonicalRequests, graphRequests, admissions, graph: (value: PublicBusinessReadResult) => { graph = value; }, deny: () => { denied = true; } };
}
test("T71 actual public retrieval bridge before generation", async t => {
  await t.test("indexed ready uses publicGraphCandidate and both initial/final original admission", async () => {
    const f = fixture(); await f.run(async session => {
      assert.deepEqual(await f.factory.captureBusinessKnowledge(session, { merchantId: "own", queryText: "services", mode: "sources", limit: 12 }), { status: "ready", arm: "public_graph" });
      assert.equal(session.evidenceCount, 1); assert.deepEqual(f.calls, ["graph", "public-admission", "public-admission"]);
      const final = await session.answer(async () => ({ message: "selected public fact" }), { kind: "public_text", safeReply: () => ({ message: "safe" }) });
      assert.equal(final.status, "ready"); assert.equal(final.evidence[0]?.provenance.origin, "public_graph"); assert.equal(f.calls.at(-1), "public-admission");
      assert.equal(f.canonicalRequests.length, 0);
    });
  });
  await t.test("disabled/empty graph chooses honest bounded six-family canonical before capture", async () => {
    for (const empty of [false, true]) { const f = fixture(); f.graph(empty ? { status: "ready", kind: "public_business", mode: "sources", hits: [], partial: true } : { status: "unavailable", reason: "disabled" });
      await f.run(async session => { const result = await f.factory.captureBusinessKnowledge(session, { merchantId: "own", queryText: "company services", mode: "sources", limit: 12 });
        assert.deepEqual(result, { status: "unavailable", arm: "canonical_sql" });
        assert.deepEqual(f.canonicalRequests, [{ merchantId: "own", mode: "sources", limit: 12, sourceTypes: ["company", "business_hours", "professional", "service", "faq", "policy"] }]);
        assert.equal(f.calls.includes("public-admission"), false);
      }); }
  });
  await t.test("failed graph pre-admission can choose canonical without poisoning the untouched session", async () => {
    const f = fixture(); f.admissions.push({ status: "insufficient", evidence: [] }); await f.run(async session => {
      assert.deepEqual(await f.factory.captureBusinessKnowledge(session, { merchantId: "own", queryText: "services", mode: "sources" }), { status: "unavailable", arm: "canonical_sql" });
      assert.deepEqual(f.calls, ["graph", "public-admission", "canonical"]);
    });
  });
  await t.test("a second-read race keeps sticky capture refusal and never falls back", async () => {
    const f = fixture(); f.admissions.push({ status: "ready", evidence: [evidence] }, { status: "insufficient", evidence: [] }); await f.run(async session => {
      assert.deepEqual(await f.factory.captureBusinessKnowledge(session, { merchantId: "own", queryText: "services", mode: "sources" }), { status: "insufficient", arm: "public_graph" });
      assert.equal(f.canonicalRequests.length, 0);
      const result = await session.answer(async () => assert.fail("refused session never generates"), { kind: "public_text", safeReply: () => ({ message: "safe" }) });
      assert.equal(result.reply.message, "safe"); assert.deepEqual(result.evidence, []);
    });
  });
  await t.test("conflicting pre-admission is terminal and cannot select unrelated canonical facts", async () => {
    const f = fixture(); f.admissions.push({ status: "conflicting", evidence: [] }); await f.run(async session => {
      assert.deepEqual(await f.factory.captureBusinessKnowledge(session, { merchantId: "own", queryText: "services", mode: "sources" }), { status: "conflicting", arm: "public_graph" });
      assert.equal(f.canonicalRequests.length, 0);
    });
  });
  await t.test("narrow purpose and forged/unregistered sessions cannot call graph/pairs/live", async () => {
    for (const purpose of ["existing_company_context", "existing_support_faq", "existing_store_policy"] as const) { const f = fixture(); f.deny(); await f.run(async session => {
      await assert.rejects(f.factory.captureBusinessKnowledge(session, { merchantId: "own", queryText: "services", mode: "sources" }), /business_answer_session_denied/);
      await assert.rejects(f.factory.attachBusinessLiveRequest(session, { merchantId: "own", request: {} }), /business_answer_session_denied/); assert.deepEqual(f.calls, []);
    }, purpose); }
    const f = fixture(); await f.run(async () => {
      const opened = await PublicBusinessAnswerSession.open({ merchantId: "own", purpose: "knowledge" }, f.deps); if (opened.status !== "ready") assert.fail("session required");
      await assert.rejects(f.factory.captureBusinessKnowledge(opened.session, { merchantId: "own", queryText: "services", mode: "sources" }), /business_answer_session_denied/);
      assert.deepEqual(f.calls, []);
    });
  });
  await t.test("foreign tenant or malformed selector rejects before any retrieval/source/live IO", async () => {
    const f = fixture(); await f.run(async session => {
      await assert.rejects(f.factory.captureBusinessKnowledge(session, { merchantId: "foreign", queryText: "services", mode: "sources" }), /business_answer_session_denied/);
      assert.deepEqual(await f.factory.captureBusinessKnowledge(session, { merchantId: "own", queryText: "", mode: "sources" }), { status: "unavailable", arm: "canonical_sql" });
      assert.deepEqual(f.calls, []);
    });
  });
  await t.test("bounded pair fallback retains original requested tuples and whole-endpoint budget", async () => {
    const f = fixture(); f.graph({ status: "unavailable", reason: "disabled" }); await f.run(async session => {
      await f.factory.captureBusinessKnowledge(session, { merchantId: "own", queryText: "professional", mode: "service_professional", limit: 5,
        pairs: [{ serviceId: "svc", professionalId: "pro" }] });
      assert.deepEqual(f.canonicalRequests, [{ merchantId: "own", mode: "service_professional", limit: 4, pairs: [{ serviceId: "svc", professionalId: "pro" }] }]);
      assert.equal((f.graphRequests[0] as { limit: number }).limit, 2);
    });
  });
});

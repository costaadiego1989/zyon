// TEST FIRST. REAL canonical selector/projection/chunker/handles, synthetic DB delegates only.
import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma, PrismaClient } from "@prisma/client";
import { TenantContextService } from "../../../../shared/tenant/tenant-context.service.js";
import { PrismaCanonicalPublicSnapshotReader } from "../../infrastructure/prisma-canonical-public-snapshot-reader.js";
import { PublicBusinessAnswerSession, type SessionDependencies } from "./public-business-answer-session.js";

function fixture() {
  const tenant = new TenantContextService(), epoch = new Date("2030-01-01T00:00:00Z"); let billing = 0;
  const merchant = { id: "own", name: "Public business", storeCategory: "services", storeSettings: {}, updatedAt: epoch,
    businessMode: "services", businessModeSelectedAt: epoch, businessModeNeedsReview: false };
  const tx = { $queryRaw: async (query: Prisma.Sql) => {
    const text = query.strings.join(""), values = query.values;
    if (text.includes("FOR SHARE")) return [{ id: "own" }];
    if (!text.includes("public_ids")) return [];
    const ids = values.slice(0, -6) as string[], after = values.at(-5) as string | null, count = values.at(-1) as number;
    return ids.filter(id => !after || id > after).sort().slice(0, count).map(id => ({ id }));
  }, merchant: { findUnique: async () => merchant },
    supportSetting: { findUnique: async () => ({ faqItems: [{ id: "faq-one", question: "How to reach reception?", answer: "Use the published company contact." }], updatedAt: epoch }) },
    merchantPolicy: { findUnique: async () => ({ returns: "Contact the human central for the registered return policy.", updatedAt: epoch }) },
  } as unknown as Prisma.TransactionClient;
  const prisma = { $transaction: async (work: (client: Prisma.TransactionClient) => Promise<unknown>) => work(tx) } as unknown as PrismaClient;
  const deps: SessionDependencies = { scope: { assertScope: id => assert.equal(tenant.get()?.merchantId, id) },
    billing: { assertAllowed: async () => { billing++; throw Error("existing-plan-denial"); } }, canonical: new PrismaCanonicalPublicSnapshotReader(prisma, tenant),
    publicSources: { revalidate: async () => assert.fail("no public index authority"), revalidatePairs: async () => assert.fail("no pairs"), revalidateLegacy: async () => assert.fail("no legacy") } };
  return { deps, tenant, billing: () => billing };
}
test("T71 existing narrow context retains its original entitlement", async t => {
  await t.test("Free and Starter existing FAQ replies use current canonical content and honest null ABI", async () => {
    for (const plan of ["free", "starter"]) { const f = fixture(); await f.tenant.run({ merchantId: "own", role: "buyer", userId: plan }, async () => {
      assert.equal((await PublicBusinessAnswerSession.open({ merchantId: "own", purpose: "knowledge" }, f.deps)).status, "unavailable");
      const opened = await PublicBusinessAnswerSession.open({ merchantId: "own", purpose: "existing_support_faq" }, f.deps); if (opened.status !== "ready") assert.fail("narrow session required");
      assert.equal((await opened.session.captureCanonical({ merchantId: "own", mode: "sources", limit: 12 })).status, "ready");
      const final = await opened.session.answer(async data => ({ message: data }), { kind: "public_text", safeReply: () => ({ message: "safe" }) });
      assert.equal(final.status, "ready"); assert.match(final.reply.message, /Use the published company contact/);
      assert.equal(final.evidence.length, 1); assert.equal(final.evidence[0]?.provenance.sourceType, "faq");
      const p = final.evidence[0]!.provenance; assert.equal(p.origin, "canonical_sql"); assert.equal(p.namespace, "canonical-public");
      assert.equal(p.publicWorkVersion, null); assert.equal(p.embeddingModel, null); assert.equal(p.embeddingDimensions, null); assert.equal(f.billing(), 1);
      assert.equal(JSON.parse(opened.session.groundingData()).coverage.completeCatalog, false);
    }); }
  });
  await t.test("existing explicit policy tool has only policy source authority", async () => {
    const f = fixture(); await f.tenant.run({ merchantId: "own", role: "buyer", userId: "verified" }, async () => {
      const opened = await PublicBusinessAnswerSession.open({ merchantId: "own", purpose: "existing_store_policy" }, f.deps); if (opened.status !== "ready") assert.fail("policy session required");
      assert.equal((await opened.session.captureCanonical({ merchantId: "own", mode: "sources", limit: 12 })).status, "ready");
      const final = await opened.session.answer(async data => ({ message: data }), { kind: "public_text", safeReply: () => ({ message: "safe" }) });
      assert.equal(final.status, "ready"); assert.ok(final.evidence.length > 0); assert.ok(final.evidence.every(item => item.provenance.sourceType === "policy")); assert.equal(f.billing(), 0);
    });
  });
  await t.test("policy cannot capture company/hours/FAQ/service/professional, tuples or index/live authority", async () => {
    const f = fixture(); await f.tenant.run({ merchantId: "own", role: "buyer", userId: "verified" }, async () => {
      const opened = await PublicBusinessAnswerSession.open({ merchantId: "own", purpose: "existing_store_policy" }, f.deps); if (opened.status !== "ready") assert.fail("policy session required");
      for (const type of ["company", "business_hours", "faq", "service", "professional"] as const)
        await assert.rejects(opened.session.captureCanonical({ merchantId: "own", mode: "sources", limit: 2, sourceTypes: [type] }), /grounding_purpose_denied/);
      await assert.rejects(opened.session.captureCanonical({ merchantId: "own", mode: "service_professional", limit: 2, pairs: [{ serviceId: "s", professionalId: "p" }] }), /grounding_purpose_denied/);
      await assert.rejects(opened.session.capturePublic([]), /grounding_purpose_denied/); await assert.rejects(opened.session.capturePairs([]), /grounding_purpose_denied/);
      await assert.rejects(opened.session.captureLegacy([], "legacy_sql"), /grounding_purpose_denied/);
      assert.throws(() => opened.session.attachLive({ productId: "s", variantId: "v", professionalId: "p", fromDate: "2030-01-01", toDate: "2030-01-01" }, async () => assert.fail("no live")), /grounding_purpose_denied/);
    });
  });
});

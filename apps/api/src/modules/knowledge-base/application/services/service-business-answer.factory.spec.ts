// TEST FIRST, SOURCE ONLY. Planned productive imports; not imported/parsed/run.
import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma, PrismaClient } from "@prisma/client";
import { TenantContextService } from "../../../../shared/tenant/tenant-context.service.js";
import { ServiceBusinessAnswerFactory } from "./service-business-answer.factory.js";
import type { CanonicalPublicSnapshotPort } from "../../infrastructure/prisma-canonical-public-snapshot-reader.js";
import type { SessionDependencies } from "./public-business-answer-session.js";

function fixture() {
  const tenant = new TenantContextService(), events: string[] = [];
  let mode = "services", denied = false, failed = false, selected = true, review = false;
  const prisma = { $transaction: async (work: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
    events.push("transaction"); if (failed) throw Error("private_sql_error");
    return work({ $queryRaw: async () => { events.push("merchant-share"); return [{ id: "own" }]; },
      merchant: { findUnique: async ({ where }: any) => { events.push("mode-read"); assert.equal(where.id, "own");
        return { businessMode: mode, businessModeSelectedAt: selected ? new Date("2030-01-01Z") : null, businessModeNeedsReview: review }; } } } as unknown as Prisma.TransactionClient);
  } } as unknown as PrismaClient;
  const canonical: CanonicalPublicSnapshotPort = { read: async () => { events.push("canonical"); return { status: "unavailable", reason: "canonical_unavailable", evidence: [], pairs: [] }; },
    recheck: async () => ({ status: "unavailable", reason: "canonical_unavailable", evidence: [], pairs: [] }) };
  const publicSources: SessionDependencies["publicSources"] = { revalidate: async () => ({ status: "insufficient", evidence: [] }),
    revalidatePairs: async () => ({ status: "insufficient", evidence: [], pairs: [] }), revalidateLegacy: async () => ({ status: "insufficient", evidence: [] }) };
  const factory = new ServiceBusinessAnswerFactory(prisma, tenant, { assertAllowed: async (_id, feature) => {
    events.push("billing"); assert.deepEqual(feature, { kind: "feature", key: "knowledgeBase" }); if (denied) throw Error("denied");
  } }, canonical, publicSources);
  const run = (fallbackPurpose: "existing_company_context" | "existing_support_faq" | "existing_store_policy" = "existing_support_faq") => tenant.run({ merchantId: "own", userId: "verified", role: "buyer" },
    () => factory.open({ merchantId: "own", fallbackPurpose }));
  return { factory, tenant, events, run, mode: (value: string) => { mode = value; }, deny: () => { denied = true; }, fail: () => { failed = true; },
    unsettled: () => { selected = false; }, review: () => { review = true; } };
}

test("T71 verified service answer bridge", async t => {
  await t.test("canonical products returns before billing/canonical and never follows a body service flag", async () => {
    const f = fixture(); f.mode("products"); assert.deepEqual(await f.run(), { kind: "products" });
    assert.deepEqual(f.events, ["transaction", "merchant-share", "mode-read"]);
    const bodyWithUntrustedFlag = { merchantId: "own", fallbackPurpose: "existing_company_context" as const, businessMode: "services" };
    const output = await f.tenant.run({ merchantId: "own", userId: "verified", role: "buyer" }, () => f.factory.open(bodyWithUntrustedFlag));
    assert.deepEqual(output, { kind: "products" });
  });
  await t.test("services opens general purpose after the existing paid gate without selecting references", async () => {
    const f = fixture(), result = await f.run(); assert.equal(result.kind, "services");
    if (result.kind !== "services") assert.fail("service turn required"); assert.equal(result.purpose, "knowledge"); assert.equal(result.session.evidenceCount, 0);
    assert.equal(f.events.filter(v => v === "billing").length, 1); assert.equal(f.events.includes("canonical"), false);
  });
  await t.test("Free/Starter denial opens only the authorized narrow fallback without a second billing grant", async () => {
    for (const fallback of ["existing_support_faq", "existing_company_context", "existing_store_policy"] as const) { const f = fixture(); f.deny(); const result = await f.run(fallback);
      if (result.kind !== "services") assert.fail("narrow turn required"); assert.equal(result.purpose, fallback); assert.equal(result.session.evidenceCount, 0);
      assert.equal(f.events.filter(v => v === "billing").length, 1); }
  });
  await t.test("unknown SQL/classification cannot be treated as products or permissive service mode", async () => {
    for (const change of ["sql", "unselected", "review"]) { const f = fixture(); if (change === "sql") f.fail(); else if (change === "unselected") f.unsettled(); else f.review();
      assert.deepEqual(await f.run(), { kind: "unavailable", reason: "canonical_scope_unavailable" }); assert.equal(f.events.includes("billing"), false); }
  });
  await t.test("foreign ALS rejects before source IO and no session is minted", async () => {
    const f = fixture(); assert.deepEqual(await f.tenant.run({ merchantId: "foreign", userId: "verified", role: "buyer" }, () => f.factory.open({ merchantId: "own", fallbackPurpose: "existing_support_faq" })),
      { kind: "unavailable", reason: "canonical_scope_unavailable" }); assert.deepEqual(f.events, []);
  });
  await t.test("the last mode assertion rereads the same verified canonical merchant", async () => {
    const f = fixture(); await f.tenant.run({ merchantId: "own", userId: "verified", role: "buyer" }, async () => {
      const result = await f.factory.open({ merchantId: "own", fallbackPurpose: "existing_support_faq" }); if (result.kind !== "services") assert.fail("turn required");
      f.mode("products"); await assert.rejects(result.assertCurrentServiceMode(), /service_business_mode_changed/);
    });
  });
  await t.test("the last assertion rejects a revoked general entitlement without upgrading to narrow", async () => {
    const f = fixture(); await f.tenant.run({ merchantId: "own", userId: "verified", role: "buyer" }, async () => {
      const result = await f.factory.open({ merchantId: "own", fallbackPurpose: "existing_company_context" }); if (result.kind !== "services") assert.fail("turn required");
      f.deny(); await assert.rejects(result.assertCurrentServiceMode(), /denied/);
    });
  });
});

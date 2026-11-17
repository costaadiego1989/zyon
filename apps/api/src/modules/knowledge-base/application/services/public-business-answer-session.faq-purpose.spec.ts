// TEST FIRST. Narrow existing FAQ permission only; no handle or capability casts.
import assert from "node:assert/strict";
import test from "node:test";
import { PublicBusinessAnswerSession, type SessionDependencies } from "./public-business-answer-session.js";

test("T71 narrow existing support FAQ purpose", async t => {
  const reads: unknown[] = []; let billing = 0;
  const deps: SessionDependencies = { scope: { assertScope: id => assert.equal(id, "own") },
    billing: { assertAllowed: async () => { billing++; throw Error("plan_denied"); } },
    canonical: { read: async input => { reads.push(input); return { status: "unavailable", reason: "canonical_unavailable", evidence: [], pairs: [] }; },
      recheck: async () => ({ status: "unavailable", reason: "canonical_unavailable", evidence: [], pairs: [] }) },
    publicSources: { revalidate: async () => assert.fail("narrow purpose has no public authority"),
      revalidatePairs: async () => assert.fail("narrow purpose has no pair authority"), revalidateLegacy: async () => assert.fail("narrow purpose has no legacy authority") } };
  await t.test("existing FAQ is admitted without granting Free/Starter general KB", async () => {
    const denied = await PublicBusinessAnswerSession.open({ merchantId: "own", purpose: "knowledge" }, deps); assert.equal(denied.status, "unavailable");
    const opened = await PublicBusinessAnswerSession.open({ merchantId: "own", purpose: "existing_support_faq" }, deps);
    if (opened.status !== "ready") assert.fail("narrow open required"); await opened.session.captureCanonical({ merchantId: "own", mode: "sources", limit: 10 });
    assert.deepEqual(reads.at(-1), { merchantId: "own", mode: "sources", limit: 10, sourceTypes: ["faq"] }); assert.equal(billing, 1);
  });
  await t.test("every other source family and tuple mode is denied before IO", async () => {
    for (const sourceType of ["company", "business_hours", "professional", "service", "policy"] as const) {
      const result = await PublicBusinessAnswerSession.open({ merchantId: "own", purpose: "existing_support_faq" }, deps); if (result.status !== "ready") assert.fail("narrow required");
      await assert.rejects(result.session.captureCanonical({ merchantId: "own", mode: "sources", limit: 2, sourceTypes: [sourceType] }), /grounding_purpose_denied/);
    }
    const result = await PublicBusinessAnswerSession.open({ merchantId: "own", purpose: "existing_support_faq" }, deps); if (result.status !== "ready") assert.fail("narrow required");
    await assert.rejects(result.session.captureCanonical({ merchantId: "own", mode: "service_professional", limit: 2, pairs: [{ serviceId: "s", professionalId: "p" }] }), /grounding_purpose_denied/);
  });
  await t.test("public/legacy/pair/live entrypoints cannot widen existing FAQ permission", async () => {
    const result = await PublicBusinessAnswerSession.open({ merchantId: "own", purpose: "existing_support_faq" }, deps); if (result.status !== "ready") assert.fail("narrow required");
    await assert.rejects(result.session.capturePublic([]), /grounding_purpose_denied/); await assert.rejects(result.session.capturePairs([]), /grounding_purpose_denied/);
    await assert.rejects(result.session.captureLegacy([], "legacy_sql"), /grounding_purpose_denied/);
    assert.throws(() => result.session.attachLive({ productId: "s", variantId: "v", professionalId: "p", fromDate: "2030-01-01", toDate: "2030-01-01" }, async () => assert.fail("no live authority")), /grounding_purpose_denied/);
  });
  await t.test("existing company/hour purpose does not gain FAQ authority", async () => {
    const result = await PublicBusinessAnswerSession.open({ merchantId: "own", purpose: "existing_company_context" }, deps); if (result.status !== "ready") assert.fail("company required");
    await assert.rejects(result.session.captureCanonical({ merchantId: "own", mode: "sources", limit: 2, sourceTypes: ["faq"] }), /grounding_purpose_denied/);
  });
});

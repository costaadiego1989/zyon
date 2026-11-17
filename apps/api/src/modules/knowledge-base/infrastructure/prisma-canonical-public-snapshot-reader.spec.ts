import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma, PrismaClient } from "@prisma/client";
import { PrismaCanonicalPublicSnapshotReader, type CanonicalReadRequest, type CanonicalSelectionHandle } from "./prisma-canonical-public-snapshot-reader.js";
import { PublicBusinessAnswerSession, type SessionDependencies } from "../application/services/public-business-answer-session.js";

const merchantId = "synthetic-company", epoch = new Date("2030-01-01T00:00:00Z");
const faq = (id: string) => ({ id, question: "Published question " + id, answer: "Published answer " + id });
const product = (id: string, active = true) => ({ id, name: "Published service " + id, description: "Current service description", type: "service",
  isActive: active, deletedAt: null, metadata: {}, updatedAt: epoch, variants: [{ isActive: true, updatedAt: epoch }], category: null });
const professional = (id: string) => ({ id, merchantId, publicName: "Published professional " + id, publicProfile: {}, timeZone: "UTC",
  isActive: true, isPublished: true, version: 1, updatedAt: epoch });
const sources = (sourceTypes: any[] = ["faq"], limit = 20): CanonicalReadRequest => ({ merchantId, mode: "sources", sourceTypes, limit });
const pairRequest = (limit = 20): CanonicalReadRequest => ({ merchantId, mode: "service_professional", limit,
  pairs: [{ serviceId: "svcA", professionalId: "proA" }, { serviceId: "svcB", professionalId: "proB" }] });
function latch() { let release!: () => void; return { promise: new Promise<void>(resolve => { release = resolve; }), release: () => release() }; }
function selected(result: Awaited<ReturnType<PrismaCanonicalPublicSnapshotReader["read"]>>) {
  assert.ok(result.status === "ready" || result.status === "insufficient"); return result;
}
const publicIdentity = (item: any) => [item.id, item.content, item.provenance.sourceHash, item.provenance.contentHash];

// Synthetic delegates execute the REAL reader selector/formatter/parser/chunker.
// SQL objects are routed by known table shape and bound values only. This is
// neither a SQL engine nor evidence of real PostgreSQL locks/rollback/runtime.
function fixture() {
  const state = { merchant: { id: merchantId, name: "Synthetic business", storeCategory: "services", storeSettings: {}, updatedAt: epoch,
    businessMode: "services", businessModeSelectedAt: epoch, businessModeNeedsReview: false },
    faqs: [faq("faqA")], faqUpdatedAt: epoch, products: [product("svcA"), product("svcB")],
    professionals: [professional("proA"), professional("proB")], links: [{ serviceId: "svcA", professionalId: "proA" }] };
  let tenant = merchantId, fail = false, transactions = 0, hold: { entered: ReturnType<typeof latch>; released: ReturnType<typeof latch> } | undefined;
  const calls: string[] = [], canonicalIds: string[] = [];
  const rowsForProducts = (ids: string[]) => state.products.filter(row => ids.includes(row.id)).map(row => ({ ...row,
    professionalServices: state.links.filter(link => link.serviceId === row.id).map(link => ({ merchantId, professionalId: link.professionalId,
      isActive: true, updatedAt: epoch, professional: state.professionals.find(item => item.id === link.professionalId)! })) }));
  const tx = {
    $queryRaw: async (query: Prisma.Sql) => {
      const text = query.strings.join(""), values = query.values;
      if (fail) throw Error("synthetic_private_query_failure");
      if (text.includes("FOR SHARE")) { calls.push("merchant-share"); return [{ id: merchantId }]; }
      calls.push("bounded-discovery");
      let ids: string[];
      if (text.includes("FROM service_professionals")) ids = state.professionals.map(row => row.id);
      else if (text.includes("FROM products")) ids = state.products.map(row => row.id);
      else if (text.includes("public_ids")) ids = values.slice(0, -6) as string[];
      else if (text.includes("WHERE FALSE")) ids = [];
      else if (text.includes("FROM merchants")) ids = [merchantId];
      else return assert.fail("unexpected query shape: no semantic/index/work/provider port is allowed");
      const after = values.at(-5) as string | null, inclusive = values.at(-3) as boolean, count = values.at(-1) as number;
      assert.ok(count >= 1 && count <= 21); assert.equal(calls[0], "merchant-share");
      return ids.filter(id => !after || id > after || inclusive && id === after).sort().slice(0, count).map(id => ({ id }));
    },
    merchant: { findUnique: async ({ where }: any) => { calls.push("canonical-merchant"); return where.id === merchantId ? { ...state.merchant } : null; } },
    supportSetting: { findUnique: async () => ({ faqItems: structuredClone(state.faqs), updatedAt: state.faqUpdatedAt }) },
    merchantPolicy: { findUnique: async () => null },
    serviceProfessional: { findMany: async ({ where }: any) => { canonicalIds.push(...where.id.in); return structuredClone(state.professionals.filter(row => where.id.in.includes(row.id))); } },
    product: { findMany: async ({ where }: any) => { canonicalIds.push(...where.id.in); return structuredClone(rowsForProducts(where.id.in)); } },
  } as unknown as Prisma.TransactionClient;
  const prisma = { $transaction: async (work: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
    transactions++; const waiting = hold; hold = undefined;
    if (waiting) { waiting.entered.release(); await waiting.released.promise; }
    return work(tx);
  } } as unknown as PrismaClient;
  const reader = new PrismaCanonicalPublicSnapshotReader(prisma, { get: () => ({ merchantId: tenant }) } as any);
  return { reader, state, calls, canonicalIds, get transactions() { return transactions; }, fail: () => { fail = true; },
    tenant: (value: string) => { tenant = value; }, resetCalls: () => { calls.length = 0; canonicalIds.length = 0; },
    hold: () => { const waiting = { entered: latch(), released: latch() }; hold = waiting;
      return { entered: waiting.entered.promise, release: waiting.released.release }; } };
}

test("T71 original bounded canonical selector fence draft", async t => {
  await t.test("a new FAQ rejects an old complete list while every originally selected hash remains equal", async () => {
    const f = fixture(), original = selected(await f.reader.read(sources())); assert.equal(original.partial, false);
    f.state.faqs.push(faq("faqB")); const fresh = selected(await f.reader.read(sources()));
    assert.deepEqual(fresh.evidence[0] && publicIdentity(fresh.evidence[0]), publicIdentity(original.evidence[0]));
    assert.equal((await f.reader.recheck(merchantId, original.selection)).status, "changed");
  });
  await t.test("a newly published service changes the original requested service set without changing old service hashes", async () => {
    const f = fixture(), original = selected(await f.reader.read(sources(["service"]))); f.state.products.push(product("svcC"));
    const fresh = selected(await f.reader.read(sources(["service"])));
    assert.deepEqual(fresh.evidence.slice(0, 2).map(publicIdentity), original.evidence.map(publicIdentity));
    assert.equal((await f.reader.recheck(merchantId, original.selection)).status, "changed");
  });
  await t.test("original empty absence rescans and rejects when a current FAQ appears", async () => {
    const f = fixture(); f.state.faqs = []; const original = selected(await f.reader.read(sources())); assert.equal(original.status, "insufficient");
    assert.equal((await f.reader.recheck(merchantId, original.selection)).status, "insufficient");
    f.state.faqs.push(faq("faqNew")); const changed = await f.reader.recheck(merchantId, original.selection);
    assert.equal(changed.status, "changed"); assert.deepEqual(changed.evidence, []);
  });
  await t.test("an originally requested rejected tuple becoming linked rejects the old accepted pair selection", async () => {
    const f = fixture(), original = selected(await f.reader.read(pairRequest())); assert.equal(original.pairs.length, 1);
    f.state.links.push({ serviceId: "svcB", professionalId: "proB" });
    assert.equal((await f.reader.recheck(merchantId, original.selection)).status, "changed");
  });
  await t.test("newly eligible requested pair is detected even when evidence budget keeps it unadmitted", async () => {
    const f = fixture(), original = selected(await f.reader.read(pairRequest(2))); f.state.links.push({ serviceId: "svcB", professionalId: "proB" });
    const fresh = selected(await f.reader.read(pairRequest(2)));
    assert.deepEqual(fresh.evidence.map(publicIdentity), original.evidence.map(publicIdentity)); assert.deepEqual(fresh.pairs, original.pairs);
    assert.equal((await f.reader.recheck(merchantId, original.selection)).status, "changed");
  });
  await t.test("requested tuple endpoint publication is part of the original selector outcome", async () => {
    const f = fixture(); f.state.links.push({ serviceId: "svcB", professionalId: "proB" }); f.state.professionals[1].isPublished = false;
    const original = selected(await f.reader.read(pairRequest())); f.state.professionals[1].isPublished = true;
    assert.equal((await f.reader.recheck(merchantId, original.selection)).status, "changed");
  });
  await t.test("selected removal and public content changes still discard old slices", async () => {
    for (const remove of [false, true]) { const f = fixture(), original = selected(await f.reader.read(sources()));
      if (remove) f.state.faqs = []; else f.state.faqs[0].answer = "Different published answer";
      assert.equal((await f.reader.recheck(merchantId, original.selection)).status, "changed"); }
  });
  await t.test("private-only opaque version churn preserves selection and refreshes actual returned versions", async () => {
    const f = fixture(), original = selected(await f.reader.read(sources())); f.state.faqUpdatedAt = new Date(epoch.getTime() + 1000);
    const current = await f.reader.recheck(merchantId, original.selection); assert.equal(current.status, "current");
    if (current.status !== "current") assert.fail("current proof required");
    assert.deepEqual(current.evidence.map(publicIdentity), original.evidence.map(publicIdentity));
    assert.notEqual(current.evidence[0].provenance.sourceVersion, original.evidence[0].provenance.sourceVersion);
  });
  await t.test("caller-owned source families/cursor/pair objects cannot mutate the handle's original request", async () => {
    const f = fixture(), request: any = sources(), held = f.hold(), reading = f.reader.read(request); await held.entered;
    request.sourceTypes[0] = "service"; request.limit = 1; held.release(); const original = selected(await reading);
    assert.equal(original.evidence[0].provenance.sourceType, "faq"); assert.equal(original.partial, false);
    f.state.products.push(product("svcC")); assert.equal((await f.reader.recheck(merchantId, original.selection)).status, "current");
    const g = fixture(); g.state.faqs = [faq("faqA"), faq("faqB"), faq("faqC")];
    const cursorRequest: any = { ...sources(), cursor: { kind: "after", merchantId, sourceType: "faq", sourceId: "faqA" } };
    const waiting = g.hold(), pending = g.reader.read(cursorRequest); await waiting.entered; cursorRequest.cursor.sourceId = "faqB"; waiting.release();
    const cursorOriginal = selected(await pending); assert.equal(cursorOriginal.evidence[0].provenance.sourceId, "faqB");
    const h = fixture(), pairs: any = pairRequest(), pairOriginal = selected(await h.reader.read(pairs));
    pairs.pairs[1].serviceId = "not-requested"; h.state.links.push({ serviceId: "svcB", professionalId: "proB" });
    assert.equal((await h.reader.recheck(merchantId, pairOriginal.selection)).status, "changed");
  });
  await t.test("completeness and cursor changes reject even when selected public evidence stays identical", async () => {
    for (const replace of [false, true]) { const f = fixture(); f.state.products = [product("a"), ...Array.from({ length: 99 }, (_, i) => product("b" + String(i).padStart(3, "0"), false))];
      const original = selected(await f.reader.read(sources(["service"]))); assert.equal(original.partial, true);
      f.state.products.pop(); if (replace) f.state.products.push(product("b999", false));
      const fresh = selected(await f.reader.read(sources(["service"]))); assert.deepEqual(fresh.evidence.map(publicIdentity), original.evidence.map(publicIdentity));
      assert.equal((await f.reader.recheck(merchantId, original.selection)).status, "changed"); }
  });
  await t.test("same bounded partial page never claims a complete catalog count beyond100 identities", async () => {
    const f = fixture(); f.state.products = [product("a"), ...Array.from({ length: 1000 }, (_, i) => product("b" + String(i).padStart(4, "0"), false))];
    const original = selected(await f.reader.read(sources(["service"]))); assert.equal(original.partial, true); assert.ok(original.nextCursor);
    assert.ok(f.canonicalIds.length <= 100); assert.ok(original.evidence.length <= 20); assert.equal("totalCount" in original, false);
    f.state.products.push(product("zz-new-outside-bounded-horizon")); f.resetCalls();
    assert.equal((await f.reader.recheck(merchantId, original.selection)).status, "current"); assert.ok(f.canonicalIds.length <= 100);
    // This current result validates the same PARTIAL scope, never a global absence/list/count.
  });
  await t.test("whole pairs and20 reference limit are unchanged, including an empty limit1 pair selection", async () => {
    const f = fixture(), original = selected(await f.reader.read(pairRequest(1))); assert.equal(original.evidence.length, 0);
    assert.equal(original.pairs.length, 0); assert.equal(original.partial, true);
    assert.equal((await f.reader.recheck(merchantId, original.selection)).status, "insufficient");
    f.state.links.push({ serviceId: "svcB", professionalId: "proB" }); assert.equal((await f.reader.recheck(merchantId, original.selection)).status, "changed");
  });
  await t.test("final comparison uses the original internal selector and cannot call public read/search to replace proof", async () => {
    const f = fixture(), original = selected(await f.reader.read(sources())), before = f.transactions;
    f.reader.read = async () => assert.fail("a public replacement read cannot authorize the old reply"); f.resetCalls();
    assert.equal((await f.reader.recheck(merchantId, original.selection)).status, "current"); assert.equal(f.transactions, before + 1);
    assert.equal(f.calls[0], "merchant-share"); assert.ok(f.calls.includes("bounded-discovery"));
  });
  await t.test("foreign/forged/cloned handles and invalid selectors cannot widen scope or issue IO", async () => {
    const f = fixture(), original = selected(await f.reader.read(sources())); f.resetCalls();
    for (const handle of [{} as CanonicalSelectionHandle, structuredClone(original.selection)])
      assert.equal((await f.reader.recheck(merchantId, handle)).status, "unavailable");
    f.tenant("foreign"); await assert.rejects(f.reader.recheck(merchantId, original.selection), /scope_mismatch/); f.tenant(merchantId);
    const before = f.transactions; for (const input of [{ ...sources(), limit: 21 }, { ...sources(), query: "free Cypher" },
      { ...sources(), sourceTypes: ["faq", "faq"] }, { ...pairRequest(), pairs: Array.from({ length: 11 }, () => ({ serviceId: "svcA", professionalId: "proA" })) }])
      assert.equal((await f.reader.read(input as any)).status, "unavailable");
    assert.equal(f.transactions, before); assert.equal(f.calls.length, 0);
  });
  await t.test("final canonical query failure returns empty unavailable proof and cannot reuse cached evidence", async () => {
    const f = fixture(), original = selected(await f.reader.read(sources())); f.fail(); const result = await f.reader.recheck(merchantId, original.selection);
    assert.equal(result.status, "unavailable"); assert.deepEqual(result.evidence, []); assert.equal(JSON.stringify(result).includes("synthetic_private"), false);
  });
  await t.test("new duplicate FAQ identity returns conflicting rather than validating the old complete selection", async () => {
    const f = fixture(), original = selected(await f.reader.read(sources())); f.state.faqs.push({ ...faq("faqA"), answer: "Conflicting duplicate" });
    assert.equal((await f.reader.recheck(merchantId, original.selection)).status, "conflicting");
  });
  await t.test("held LAST generation is discarded after result-set drift; billing and global20 remain in force", async () => {
    const f = fixture(); let denied = false, billing = 0;
    const deps = { scope: { assertScope: (value: string) => assert.equal(value, merchantId) },
      billing: { assertAllowed: async (_id: string, feature: unknown) => { billing++; assert.deepEqual(feature, { kind: "feature", key: "knowledgeBase" }); if (denied) throw Error("denied"); } },
      canonical: f.reader,
      publicSources: { revalidate: async () => assert.fail("no semantic replacement"), revalidatePairs: async () => assert.fail("no semantic replacement"),
        revalidateLegacy: async () => assert.fail("no semantic replacement") } } as SessionDependencies;
    denied = true; const blocked = await PublicBusinessAnswerSession.open({ merchantId, purpose: "knowledge" }, deps);
    assert.equal(blocked.status, "unavailable"); assert.equal(f.transactions, 0); denied = false;
    const opened = await PublicBusinessAnswerSession.open({ merchantId, purpose: "knowledge" }, deps); assert.equal(opened.status, "ready");
    if (opened.status !== "ready") assert.fail("entitled session required"); await opened.session.captureCanonical(sources());
    const entered = latch(), released = latch(), answering = opened.session.answer(async () => { entered.release(); await released.promise; return { message: "There is only one FAQ." }; },
      { kind: "public_text", safeReply: () => ({ message: "Please clarify with the team." }) });
    await entered.promise; f.state.faqs.push(faq("faqB")); released.release(); const result = await answering;
    assert.equal(result.status, "insufficient"); assert.equal(result.reply.message, "Please clarify with the team."); assert.deepEqual(result.evidence, []);
    const g = fixture(); g.state.faqs = Array.from({ length: 25 }, (_, i) => faq("faq" + String(i).padStart(2, "0")));
    const bounded = await PublicBusinessAnswerSession.open({ merchantId, purpose: "knowledge" }, { ...deps, canonical: g.reader as unknown as SessionDependencies["canonical"] });
    if (bounded.status !== "ready") assert.fail("entitled session required"); await bounded.session.captureCanonical(sources());
    assert.equal(bounded.session.evidenceCount, 20); await bounded.session.captureCanonical(pairRequest()); assert.equal(bounded.session.evidenceCount, 20);
    assert.equal(billing, 3);
  });
});

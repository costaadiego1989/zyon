import assert from "node:assert/strict";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { Redis } from "ioredis";
import { createDisposablePostgres } from "./local-disposable-postgres.mjs";
import { bootstrapServiceSchema } from "./service-migration-bootstrap.mjs";
import { createServiceTestRedis } from "./service-test-redis.mjs";
import { assertServiceArtifacts } from "./service-test-artifacts.mjs";
import { SERVICE_LOCAL_TEST_MS } from "./service-test-startup.mjs";
import { seedServiceBookingFixture, serviceBookingRequest } from "./service-booking-fixtures.js";
import { TenantContextService } from "../src/shared/tenant/tenant-context.service.js";
import { registerTenantMiddleware } from "../src/shared/persistence/tenant.middleware.js";
import { RedisServiceSlots } from "../src/shared/bookings/redis-service-slots.js";
import { admitServiceAppointment } from "../src/shared/bookings/service-appointment-admission.service.js";
import { BillingPlanMeteringService } from "../src/modules/payment/domain/billing-plan-guard.js";
import { PrismaCanonicalPublicSnapshotReader } from "../src/modules/knowledge-base/infrastructure/prisma-canonical-public-snapshot-reader.js";
import { PublicBusinessAnswerSession } from "../src/modules/knowledge-base/application/services/public-business-answer-session.js";
import { PrismaCurrentServiceFactsReader } from "../src/modules/knowledge-base/infrastructure/prisma-current-service-facts-reader.js";
import { PrismaPublicEvidenceSources } from "../src/modules/knowledge-base/infrastructure/prisma-public-evidence.sources.js";
import { RevalidatePublicSourceService } from "../src/modules/knowledge-base/application/use-cases/revalidate-public-source.service.js";
import { PublicBusinessLiveTools, renderPublicBusinessLiveFacts } from "../src/modules/knowledge-base/application/services/public-business-live-tools.js";

// Actual canonical SQL and Redis composition. No LLM quality, served AppModule
// transport or provider delivery claim is made by this read-only boundary test.
test("T71 actual canonical composition and live service facts", { timeout: SERVICE_LOCAL_TEST_MS }, async t => {
  assertServiceArtifacts();
  const db = await createDisposablePostgres({ transport: "loopback-exec" });
  let redisOwner: Awaited<ReturnType<typeof createServiceTestRedis>> | undefined;
  let redis: Redis | undefined, prisma: PrismaClient | undefined;
  try {
    await db.sql(`CREATE TABLE synthetic_native_marker(run_id TEXT PRIMARY KEY); INSERT INTO synthetic_native_marker VALUES ('${db.runId}');`);
    await bootstrapServiceSchema(db);
    redisOwner = await createServiceTestRedis();
    redis = new Redis(redisOwner.url, { lazyConnect: true, maxRetriesPerRequest: 1,
      commandTimeout: 3000, connectTimeout: 3000, enableOfflineQueue: false });
    await redis.connect();
    assert.equal(await redis.get("aacp:synthetic:run"), redisOwner.runId);
    const store = new RedisServiceSlots(redis), raw = prisma = new PrismaClient({ datasources: { db: { url: db.prismaUrl } } });
    const now = new Date(), merchantId = "booking-services";
    await seedServiceBookingFixture(raw, now);
    await raw.merchant.update({ where: { id: merchantId }, data: { storeSettings: {
      company: { description: "Published consulting company", serviceNames: ["Published consultation"] },
      businessHours: [{ day: "Monday", startTime: "09:00", endTime: "18:00", closed: false }],
    } } });
    await raw.supportSetting.create({ data: { merchantId, faqItems: [
      { id: "facts", question: "What is offered?", answer: "Published consulting information." },
    ] } });
    await raw.merchantPolicy.create({ data: { merchantId, general: "Published current policy." } });
    await raw.merchantBillingSubscription.create({ data: { merchantId, planKey: "growth", status: "active" } });
    const tenant = new TenantContextService(), scoped = registerTenantMiddleware(raw, tenant);
    const sources = new PrismaPublicEvidenceSources(scoped, tenant);
    const canonical = new PrismaCanonicalPublicSnapshotReader(scoped, tenant);
    const live = new PrismaCurrentServiceFactsReader(scoped, tenant, () => store, () => now);
    const deps = { scope: sources, canonical, billing: new BillingPlanMeteringService(scoped, raw),
      publicSources: new RevalidatePublicSourceService(sources) };
    const as = <T>(work: () => T) => tenant.run({ merchantId, role: "system", userId: "synthetic-t71-reader" }, work);
    const safe = (status: string) => ({ message: "safe:" + status });
    const open = async (sourceTypes?: Array<"company" | "business_hours" | "faq" | "policy" | "service" | "professional">) => as(async () => {
      const opened = await PublicBusinessAnswerSession.open({ merchantId, purpose: "knowledge" }, deps);
      assert.equal(opened.status, "ready"); if (opened.status !== "ready") assert.fail("session_required");
      assert.equal((await opened.session.captureCanonical({ merchantId, mode: "sources", limit: 20,
        ...(sourceTypes ? { sourceTypes } : {}) })).status, "ready");
      return opened.session;
    });
    const dateAt = (days: number) => new Date(now.getTime() + days * 86_400_000).toISOString().slice(0, 10);
    const choice = (days: number) => ({ productId: "booking-short", variantId: "booking-short-variant",
      professionalId: "booking-professional", fromDate: dateAt(days), toDate: dateAt(days) });
    const liveSession = async (days: number, holdOwnerId?: string) => as(async () => {
      const opened = await PublicBusinessAnswerSession.open({ merchantId, purpose: "knowledge" }, deps);
      assert.equal(opened.status, "ready"); if (opened.status !== "ready") assert.fail("session_required");
      assert.equal((await opened.session.captureCanonical({ merchantId, mode: "service_professional", limit: 20,
        pairs: [{ serviceId: "booking-short", professionalId: "booking-professional" }] })).status, "ready");
      opened.session.attachLive(choice(days), input => live.read(input, { merchantId,
        ...(holdOwnerId ? { holdOwnerId } : {}) }));
      return opened.session;
    });
    const renderLive = (values: ReadonlyArray<Awaited<ReturnType<PrismaCurrentServiceFactsReader["read"]>>>) => ({
      message: JSON.stringify(values.map(value => ({ price: value.facts.priceInCents,
        slots: value.availability.slots.map(slot => slot.startsAt) }))),
    });
    const unchangedMoney = async () => ({ payments: await raw.paymentIntent.count(), orders: await raw.completedOrder.count(),
      inventory: await raw.inventoryMovement.count() });
    const beforeMoney = await unchangedMoney();

    await t.test("cold unindexed canonical retrieval admits all six current public families without fake vector provenance", async () => {
      const session = await open();
      const result = await as(() => session.answer(async () => ({ message: "Published facts only" }), { kind: "public_text", safeReply: safe }));
      assert.equal(result.status, "ready");
      assert.deepEqual([...new Set(result.evidence.map(item => item.provenance.sourceType))].sort(),
        ["business_hours", "company", "faq", "policy", "professional", "service"]);
      assert.ok(result.evidence.every(item => item.provenance.origin === "canonical_sql" && item.provenance.publicWorkVersion === null
        && item.provenance.embeddingModel === null && item.provenance.embeddingDimensions === null));
      assert.equal(await raw.knowledgeChunk.count(), 0);
      assert.equal(await raw.publicSourceWork.count(), 0);
    });
    await t.test("public source mutation during the last producer await discards the old answer", async () => {
      const session = await open(["policy"]);
      const result = await as(() => session.answer(async () => {
        await raw.merchantPolicy.update({ where: { merchantId }, data: { general: "Changed public policy." } });
        return { message: "OLD_POLICY_MUST_NOT_ESCAPE" };
      }, { kind: "public_text", safeReply: safe }));
      assert.equal(result.status, "insufficient"); assert.equal(result.reply.message, "safe:insufficient");
      assert.deepEqual(result.evidence, []);
    });
    await t.test("a new FAQ during the producer invalidates original completeness even when original text is unchanged", async () => {
      const session = await open(["faq"]);
      const result = await as(() => session.answer(async () => {
        await raw.supportSetting.update({ where: { merchantId }, data: { faqItems: [
          { id: "facts", question: "What is offered?", answer: "Published consulting information." },
          { id: "new-facts", question: "New published question", answer: "New published answer" },
        ] } });
        return { message: "There is only one FAQ" };
      }, { kind: "public_text", safeReply: safe }));
      assert.equal(result.status, "insufficient"); assert.equal(result.reply.message, "safe:insufficient");
    });
    await t.test("private configuration churn preserves the public selection", async () => {
      const session = await open(["company"]);
      const result = await as(() => session.answer(async () => {
        const row = await raw.merchant.findUniqueOrThrow({ where: { id: merchantId } });
        await raw.merchant.update({ where: { id: merchantId }, data: { storeSettings: {
          ...(row.storeSettings as Record<string, unknown>), privateSyntheticCanary: "NEVER_PUBLIC_T71",
        } } });
        return { message: "Published consulting company" };
      }, { kind: "public_text", safeReply: safe }));
      assert.equal(result.status, "ready"); assert.equal(JSON.stringify(result).includes("NEVER_PUBLIC_T71"), false);
    });
    await t.test("canonical SQL failure after generation refuses the old factual reply", async () => {
      const session = await open(["policy"]);
      let renamed = false;
      try {
        const result = await as(() => session.answer(async () => {
          await db.sql("ALTER TABLE merchant_policies RENAME TO synthetic_t71_unavailable_policies");
          renamed = true;
          return { message: "OLD_POLICY_DURING_OUTAGE" };
        }, { kind: "public_text", safeReply: safe }));
        assert.equal(result.status, "unavailable"); assert.equal(result.reply.message, "safe:unavailable");
        assert.deepEqual(result.evidence, []);
      } finally {
        if (renamed) await db.sql("ALTER TABLE synthetic_t71_unavailable_policies RENAME TO merchant_policies");
      }
    });
    await t.test("the actual plan gate denies general retrieval before a canonical session is issued", async () => {
      await raw.merchantBillingSubscription.update({ where: { merchantId }, data: { planKey: "starter" } });
      try { assert.deepEqual(await as(() => PublicBusinessAnswerSession.open({ merchantId, purpose: "knowledge" }, deps)),
        { status: "unavailable", reason: "knowledge_base_denied" }); }
      finally { await raw.merchantBillingSubscription.update({ where: { merchantId }, data: { planKey: "growth" } }); }
    });
    await t.test("current price replaces all generated live text after the last producer await", async () => {
      const session = await liveSession(2);
      const result = await as(() => session.answer(async () => {
        await raw.productPrice.update({ where: { variantId: "booking-short-variant" }, data: { basePriceInCents: 6100 } });
        return { message: "FAKE_PRICE_1_AND_FREE_SLOT" };
      }, { kind: "live_facts", safeReply: safe, renderLive }));
      assert.equal(result.status, "ready"); assert.equal(JSON.parse(result.reply.message)[0].price, 6100);
      assert.equal(result.reply.message.includes("FAKE_PRICE"), false);
      await raw.productPrice.update({ where: { variantId: "booking-short-variant" }, data: { basePriceInCents: 5000 } });
    });
    await t.test("an actual confirmed admission after selection occupies capacity in the final read", async () => {
      const session = await liveSession(3), request = serviceBookingRequest(dateAt(3), "t71-confirmed-after-selection");
      const result = await as(() => session.answer(async () => {
        await raw.$transaction(tx => admitServiceAppointment(tx, request, { clock: () => now }));
        return { message: "OLD_VACANCY" };
      }, { kind: "live_facts", safeReply: safe, renderLive }));
      assert.equal(result.status, "ready");
      assert.equal(JSON.parse(result.reply.message)[0].slots.includes(request.startsAt), false);
      assert.equal((await raw.serviceAppointment.findUniqueOrThrow({ where: { merchantId_idempotencyKey: {
        merchantId, idempotencyKey: request.idempotencyKey,
      } } })).operationalStatus, "scheduled");
    });
    await t.test("a real provisional foreign hold after selection is excluded from final availability", async () => {
      await raw.serviceBusinessPolicy.update({ where: { merchantId }, data: { holdEnabled: true, holdMinutes: 10 } });
      const session = await liveSession(4), startsAt = dateAt(4) + "T10:00:00.000Z";
      const result = await as(() => session.answer(async () => {
        await store.acquire(merchantId, "t71-foreign-holder", [{ resourceId: "professional:booking-professional", slotId: "synthetic-t71-held",
          startsAt, endsAt: dateAt(4) + "T10:20:00.000Z" }]);
        return { message: "OLD_VACANCY" };
      }, { kind: "live_facts", safeReply: safe, renderLive }));
      assert.equal(result.status, "ready"); assert.equal(JSON.parse(result.reply.message)[0].slots.includes(startsAt), false);
      const own = await as(() => live.read(choice(4), { merchantId, holdOwnerId: "t71-foreign-holder" }));
      assert.ok(own.availability.slots.some(slot => slot.startsAt === startsAt));
      assert.equal(JSON.stringify(own).includes("t71-foreign-holder"), false);
      await store.release(merchantId, "t71-foreign-holder");
    });
    await t.test("disabling provisional holds does not read Redis and confirmed capacity remains occupied", async () => {
      await raw.serviceBusinessPolicy.update({ where: { merchantId }, data: { holdEnabled: false } });
      const noRedis = new PrismaCurrentServiceFactsReader(scoped, tenant, () => assert.fail("disabled_holds_must_not_read_redis"), () => now);
      const result = await as(() => noRedis.read(choice(3), { merchantId }));
      assert.equal(result.availability.slots.some(slot => slot.startsAt === dateAt(3) + "T10:00:00.000Z"), false);
    });
    await t.test("a withdrawn canonical relationship cannot reuse the old live choice", async () => {
      const session = await liveSession(5);
      const result = await as(() => session.answer(async () => {
        await raw.professionalService.updateMany({ where: { merchantId, productId: "booking-short" }, data: { isActive: false } });
        return { message: "WITHDRAWN_SERVICE" };
      }, { kind: "live_facts", safeReply: safe, renderLive }));
      assert.equal(result.status, "unavailable"); assert.equal(result.reply.message, "safe:unavailable");
      await raw.professionalService.updateMany({ where: { merchantId, productId: "booking-short" }, data: { isActive: true } });
    });
    await t.test("foreign ambient scope is denied for both canonical and live reads", async () => {
      await assert.rejects(tenant.run({ merchantId: "booking-foreign", role: "system" }, () => canonical.read({ merchantId, mode: "sources", limit: 20 })), /scope_mismatch/);
      await assert.rejects(tenant.run({ merchantId: "booking-foreign", role: "system" }, () => live.read(choice(2), { merchantId })), /scope_mismatch/);
    });
    await t.test("professional decisions use the explicit human route without producer text", async () => {
      const session = await open(["professional"]);
      const result = as(() => session.referProfessional(() => ({ message: "A equipe profissional deve avaliar sua situação individual." })));
      assert.equal(result.route, "human_required"); assert.equal(result.reason, "professional_decision");
      assert.deepEqual(result.evidence, []);
    });
    await t.test("an unavailable real Redis read cannot produce fictional free availability", async () => {
      await raw.serviceBusinessPolicy.update({ where: { merchantId }, data: { holdEnabled: true, holdMinutes: 10 } });
      const dead = new Redis(redisOwner!.url, { lazyConnect: true, maxRetriesPerRequest: 1,
        commandTimeout: 3000, connectTimeout: 3000, enableOfflineQueue: false });
      try {
        await dead.connect(); assert.equal(await dead.get("aacp:synthetic:run"), redisOwner!.runId);
        await dead.quit(); dead.disconnect();
        const unavailable = new PrismaCurrentServiceFactsReader(scoped, tenant, () => new RedisServiceSlots(dead), () => now);
        const opened = await as(() => PublicBusinessAnswerSession.open({ merchantId, purpose: "knowledge" }, deps));
        assert.equal(opened.status, "ready"); if (opened.status !== "ready") assert.fail("session_required");
        const session = opened.session;
        await as(() => session.captureCanonical({ merchantId, mode: "service_professional", limit: 20,
          pairs: [{ serviceId: "booking-short", professionalId: "booking-professional" }] }));
        as(() => session.attachLive(choice(6), input => unavailable.read(input, { merchantId })));
        const result = await as(() => session.answer(async () => ({ message: "FAKE_FREE_SLOTS" }),
          { kind: "live_facts", safeReply: safe, renderLive }));
        assert.equal(result.status, "unavailable"); assert.equal(result.reply.message, "safe:unavailable");
        assert.deepEqual(result.evidence, []);
      } finally { dead.disconnect(); }
    });
    await t.test("read composition creates no payment, order or inventory effect", async () => {
      assert.deepEqual(await unchangedMoney(), beforeMoney);
      assert.equal(await raw.serviceAppointment.count(), 1);
    });
    await t.test("the actual bounded live tool resolves a unique variant and renders current SQL labels and price", async () => {
      const session = await open(["company"]), tools = new PublicBusinessLiveTools(scoped, tenant, live, () => now);
      const { variantId: _variant, ...request } = choice(7);
      assert.deepEqual(await as(() => tools.attach(session, { merchantId, request })), { status: "attached" });
      const result = await as(() => session.answer(async () => ({ message: "MODEL_PRICE_AND_SLOT_MUST_BE_DISCARDED" }),
        { kind: "live_facts", safeReply: safe, renderLive: values => renderPublicBusinessLiveFacts(values) }));
      assert.equal(result.status, "ready"); assert.match(result.reply.message, /Synthetic booking-short/);
      assert.match(result.reply.message, /Synthetic professional/); assert.match(result.reply.message, /50,00/);
      assert.equal(result.reply.message.includes("MODEL_PRICE_AND_SLOT"), false);
    });
    await t.test("an actual second active variant asks for a choice and does not register live authority", async () => {
      const variant = await raw.productVariant.create({ data: { productId: "booking-short", sku: "synthetic-t71-extra",
        price: { create: { basePriceInCents: 7000, currency: "BRL" } } } });
      try {
        const session = await open(["company"]), tools = new PublicBusinessLiveTools(scoped, tenant, live, () => now);
        const { variantId: _variant, ...request } = choice(8);
        assert.deepEqual(await as(() => tools.attach(session, { merchantId, request })), { status: "clarification", reason: "variant_required" });
        const result = await as(() => session.answer(async () => assert.fail("no confirmed live selection may reach a producer"),
          { kind: "live_facts", safeReply: safe, renderLive: values => renderPublicBusinessLiveFacts(values) }));
        assert.equal(result.status, "insufficient"); assert.equal(result.reason, "missing_live_authority");
        assert.equal(await raw.serviceAppointment.count(), 1);
      } finally { await raw.productVariant.delete({ where: { id: variant.id } }); }
    });
    assert.deepEqual(await unchangedMoney(), beforeMoney);
  } finally {
    const errors: unknown[] = [];
    try { if (prisma) await prisma.$disconnect(); } catch (error) { errors.push(error); }
    try { if (redis) { try { await redis.quit(); } finally { redis.disconnect(); } } } catch (error) { errors.push(error); }
    try { if (redisOwner) await redisOwner.dispose(); } catch (error) { errors.push(error); }
    try { await db.dispose(); assert.deepEqual(db.bridgeStatus(), { listening: false, sockets: 0, children: 0 }); } catch (error) { errors.push(error); }
    if (errors.length) throw new AggregateError(errors, "t71_owned_composition_cleanup_failed");
  }
});

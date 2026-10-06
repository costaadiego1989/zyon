import "reflect-metadata";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { PrismaClient } from "@prisma/client";
import { RedisServiceSlots, closeServiceSlotStore, slotFingerprint, type SlotRequest } from "./redis-service-slots.js";
import { ServiceSlotHoldsService } from "./service-slot-holds.service.js";
import { ServiceSlotHoldLifecycle } from "./service-slot-holds.module.js";
import { checkoutSession } from "../../modules/checkout/__tests__/checkout-test-fixtures.js";
import { resolveSelectedServiceSlot } from "../../modules/catalog/domain/services/service-schedule.js";
import { reserveService } from "../persistence/order-fulfillment.js";
import { initialFulfillment, snapshotOrderLines } from "../../modules/operations/domain/order-fulfillment.js";
import { ResumePaymentCreationService } from "../../modules/payment/application/resume-payment-creation.service.js";
import { PaymentIntentEntity } from "../../modules/payment/domain/payment-intent.entity.js";
import { InMemoryPaymentRepository } from "../../modules/payment/infrastructure/in-memory-payment.repository.js";

const databaseUrl = process.env.FULFILLMENT_QA_DATABASE_URL;
describe("temporary service holds with real Redis and PostgreSQL", { skip: !databaseUrl || !process.env.REDIS_URL }, () => {
  const merchantId = `qa_slot_${randomUUID()}`;
  let prisma: PrismaClient, redis: Redis, store: RedisServiceSlots, service: ServiceSlotHoldsService;
  const date = new Date(Date.now() + 3 * 86400_000).toISOString().slice(0, 10);
  const metadata = { serviceSchedule: { timeZone: "UTC", durationMinutes: 60, slots: [{ id: "first", date, startTime: "09:00" }, { id: "next", date, startTime: "10:00" }] } };
  let resourceId: string;
  const sessions: string[] = [];
  before(async () => {
    assert.equal(new URL(databaseUrl!).hostname, "127.0.0.1");
    assert.equal(new URL(databaseUrl!).pathname, "/zyon_fulfillment_qa");
    assert.equal(new URL(process.env.REDIS_URL!).hostname, "127.0.0.1");
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    redis = new Redis(process.env.REDIS_URL!, { lazyConnect: true }); await redis.connect();
    store = new RedisServiceSlots(redis); service = new ServiceSlotHoldsService(prisma, store);
    await prisma.merchant.create({ data: { id: merchantId, name: "Temporary slots QA" } });
    const product = await prisma.product.create({ data: { merchantId, name: "Service QA", type: "service", metadata, variants: { create: { sku: "SLOT-QA" } } }, include: { variants: true } });
    resourceId = product.variants[0]!.id;
  });
  after(async () => {
    if (!prisma) return;
    for (const id of sessions) await store.release(merchantId, id);
    const keys = await redis.keys(store.resourceKey(merchantId, resourceId).replace(/:holds$/, ":*"));
    if (keys.length) await redis.del(...keys);
    await prisma.checkoutSession.deleteMany({ where: { merchantId } });
    await prisma.paymentIntent.deleteMany({ where: { merchantId } });
    await prisma.product.deleteMany({ where: { merchantId } });
    await prisma.merchant.delete({ where: { id: merchantId } });
    await prisma.$disconnect(); redis.disconnect(); closeServiceSlotStore();
  });
  async function session(slotId = "first") {
    const selected = resolveSelectedServiceSlot(metadata, slotId)!;
    const value = checkoutSession({ merchantId, sessionId: randomUUID(), cart: { currency: "BRL", total: 99, items: [{ sku: "SLOT-QA", variantId: resourceId, name: "Service QA", price: 99, quantity: 1, productType: "service", fulfillmentStrategy: "scheduled_service", fulfillmentSchedule: selected }] } });
    const { shipping, ...persisted } = value;
    await prisma.checkoutSession.create({ data: { merchantId, sessionId: value.sessionId, globalUserId: "qa", conversationId: value.sessionId, cart: value.cart as any, createdAt: new Date(), updatedAt: new Date() } });
    sessions.push(value.sessionId); return persisted;
  }
  const requests = (value: Awaited<ReturnType<typeof session>>): SlotRequest[] => value.cart.items.map(i => ({ resourceId: i.variantId!, slotId: i.fulfillmentSchedule!.slotId, startsAt: i.fulfillmentSchedule!.startsAt, endsAt: i.fulfillmentSchedule!.endsAt }));
  it("admits exactly one concurrent checkout and keeps the winner deadline on retry", async () => {
    const a = await session(), b = await session();
    const results = await Promise.allSettled([service.acquire(a), service.acquire(b)]);
    assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
    const index = results.findIndex(r => r.status === "fulfilled"), winner = index === 0 ? a : b;
    const result = results[index]; assert.equal(result.status, "fulfilled");
    assert.deepEqual(await service.acquire(winner), (result as PromiseFulfilledResult<any>).value);
    const schedule = await service.availability(merchantId, resourceId, metadata);
    assert.equal(schedule!.slots[0]!.selectable, false); assert.equal(schedule!.slots[1]!.selectable, true);
    const key = store.resourceKey(merchantId, resourceId).replace(/:holds$/, ":schedule");
    assert.equal(JSON.parse((await redis.get(key))!).slots[0].selectable, false);
    await service.assertBeforePayment(winner); await service.release(merchantId, winner.sessionId);
    assert.equal((await service.availability(merchantId, resourceId, metadata))!.slots[0]!.selectable, true);
  });
  it("atomically rejects multiple resources without retaining a partial hold", async () => {
    const a = await session(), b = await session();
    await service.acquire(a);
    const other = { ...requests(b)[0]!, resourceId: `uncontested_${randomUUID()}` };
    await assert.rejects(store.acquire(merchantId, b.sessionId, [other, ...requests(b)]), /service_slot_unavailable/);
    assert.equal((await store.active(merchantId, other.resourceId)).length, 0);
    assert.equal(await store.get(merchantId, b.sessionId), undefined);
    await service.release(merchantId, a.sessionId);
  });
  it("expires automatically, refuses a fresh provider dispatch and permits another buyer", async () => {
    const a = await session(), b = await session();
    await store.acquire(merchantId, a.sessionId, requests(a), 30);
    await new Promise(resolve => setTimeout(resolve, 55));
    await assert.rejects(service.assertBeforePayment(a), /checkout_service_hold_expired/);
    let dispatches = 0;
    const intent = PaymentIntentEntity.create({ merchantId, sessionId: a.sessionId, method: "pix", amountCents: 9900, currency: "BRL", idempotencyKey: "expired" });
    intent.prepareCreation({ merchantId, sessionId: a.sessionId, intentId: intent.id, method: "pix", amountCents: 9900, currency: "BRL", provider: "asaas", providerAccountFingerprint: "qa", settlementMode: "immediate_split" });
    const repo = new InMemoryPaymentRepository(); await repo.saveIntent({ intent });
    const resume = new ResumePaymentCreationService(repo, { createPayment: async () => { dispatches++; throw new Error("unexpected dispatch"); } }, service, { getSession: async () => a } as never);
    await assert.rejects(resume.execute(intent), /checkout_service_hold_expired/);
    assert.equal(dispatches, 0); assert.equal(intent.snapshot().creation!.firstAttemptAt, undefined);
    await service.acquire(b); await service.release(merchantId, b.sessionId);
  });
  it("does not let an old cart event release the buyer's replacement choice", async () => {
    const a = await session(), next = requests(a).map(s => ({ ...s, slotId: "next", startsAt: `${date}T10:00:00.000Z`, endsAt: `${date}T11:00:00.000Z` }));
    await store.acquire(merchantId, a.sessionId, requests(a));
    await store.release(merchantId, a.sessionId); await store.acquire(merchantId, a.sessionId, next);
    await store.release(merchantId, a.sessionId, slotFingerprint(requests(a)));
    await store.assertActive(merchantId, a.sessionId, next); await store.release(merchantId, a.sessionId);
  });
  it("rejects changed catalog times and forged session snapshots before payment", async () => {
    const a = await session(); await service.acquire(a);
    const forged = structuredClone(a); forged.cart.items[0]!.fulfillmentSchedule!.endsAt = `${date}T11:00:00.000Z`;
    await assert.rejects(service.acquire(forged), /checkout_service_slot_changed/);
    const variant = await prisma.productVariant.findUniqueOrThrow({ where: { id: resourceId } });
    await prisma.product.update({ where: { id: variant.productId }, data: { metadata: { serviceSchedule: { ...metadata.serviceSchedule, durationMinutes: 30 } } } });
    await assert.rejects(service.assertBeforePayment(a), /checkout_service_slot_changed/);
    await prisma.product.update({ where: { id: variant.productId }, data: { metadata } }); await service.release(merchantId, a.sessionId);
  });
  it("isolates merchants and fails closed if any Redis lease record is lost", async () => {
    const a = await session(); await service.acquire(a);
    const otherMerchant = `other_${merchantId}`;
    await store.acquire(otherMerchant, a.sessionId, requests(a));
    await redis.del(store.resourceKey(merchantId, resourceId));
    await assert.rejects(service.assertBeforePayment(a), /checkout_service_hold_expired/);
    await assert.rejects(service.acquire(a), /service_slot_unavailable/);
    await store.release(merchantId, a.sessionId); await store.release(otherMerchant, a.sessionId);
  });
  it("domain cart cancellation releases immediately and failed payment needs persisted proof", async () => {
    const callbacks = new Map<string, (event: any) => Promise<void>>();
    const lifecycle = new ServiceSlotHoldLifecycle({ subscribe: (type: string, handle: any) => callbacks.set(type, handle) } as never, prisma, service); lifecycle.onModuleInit();
    const a = await session(); await service.acquire(a);
    await callbacks.get("payment.status.changed")!({ eventType: "payment.status.changed", merchantId, payload: { session_id: a.sessionId, payment_intent_id: "nonexistent", status: "failed" } });
    await service.assertBeforePayment(a);
    const payment = await prisma.paymentIntent.create({ data: { id: randomUUID(), merchantId, sessionId: a.sessionId, idempotencyKey: randomUUID(), amountCents: 9900, currency: "BRL", method: "pix", status: "failed", createdAt: new Date(), updatedAt: new Date() } });
    await callbacks.get("payment.status.changed")!({ eventType: "payment.status.changed", merchantId, payload: { session_id: a.sessionId, payment_intent_id: payment.id, status: "failed" } });
    assert.equal(await service.get(a), undefined); await service.acquire(a);
    await prisma.checkoutSession.update({ where: { merchantId_sessionId: { merchantId, sessionId: a.sessionId } }, data: { cart: { ...a.cart, items: [], total: 0 } as any } });
    await callbacks.get("checkout.cart.updated")!({ eventType: "checkout.cart.updated", merchantId, payload: { session_id: a.sessionId, previous_service_slots: requests(a) } });
    assert.equal(await service.get(a), undefined);
  });
  it("releases a cart lease after the lifecycle event passes through PostgreSQL JSONB", async () => {
    const callbacks = new Map<string, (event: any) => Promise<void>>();
    const lifecycle = new ServiceSlotHoldLifecycle({ subscribe: (type: string, handle: any) => callbacks.set(type, handle) } as never, prisma, service);
    lifecycle.onModuleInit();
    const a = await session(); await service.acquire(a);
    const payload = { session_id: a.sessionId, previous_service_slots: requests(a) };
    const [{ persisted }] = await prisma.$queryRaw<Array<{ persisted: typeof payload }>>`
      SELECT ${JSON.stringify(payload)}::jsonb AS persisted`;
    assert.notDeepEqual(Object.keys(persisted.previous_service_slots[0]!), Object.keys(payload.previous_service_slots[0]!));
    assert.equal(slotFingerprint(persisted.previous_service_slots), slotFingerprint(requests(a)));
    await prisma.checkoutSession.update({ where: { merchantId_sessionId: { merchantId, sessionId: a.sessionId } }, data: { cart: { ...a.cart, items: [], total: 0 } as any } });
    await callbacks.get("checkout.cart.updated")!({ eventType: "checkout.cart.updated", merchantId, payload: persisted });
    assert.equal(await service.get(a), undefined);
    assert.equal((await service.availability(merchantId, resourceId, metadata))!.slots.find(slot => slot.slotId === "first")!.selectable, true);
  });
  it("lease deadline never extends past the appointment start", async () => {
    const id = randomUUID(); sessions.push(id);
    const soon = { resourceId, slotId: "near", startsAt: new Date(Date.now() + 200).toISOString(), endsAt: new Date(Date.now() + 60000).toISOString() };
    const hold = await store.acquire(merchantId, id, [soon]); assert.equal(hold.expiresAt, soon.startsAt);
    await store.release(merchantId, id);
  });
  it("blocks a late paid order from taking another buyer's lease, then keeps durable booking after lease removal", async () => {
    const late = await session(), buyer = await session(); await service.acquire(buyer);
    const order = await prisma.completedOrder.create({ data: { merchantId, sessionId: late.sessionId, externalOrderId: randomUUID(), orderTotal: 99, currency: "BRL", completedAt: new Date() } });
    const unit = initialFulfillment(snapshotOrderLines(late.cart.items))!.units[0]!;
    await assert.rejects(prisma.$transaction(tx => reserveService(tx, order, unit)), /service_capacity_unavailable/);
    assert.equal(await prisma.serviceReservation.count({ where: { merchantId, orderId: order.id } }), 0);
    await service.release(merchantId, buyer.sessionId);
    await prisma.$transaction(tx => reserveService(tx, order, unit));
    await assert.rejects(service.acquire(buyer), /service_slot_unavailable/);
    assert.equal((await service.availability(merchantId, resourceId, metadata))!.slots[0]!.selectable, false);
  });
  it("physical, food, digital and unscheduled service checkout work without a Redis lease", async () => {
    for (const productType of ["physical", "food", "digital", "service"] as const) {
      const value = checkoutSession({ cart: { currency: "BRL", total: 1, items: [{ sku: "any", name: "Any", price: 1, quantity: 1, productType, fulfillmentStrategy: productType === "service" ? "service" : productType === "digital" ? "digital" : "pickup" }] } });
      const noResources = new ServiceSlotHoldsService({} as never, new RedisServiceSlots({} as never));
      assert.equal(await noResources.acquire(value), undefined); await noResources.assertBeforePayment(value);
    }
  });
});

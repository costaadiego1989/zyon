import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { setTimeout as pause } from 'node:timers/promises';
import { assertNativePrismaUrl, inspectNativePrismaClient } from './native-prisma-admission-guards.mjs';

const args = process.argv.slice(2), [url, runId] = args;
assert.equal(args.length, 2);
const parsed = assertNativePrismaUrl(url);
assert.match(runId, /^[a-f0-9-]{36}$/);
assert.equal(parsed.searchParams.get('application_name'), `aacp_write_native_${runId}`);
for (const key of ['DATABASE_URL', 'DIRECT_URL', 'NODE_OPTIONS', 'DOTENV_CONFIG_PATH', 'PRISMA_QUERY_ENGINE_LIBRARY', 'READY_PROD_TEST_PRISMA_CLIENT'])
  assert.equal(process.env[key], undefined, 'native_redemption_environment_not_clean');
inspectNativePrismaClient(fileURLToPath(new URL('../', import.meta.url)));
const { PrismaClient } = await import('@prisma/client');
const { PrismaCouponTransactionRepository } = await import('../src/modules/coupons/infrastructure/repositories/prisma-coupon-transaction.repository.ts');
const { CouponEntity } = await import('../src/modules/coupons/domain/entities/coupon.entity.ts');
const { CouponRedemptionEntity } = await import('../src/modules/coupons/domain/entities/coupon-redemption.entity.ts');
const { createCouponEventEnvelope } = await import('../src/modules/coupons/domain/events/coupon-domain-event.ts');
const { RedeemCouponUseCase } = await import('../src/modules/coupons/application/use-cases/redeem-coupon.use-case.ts');
const { CouponsOnOrderCompletedHandler } = await import('../src/modules/coupons/infrastructure/event-handlers/on-order-completed.handler.ts');
const { PrismaOutboxRepository } = await import('../src/shared/messaging/infrastructure/prisma-outbox.repository.ts');
const { OutboxDispatcher } = await import('../src/shared/messaging/outbox-dispatcher.service.ts');
const { InMemoryDomainEventBus } = await import('../src/shared/events/in-memory-domain-event-bus.ts');
const { createCheckoutEventEnvelope } = await import('../src/modules/checkout/domain/events/checkout-domain-event.ts');
const prisma = new PrismaClient({ datasources: { db: { url } }, log: [], transactionOptions: { timeout: 30_000, maxWait: 15_000 } });
const merchantId = 'synthetic-redemption-merchant', sessionId = 'synthetic-redemption-session';
const transactions = new PrismaCouponTransactionRepository(prisma);
const useCase = new RedeemCouponUseCase(transactions);
let active = 'owned synthetic database', checks = 0, maxConcurrentWaitingTransactions = 0;
const check = async (name, work) => { active = name; await work(); checks++; console.log(JSON.stringify({ test: name, status: 'passed' })); };
const reset = async () => {
  await prisma.$executeRaw`TRUNCATE outbox_handler_executions,outbox_messages,coupon_redemptions,coupons,synthetic_redemption_faults CASCADE`;
};
const reserve = async (session = sessionId, code = 'SAVE10') => {
  let saved = await prisma.coupon.findUnique({ where: { merchantId_code: { merchantId, code } } });
  if (!saved) saved = await prisma.coupon.create({ data: { id: code === 'SAVE10' ? 'coupon-a' : 'coupon-b', merchantId, code,
    discountType: 'percent', discountValue: 10, maxUsages: 100, startsAt: new Date(0), updatedAt: new Date() } });
  const coupon = CouponEntity.rehydrate({ id: saved.id, merchant_id: merchantId, code, discount_type: 'percent', discount_value: 10,
    min_cart_total: null, max_usages: 100, max_per_buyer: null, allowed_skus: [], blocked_skus: [], allowed_regions: [], blocked_regions: [],
    status: 'active', starts_at: new Date(0).toISOString(), ends_at: null, usages_count: saved.usagesCount,
    created_at: saved.createdAt.toISOString(), updated_at: saved.updatedAt.toISOString() });
  const redemption = CouponRedemptionEntity.create({ coupon_id: coupon.id, merchant_id: merchantId, session_id: session,
    buyer_global_user_id: null, discount_applied: 10, source: 'manual' });
  const result = await transactions.reserve({ coupon: coupon.snapshot(), redemption,
    event: createCouponEventEnvelope({ eventType: 'coupon.applied', merchantId, payload: { session_id: session } }) });
  assert.equal(result.status, 'reserved');
  // A completed applied-event consumer is outside this test. Do not let the real
  // dispatcher confuse an unregistered applied consumer with the tested handler.
  await prisma.outboxMessage.updateMany({ where: { eventType: 'coupon.applied' }, data: { status: 'delivered' } });
  return { id: result.redemption_id, couponId: coupon.id };
};
const redeem = (session = sessionId, service = useCase) => service.execute({ merchant_id: merchantId, session_id: session, order_id: 'synthetic-order' });
const state = async () => ({
  rows: (await prisma.couponRedemption.findMany({ orderBy: { id: 'asc' } })).map(row => ({ id: row.id, status: row.status, orderId: row.orderId })),
  usages: (await prisma.coupon.findMany({ orderBy: { id: 'asc' } })).map(row => row.usagesCount),
  events: await prisma.outboxMessage.count({ where: { eventType: 'coupon.redeemed' } }),
});
const waitFor = async (query, expected) => {
  const until = Date.now() + 9000; let value;
  do { value = await query(); if (value === expected) return value; await pause(20); } while (Date.now() < until);
  assert.equal(value, expected, 'real_coupon_lock_waiters_required');
};
const blocked = async (competitors, whileLocked) => {
  let signalLocked, release;
  const locked = new Promise(resolve => { signalLocked = resolve; }), gate = new Promise(resolve => { release = resolve; });
  const holder = prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM coupons WHERE id='coupon-a' AND merchant_id=${merchantId} FOR UPDATE`;
    signalLocked(); await gate;
    if (whileLocked) await whileLocked(tx);
  });
  let workers = [];
  try {
    await Promise.race([locked, holder.then(() => { throw new Error('synthetic_coupon_holder_exited_before_gate'); })]);
    workers = Array.from({ length: competitors }, () => redeem());
    // Attach rejection observers immediately; all outcomes are asserted below.
    const complete = Promise.all(workers);
    void complete.catch(() => {});
    const count = await waitFor(async () => Number((await prisma.$queryRaw`SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE application_name=${`aacp_write_native_${runId}`} AND wait_event_type='Lock' AND state='active'
        AND query LIKE '%SELECT "id" FROM "coupons"%' AND query LIKE '%FOR UPDATE%'`)[0].n), competitors);
    maxConcurrentWaitingTransactions = Math.max(maxConcurrentWaitingTransactions, count);
    release(); await holder; await complete;
  } finally { release(); await Promise.allSettled([holder, ...workers]); }
};
const switchFault = async mode => prisma.$executeRaw`INSERT INTO synthetic_redemption_faults(session_id,mode) VALUES (${sessionId},${mode})`;
const setupDispatcher = async (service = useCase, recoveryOutbox = value => value) => {
  const outbox = new PrismaOutboxRepository(prisma), bus = new InMemoryDomainEventBus();
  new CouponsOnOrderCompletedHandler(bus, service, recoveryOutbox(outbox)).onModuleInit();
  bus.subscribe('coupon.redeemed', async () => {}, 'synthetic.redeemed.sink');
  const event = createCheckoutEventEnvelope({ eventType: 'order.completed', merchantId,
    payload: { session_id: sessionId, external_order_id: 'synthetic-order' }, causationId: 'synthetic-order' });
  await outbox.appendOutbox(event);
  return { outbox, bus, event, dispatcher: () => new OutboxDispatcher(outbox, bus, { concurrency: 1 }) };
};
const retryNow = async eventId => prisma.outboxMessage.update({ where: { eventId }, data: { nextAttemptAt: new Date(0) } });
const assertPending = async (setup, attempt) => {
  const row = await prisma.outboxMessage.findUniqueOrThrow({ where: { eventId: setup.event.event_id } });
  assert.equal(row.status, 'pending'); assert.equal(row.attempts, attempt); assert.equal(row.lastError, 'outbox_handler_failed');
  assert.equal(await setup.outbox.isHandlerProcessed(row.eventId, 'coupons.CouponsOnOrderCompletedHandler'), false);
};
const childFor = async setup => {
  const children = await prisma.outboxMessage.findMany({ where: { eventType: 'coupon.redemption.requested' } });
  assert.equal(children.length, 1, 'recovery must never enqueue recursively or duplicate the same commercial identity');
  const child = children[0];
  assert.equal(child.merchantId, merchantId);
  assert.deepEqual(child.payload, { session_id: sessionId, external_order_id: 'synthetic-order' });
  assert.equal(child.correlationId, setup.event.correlation_id); assert.equal(child.causationId, setup.event.event_id);
  return child;
};
const assertChildPending = async (setup, attempt) => {
  const child = await childFor(setup), registrations = setup.bus.handlersFor('coupon.redemption.requested');
  assert.equal(registrations.length, 1);
  assert.equal(child.status, 'pending'); assert.equal(child.attempts, attempt); assert.equal(child.lastError, 'outbox_handler_failed');
  assert.equal(await setup.outbox.isHandlerProcessed(child.eventId, registrations[0].handlerId), false);
  return child;
};
try {
  assert.equal((await prisma.$queryRaw`SELECT run_id FROM synthetic_native_marker`)[0]?.run_id, runId);
  await check('real reservation and direct checkout redemption persist once; same-order replay is inert', async () => {
    await reset(); await reserve(); await redeem(); const snapshot = await state();
    assert.equal(snapshot.rows[0].status, 'redeemed'); assert.equal(snapshot.rows[0].orderId, 'synthetic-order');
    assert.deepEqual(snapshot.usages, [1]); assert.equal(snapshot.events, 1);
    await redeem(); assert.deepEqual(await state(), snapshot);
  });
  await check('twenty genuine concurrent redeems wait on coupon and commit one usage and event', async () => {
    await reset(); await reserve(); await blocked(20);
    assert.deepEqual((await state()).usages, [1]); assert.equal((await state()).events, 1);
  });
  await check('snapshot changed while coupon lock is held is reread before the redeemed event', async () => {
    await reset(); await reserve();
    await blocked(1, tx => tx.$executeRaw`UPDATE coupon_redemptions SET discount_applied=7 WHERE merchant_id=${merchantId} AND session_id=${sessionId}`);
    const event = await prisma.outboxMessage.findFirstOrThrow({ where: { eventType: 'coupon.redeemed' } });
    assert.equal(event.payload.discount_applied, 7); assert.deepEqual((await state()).usages, [1]);
  });
  await check('multiple coupons and reverse reservation insertion orders redeem concurrently without double effects', async () => {
    await reset(); await reserve(sessionId, 'SAVE20'); await reserve(sessionId, 'SAVE10');
    await reserve('second-session', 'SAVE10'); await reserve('second-session', 'SAVE20');
    await Promise.all([redeem(), redeem('second-session'), redeem(), redeem('second-session')]);
    const snapshot = await state(); assert.deepEqual(snapshot.usages, [2, 2]); assert.equal(snapshot.events, 4);
    assert.ok(snapshot.rows.every(row => row.status === 'redeemed'));
  });
  for (const mode of ['outbox', 'commit']) await check(`real SQL ${mode} failure rolls back redemption, usage and emitted event`, async () => {
    await reset(); await reserve(); await switchFault(mode); const before = await state();
    await assert.rejects(redeem()); assert.deepEqual(await state(), before);
  });
  await check('foreign coupon behind a corrupted reservation is refused with no mutation', async () => {
    await reset(); await reserve();
    await prisma.coupon.update({ where: { id: 'coupon-a' }, data: { merchantId: 'foreign-merchant' } });
    const before = await state(); await assert.rejects(redeem(), /coupon_redemption_coupon_unavailable/);
    assert.deepEqual(await state(), before);
  });
  await check('durably queued coupon recovery does not block the following order handler', async () => {
    await reset(); await reserve(); await switchFault('outbox'); const setup = await setupDispatcher();
    let following = 0;
    setup.bus.subscribe('order.completed', async () => { following++; }, 'synthetic.following.order-handler');
    const dispatcher = setup.dispatcher(); await dispatcher.dispatch(); await dispatcher.onModuleDestroy();
    assert.equal(following, 1, 'secondary coupon failure must not block the following order consumer once recovery is durable');
    assert.equal(await setup.outbox.isProcessed(setup.event.event_id), true);
    await assertChildPending(setup, 1);
    assert.deepEqual((await state()).usages, [0]); assert.equal((await state()).events, 0);
  });
  await check('real dispatcher leaves coupon recovery pending and a new instance replays the child once', async () => {
    await reset(); await reserve(); await switchFault('outbox'); const setup = await setupDispatcher();
    const first = setup.dispatcher(); await first.dispatch(); await first.onModuleDestroy();
    const child = await assertChildPending(setup, 1);
    assert.equal(await setup.outbox.isProcessed(setup.event.event_id), true);
    assert.deepEqual((await state()).usages, [0]); assert.equal((await state()).events, 0);
    await prisma.$executeRaw`DELETE FROM synthetic_redemption_faults`; await retryNow(child.eventId);
    const second = setup.dispatcher(); await second.dispatch(); await second.onModuleDestroy();
    assert.equal(await setup.outbox.isProcessed(setup.event.event_id), true);
    assert.equal(await setup.outbox.isHandlerProcessed(setup.event.event_id, 'coupons.CouponsOnOrderCompletedHandler'), true);
    assert.equal(await setup.outbox.isProcessed(child.eventId), true);
    assert.deepEqual((await state()).usages, [1]); assert.equal((await state()).events, 1);
    const third = setup.dispatcher(); const before = await state(); await third.dispatch(); await third.onModuleDestroy();
    assert.deepEqual(await state(), before);
  });
  await check('lost acknowledgement after real redemption commit queues replay without blocking the order or duplicating effects', async () => {
    await reset(); await reserve(); let lost = true, realTransactions = 0;
    const uncertain = new Proxy(prisma, { get(target, property) {
      if (property === '$transaction') return async work => {
        realTransactions++; const value = await target.$transaction(work);
        if (lost) { lost = false; throw new Error('synthetic_ack_lost_after_real_commit'); } return value;
      };
      const value = Reflect.get(target, property); return typeof value === 'function' ? value.bind(target) : value;
    } });
    const service = new RedeemCouponUseCase(new PrismaCouponTransactionRepository(uncertain));
    const setup = await setupDispatcher(service), first = setup.dispatcher();
    await first.dispatch(); await first.onModuleDestroy();
    const child = await childFor(setup);
    assert.equal(realTransactions, 2); assert.equal(await setup.outbox.isProcessed(child.eventId), true);
    assert.equal(await setup.outbox.isProcessed(setup.event.event_id), true);
    assert.deepEqual((await state()).usages, [1]); assert.equal((await state()).events, 1);
    const second = setup.dispatcher(); await second.dispatch(); await second.onModuleDestroy();
    assert.equal(realTransactions, 2); assert.deepEqual((await state()).usages, [1]);
  });
  await check('recovery enqueue SQL failure cannot falsely acknowledge the parent order event', async () => {
    await reset(); await reserve(); await switchFault('enqueue'); const setup = await setupDispatcher();
    let following = 0; setup.bus.subscribe('order.completed', async () => { following++; }, 'synthetic.following.order-handler');
    const first = setup.dispatcher(); await first.dispatch(); await first.onModuleDestroy();
    await assertPending(setup, 1); assert.equal(following, 0);
    assert.equal(await prisma.outboxMessage.count({ where: { eventType: 'coupon.redemption.requested' } }), 0);
    assert.deepEqual((await state()).usages, [0]);
    await prisma.$executeRaw`UPDATE synthetic_redemption_faults SET mode='outbox'`;
    await retryNow(setup.event.event_id); const second = setup.dispatcher(); await second.dispatch(); await second.onModuleDestroy();
    assert.equal(following, 1); assert.equal(await setup.outbox.isProcessed(setup.event.event_id), true);
    await assertChildPending(setup, 1);
  });
  await check('twenty concurrent fallback invocations persist one recovery child under its stable identity', async () => {
    await reset(); await reserve(); await switchFault('outbox'); const setup = await setupDispatcher();
    // Direct concurrent handler calls test child upsert identity, NOT twenty
    // leased deliveries or external consumer execution.
    const event = { eventId: setup.event.event_id, eventType: 'order.completed', merchantId,
      correlationId: setup.event.correlation_id, payload: setup.event.payload };
    await Promise.all(Array.from({ length: 20 }, () => setup.bus.publish(event)));
    const child = await childFor(setup); assert.equal(child.attempts, 0); assert.equal(child.status, 'pending');
    assert.deepEqual((await state()).usages, [0]); assert.equal((await state()).events, 0);
    await prisma.$executeRaw`DELETE FROM synthetic_redemption_faults`;
    const dispatcher = setup.dispatcher(); await dispatcher.dispatch(); await dispatcher.onModuleDestroy();
    assert.deepEqual((await state()).usages, [1]); assert.equal((await state()).events, 1);
    assert.equal(await setup.outbox.isProcessed(child.eventId), true);
  });
  await check('lost acknowledgement after real recovery enqueue persists one child across parent redelivery', async () => {
    await reset(); await reserve(); await switchFault('outbox'); let lost = true;
    const setup = await setupDispatcher(useCase, outbox => ({ appendOutbox: async event => {
      const result = await outbox.appendOutbox(event);
      if (lost) { lost = false; throw new Error('synthetic_enqueue_ack_lost_after_real_commit'); }
      return result;
    } }));
    const first = setup.dispatcher(); await first.dispatch(); await first.onModuleDestroy(); await assertPending(setup, 1);
    const child = await assertChildPending(setup, 1);
    await retryNow(setup.event.event_id); const second = setup.dispatcher(); await second.dispatch(); await second.onModuleDestroy();
    assert.equal(await setup.outbox.isProcessed(setup.event.event_id), true);
    assert.equal((await childFor(setup)).eventId, child.eventId);
    assert.deepEqual((await state()).usages, [0]);
    await prisma.$executeRaw`DELETE FROM synthetic_redemption_faults`; await retryNow(child.eventId);
    const third = setup.dispatcher(); await third.dispatch(); await third.onModuleDestroy();
    assert.deepEqual((await state()).usages, [1]); assert.equal((await state()).events, 1);
  });
  await check('five child failures become dead without blocking parent delivery or recursively enqueueing', async () => {
    await reset(); await reserve(); await switchFault('commit'); const setup = await setupDispatcher();
    let childId;
    for (let attempt = 1; attempt <= 5; attempt++) {
      if (childId) await retryNow(childId);
      const dispatcher = setup.dispatcher(); await dispatcher.dispatch(); await dispatcher.onModuleDestroy();
      const row = await childFor(setup); childId = row.eventId;
      assert.equal(row.attempts, attempt); assert.equal(row.status, attempt === 5 ? 'dead' : 'pending');
      assert.equal(row.lastError, 'outbox_handler_failed');
    }
    assert.equal(await setup.outbox.isProcessed(setup.event.event_id), true);
    assert.equal((await prisma.outboxMessage.findUniqueOrThrow({ where: { eventId: setup.event.event_id } })).attempts, 1);
    assert.equal(await setup.outbox.isHandlerProcessed(childId, setup.bus.handlersFor('coupon.redemption.requested')[0].handlerId), false);
    assert.deepEqual((await state()).usages, [0]); assert.equal((await state()).events, 0);
  });
  console.log(JSON.stringify({ status: 'passed', checks, maxConcurrentWaitingTransactions, prismaClientCount: 1, poolLimit: 24,
    realProviderCalls: 0, checkoutHandoffProof: false, paymentProof: false, externalDeliveryProof: false }));
} catch (error) {
  console.error(JSON.stringify({ status: 'failed', check: active, reason: error instanceof assert.AssertionError ? error.message : 'native_coupon_redemption_check_failed' }));
  process.exitCode = 1;
} finally { await prisma.$disconnect(); }

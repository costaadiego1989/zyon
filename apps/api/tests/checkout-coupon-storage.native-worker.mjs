import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { setTimeout as pause } from 'node:timers/promises';
import { inspectNativePrismaClient, assertNativePrismaUrl } from './native-prisma-admission-guards.mjs';

const args = process.argv.slice(2), [url, runId] = args;
assert.equal(args.length, 2);
const parsed = assertNativePrismaUrl(url);
assert.match(runId, /^[a-f0-9-]{36}$/);
assert.equal(parsed.searchParams.get('application_name'), `aacp_write_native_${runId}`);
for (const key of ['DATABASE_URL', 'DIRECT_URL', 'NODE_OPTIONS', 'DOTENV_CONFIG_PATH', 'PRISMA_QUERY_ENGINE_LIBRARY', 'READY_PROD_TEST_PRISMA_CLIENT'])
  assert.equal(process.env[key], undefined, 'native_storage_environment_not_clean');
inspectNativePrismaClient(fileURLToPath(new URL('../', import.meta.url)));
const { PrismaClient } = await import('@prisma/client');
const { PrismaCheckoutRepository } = await import('../src/modules/checkout/infrastructure/prisma/prisma-checkout.repository.ts');
const { PrismaStorefrontTelemetryRepository } = await import('../src/modules/storefront/infrastructure/repositories/prisma-storefront-telemetry.repository.ts');
const { PrismaPaymentRepository } = await import('../src/modules/payment/infrastructure/prisma-payment.repository.ts');
const { PaymentIntentEntity } = await import('../src/modules/payment/domain/payment-intent.entity.ts');
const { ApplyOfferUseCase } = await import('../src/modules/checkout/application/use-cases/apply-offer.use-case.ts');
const { checkoutSession } = await import('../src/modules/checkout/__tests__/checkout-test-fixtures.ts');
const { lockCheckoutSessionAnchor } = await import('../src/shared/persistence/checkout-session-lock.ts');
const { UpdateMarketplaceCheckoutAddressService } = await import('../src/modules/embed/application/update-marketplace-checkout-address.service.ts');
const { ConflictException } = await import('@nestjs/common');
const prisma = new PrismaClient({ datasources: { db: { url } }, log: [], transactionOptions: { timeout: 30_000, maxWait: 15_000 } });
const repository = new PrismaCheckoutRepository(prisma);
const merchantId = 'synthetic-storage-merchant', sessionId = 'synthetic-storage-checkout';
const key = '_storefrontCouponBinding';
const binding = { version: 1, bindingId: '11111111-1111-4111-8111-111111111111', merchantId,
  checkoutSessionId: sessionId, cartId: 'synthetic-storage-cart', buyerId: 'synthetic-storage-buyer', reservationBuyerId: null,
  couponId: 'synthetic-storage-coupon', redemptionId: 'synthetic-storage-redemption', discountCents: 137, basisHash: 'ab'.repeat(32), state: 'active' };
const scope = { merchantId, sessionId };
const raw = () => prisma.checkoutSession.findUniqueOrThrow({ where: { merchantId_sessionId: scope } });
const view = () => repository.getSession(merchantId, sessionId);
const seed = async (privateValue = binding, include = true, create = true) => {
  await prisma.$executeRaw`TRUNCATE checkout_sessions, checkout_events, payment_intents, synthetic_storage_faults CASCADE`;
  const session = checkoutSession({ ...scope, globalUserId: binding.buyerId, persistenceVersion: 0, shipping: undefined,
    cart: { cart_ref: binding.cartId, source: 'storefront', currency: 'BRL', total: 10, currentDiscount: 1.37,
      items: [{ sku: 'SKU', name: 'Synthetic', price: 10, quantity: 1 }] } });
  if (create) await prisma.checkoutSession.create({ data: { merchantId, sessionId, globalUserId: session.globalUserId,
    conversationId: session.conversationId, cart: { ...session.cart, ...(include ? { [key]: privateValue } : {}) },
    customer: session.customer, shipping: session.shipping, chatHistory: [], abandonmentScore: 0, triggerAgent: false,
    createdAt: new Date(session.createdAt), updatedAt: new Date(session.updatedAt) } });
  return session;
};
const rejects = work => assert.rejects(work, { message: 'checkout_coupon_binding_conflict' });
// Synthetic journal setup, not an external PSP admission/delivery receipt.
const seedJournal = async intent => {
  const s = intent.snapshot();
  await prisma.paymentIntent.create({ data: { id: s.id, merchantId: s.merchantId, sessionId: s.sessionId,
    idempotencyKey: s.idempotencyKey, amountCents: s.amountCents, currency: s.currency, method: s.method, status: s.status,
    providerPaymentId: s.providerPaymentId, statusHistory: s.statusHistory, creation: s.creation, version: s.version ?? 1 } });
};
let active = 'owned database marker', checks = 0, waiters = 0;
const check = async (name, work) => { active = name; await work(); checks++; console.log(JSON.stringify({ test: name, status: 'passed' })); };
const countAnchorWaiters = async (tenant = merchantId, session = sessionId) => {
  const anchor = JSON.stringify(['checkout-session', tenant, session]);
  return Number((await prisma.$queryRaw`SELECT count(DISTINCT a.pid)::int AS n FROM pg_stat_activity a
    JOIN pg_locks l ON l.pid = a.pid
    WHERE a.application_name=${`aacp_write_native_${runId}`} AND a.wait_event_type='Lock' AND a.state='active'
      AND l.locktype='advisory' AND NOT l.granted AND l.objsubid=1
      AND l.classid::bigint=((hashtextextended(${anchor}, 0) >> 32) & 4294967295)
      AND l.objid::bigint=(hashtextextended(${anchor}, 0) & 4294967295)`)[0].n);
};
const waitForAnchors = async (expected, tenant = merchantId, session = sessionId) => {
  const deadline = Date.now() + 9000;
  let observed = 0;
  do { observed = await countAnchorWaiters(tenant, session); if (observed === expected) return observed; await pause(20); }
  while (Date.now() < deadline);
  assert.equal(observed, expected, 'exact_scoped_anchor_waiters_not_observed');
};

try {
  assert.deepEqual(await prisma.$queryRaw`SELECT run_id FROM synthetic_native_marker`, [{ run_id: runId }]);
  await prisma.$executeRawUnsafe('CREATE TABLE synthetic_storage_faults (session_id TEXT PRIMARY KEY)');
  await prisma.$executeRawUnsafe(`CREATE FUNCTION synthetic_storage_commit_failure() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF EXISTS (SELECT 1 FROM synthetic_storage_faults WHERE session_id=NEW.session_id)
      THEN RAISE EXCEPTION 'synthetic_storage_deferred_commit'; END IF; RETURN NEW; END $$`);
  await prisma.$executeRawUnsafe(`CREATE CONSTRAINT TRIGGER synthetic_storage_deferred_failure AFTER UPDATE ON checkout_sessions
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION synthetic_storage_commit_failure()`);
  await check('canonical private JSON survives a neutral save and never appears in the returned session', async () => {
    await seed(); const session = await view();
    assert.equal(Object.hasOwn(session.cart, key), false);
    session.aiCostCents = 1; await repository.saveSession(session);
    assert.deepEqual((await raw()).cart[key], binding);
    assert.equal(session.persistenceVersion, 1); assert.equal(Object.hasOwn(session.cart, key), false);
  });
  await check('CAS preserves canonical storage; stale snapshots cannot delete or replace it', async () => {
    await seed(); const expected = await view(), next = structuredClone(expected); next.aiCostCents = 2;
    await repository.saveSessionIfUnchanged(next, expected);
    assert.deepEqual((await raw()).cart[key], binding);
    await rejects(() => repository.saveSessionIfUnchanged(expected, expected));
    assert.equal((await raw()).version, 1);
  });
  await check('generic create/update cannot insert private fields, including an identical copy', async () => {
    const session = await seed(); const before = await raw();
    for (const value of [binding, null, undefined]) {
      const forged = { ...session, sessionId: 'synthetic-forged', cart: { ...session.cart, [key]: value } };
      await rejects(() => repository.createSessionIfAbsent(forged)); await rejects(() => repository.saveSession(forged));
    }
    assert.equal(await prisma.checkoutSession.count(), 1); assert.deepEqual(await raw(), before);
  });
  await check('missing version and changed commercial context cannot overwrite a bound row', async () => {
    await seed(); const before = await raw(), session = await view();
    await rejects(() => repository.saveSession({ ...session, persistenceVersion: undefined }));
    for (const change of [{ total: 11 }, { currentDiscount: 0 }, { cart_ref: 'other' }]) {
      await rejects(() => repository.saveSession({ ...session, cart: { ...session.cart, ...change } }));
    }
    await rejects(() => repository.saveSession({ ...session, globalUserId: 'other-buyer' }));
    assert.deepEqual(await raw(), before);
  });
  await check('released tombstone preserves zero current discount without reactivating old authority', async () => {
    await seed({ ...binding, state: 'released' });
    await prisma.checkoutSession.update({ where: { merchantId_sessionId: scope }, data: { cart: { ...(await view()).cart, currentDiscount: 0,
      [key]: { ...binding, state: 'released' } } } });
    const session = await view(); await repository.saveSession(session);
    assert.equal((await raw()).cart.currentDiscount, 0); assert.equal((await raw()).cart[key].state, 'released');
  });
  await check('failed transaction rolls back public metadata, private JSON and version together', async () => {
    await seed(); const before = await raw();
    await assert.rejects(repository.transaction(async tx => {
      const session = await tx.getSession(merchantId, sessionId); session.aiCostCents = 10;
      await tx.saveSession(session); throw new Error('synthetic_rollback');
    }), { message: 'synthetic_rollback' });
    assert.deepEqual(await raw(), before);
  });
  await check('deferred commit failure does not advance the caller token or leave a partial save', async () => {
    await seed(); const before = await raw(), session = await view(); session.aiCostCents = 12;
    await prisma.$executeRaw`INSERT INTO synthetic_storage_faults(session_id) VALUES (${sessionId})`;
    await assert.rejects(repository.saveSession(session));
    assert.equal(session.persistenceVersion, 0); assert.deepEqual(await raw(), before);
  });
  await check('lost acknowledgement after a real commit leaves a stale token; blind retry cannot save again', async () => {
    await seed(); const session = await view(); session.aiCostCents = 13;
    const ackLost = new Proxy(prisma, { get(target, property) {
      if (property === '$transaction') return async work => { await target.$transaction(work); throw new Error('synthetic_ack_lost'); };
      const value = Reflect.get(target, property); return typeof value === 'function' ? value.bind(target) : value;
    } });
    await assert.rejects(new PrismaCheckoutRepository(ackLost).saveSession(session), { message: 'synthetic_ack_lost' });
    assert.equal(session.persistenceVersion, 0); assert.equal((await raw()).version, 1);
    await rejects(() => repository.saveSession(session)); assert.equal((await raw()).version, 1);
  });
  await check('twenty writers wait on the exact session anchor before the row; exactly one versioned snapshot commits', async () => {
    await seed(); const sessions = await Promise.all(Array.from({ length: 20 }, () => view()));
    let signal, release;
    const locked = new Promise(resolve => { signal = resolve; }), gate = new Promise(resolve => { release = resolve; });
    const holder = prisma.$transaction(async tx => {
      await lockCheckoutSessionAnchor(tx, merchantId, sessionId);
      await tx.$queryRaw`SELECT id FROM checkout_sessions WHERE merchant_id=${merchantId} AND session_id=${sessionId} FOR UPDATE`;
      signal(); await gate;
    });
    let writes = [];
    try {
      await Promise.race([locked, holder.then(() => { throw new Error('storage_holder_exited_before_gate'); })]);
      writes = sessions.map(session => repository.saveSession(session));
      const outcomes = Promise.allSettled(writes);
      waiters = await waitForAnchors(20); release(); await holder;
      const results = await outcomes;
      assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
      assert.equal(results.filter(result => result.status === 'rejected' && result.reason.message === 'checkout_coupon_binding_conflict').length, 19);
      assert.equal((await raw()).version, 1); assert.deepEqual((await raw()).cart[key], binding);
    } finally { release(); await Promise.allSettled([holder, ...writes]); }
  });
  await check('telemetry cannot replace the canonical cart or append events on a bound checkout', async () => {
    await seed(); const before = await raw();
    const telemetry = new PrismaStorefrontTelemetryRepository(prisma, { async getOrCreate() {
      return { items: [], total: 0, discount: 0, freeShipping: false, couponCode: null };
    } });
    await rejects(() => telemetry.recordEvent({ merchantId, conversationId: sessionId, event: 'checkout_started' }));
    assert.deepEqual(await raw(), before); assert.equal(await prisma.checkoutEvent.count(), 0);
  });
  await check('payment admission refuses raw private authority before persisting any new journal', async () => {
    await seed(); const intent = PaymentIntentEntity.create({ ...scope, idempotencyKey: 'synthetic-storage-payment', amountCents: 863, currency: 'BRL', method: 'pix' });
    intent.prepareCreation({ ...scope, intentId: intent.id, amountCents: 863, currency: 'BRL', method: 'pix' });
    await rejects(() => new PrismaPaymentRepository(prisma).saveIntent({ intent }));
    assert.equal(await prisma.paymentIntent.count(), 0);
  });
  await check('external offer preflight reads raw storage even when public cart was sanitized', async () => {
    await seed(); let effects = 0;
    const useCase = new ApplyOfferUseCase(repository, { async getOffer() { effects++; throw new Error('unexpected_offer_lookup'); } },
      { async apply() { effects++; return { success: true }; } }, { async execute() { effects++; } });
    await rejects(() => useCase.execute({ merchant_id: merchantId, session_id: sessionId, offer_id: 'synthetic-offer' }));
    assert.equal(effects, 0);
  });
  await check('first-send lease refuses a bound cart and leaves the synthetic ready journal unchanged', async () => {
    await seed(); const intent = PaymentIntentEntity.create({ ...scope, idempotencyKey: 'synthetic-first-send', amountCents: 863, currency: 'BRL', method: 'pix' });
    intent.prepareCreation({ ...scope, intentId: intent.id, amountCents: 863, currency: 'BRL', method: 'pix' });
    intent.persisted(1); await seedJournal(intent);
    assert.equal(intent.claimCreation('synthetic-lease', new Date()), 'create');
    await rejects(() => new PrismaPaymentRepository(prisma).saveIntent({ intent }));
    const stored = await prisma.paymentIntent.findUniqueOrThrow({ where: { id: intent.id } });
    assert.equal(stored.version, 1); assert.equal(stored.creation.state, 'ready');
  });
  await check('post-dispatch reconciliation remains available with private metadata present', async () => {
    await seed(); const intent = PaymentIntentEntity.create({ ...scope, idempotencyKey: 'synthetic-receipt', amountCents: 863, currency: 'BRL', method: 'pix' });
    intent.prepareCreation({ ...scope, intentId: intent.id, amountCents: 863, currency: 'BRL', method: 'pix' });
    intent.claimCreation('synthetic-dispatched', new Date());
    intent.markRequiresAction({ providerPaymentId: 'synthetic-provider-payment' });
    intent.completeCreation('synthetic-dispatched'); intent.persisted(1); await seedJournal(intent);
    intent.markApproved({ providerPaymentId: 'synthetic-provider-payment', approvedAmountCents: 863 });
    await new PrismaPaymentRepository(prisma).saveIntent({ intent });
    const stored = await prisma.paymentIntent.findUniqueOrThrow({ where: { id: intent.id } });
    assert.equal(stored.status, 'approved'); assert.equal(stored.version, 2);
    assert.deepEqual((await raw()).cart[key], binding);
  });
  await check('legacy unbound carts keep read/save/create semantics and never acquire a binding', async () => {
    await seed(undefined, false); const session = await view(); session.aiCostCents = 5;
    await repository.saveSession(session); assert.equal(Object.hasOwn((await raw()).cart, key), false);
    const result = await repository.createSessionIfAbsent({ ...session, sessionId: 'synthetic-plain-new', conversationId: 'synthetic-plain-conversation' });
    assert.equal(result.created, true); assert.equal(Object.hasOwn(result.session.cart, key), false);
  });
  await check('an uncertain previously attempted payment may persist a recovery lease without creating another admission', async () => {
    await seed(); const intent = PaymentIntentEntity.create({ ...scope, idempotencyKey: 'synthetic-uncertain', amountCents: 863, currency: 'BRL', method: 'pix' });
    intent.prepareCreation({ ...scope, intentId: intent.id, amountCents: 863, currency: 'BRL', method: 'pix' });
    intent.claimCreation('synthetic-first-attempt', new Date(0));
    intent.markCreationUncertain('synthetic-first-attempt', 'synthetic_ack_uncertain');
    intent.persisted(1); await seedJournal(intent);
    assert.equal(intent.claimCreation('synthetic-recovery', new Date()), 'recover');
    await new PrismaPaymentRepository(prisma).saveIntent({ intent });
    const stored = await prisma.paymentIntent.findUniqueOrThrow({ where: { id: intent.id } });
    assert.equal(stored.version, 2); assert.equal(stored.creation.state, 'in_flight');
    assert.equal(stored.creation.firstAttemptAt, new Date(0).toISOString());
    assert.deepEqual((await raw()).cart[key], binding);
  });
  // Synthetic sibling authority is seeded directly. These cases prove journal
  // immutability/CAS only, NOT issuer ownership, coupon redemption or payment.
  const { state: _state, ...couponAuthority } = binding;
  const attemptedJournal = async (bound = true) => {
    await seed();
    const entity = PaymentIntentEntity.create({ ...scope, idempotencyKey: 'synthetic-authority', amountCents: 863, currency: 'BRL', method: 'pix' });
    entity.prepareCreation({ ...scope, intentId: entity.id, amountCents: 863, currency: 'BRL', method: 'pix' });
    entity.claimCreation('synthetic-first', new Date(0)); entity.markCreationUncertain('synthetic-first', 'synthetic_unknown');
    entity.persisted(1);
    const snapshot = entity.snapshot();
    if (bound) snapshot.creation.couponAuthority = couponAuthority;
    const intent = PaymentIntentEntity.rehydrate(snapshot); await seedJournal(intent);
    return intent;
  };
  await check('JSONB sibling authority survives canonical read, recovery lease and approved receipt unchanged', async () => {
    const initial = await attemptedJournal();
    const payments = new PrismaPaymentRepository(prisma);
    const intent = await payments.getIntentById(merchantId, initial.id);
    assert.deepEqual(intent.snapshot().creation.couponAuthority, couponAuthority);
    assert.equal(intent.claimCreation('synthetic-frozen-recovery', new Date()), 'recover');
    await payments.saveIntent({ intent });
    intent.completeCreation('synthetic-frozen-recovery');
    intent.markRequiresAction({ providerPaymentId: 'synthetic-frozen-provider' });
    intent.markApproved({ providerPaymentId: 'synthetic-frozen-provider', approvedAmountCents: 863 });
    await payments.saveIntent({ intent });
    const stored = await prisma.paymentIntent.findUniqueOrThrow({ where: { id: intent.id } });
    assert.equal(stored.version, 3); assert.equal(stored.status, 'approved');
    assert.deepEqual(stored.creation.couponAuthority, couponAuthority);
    assert.equal(stored.creation.firstAttemptAt, new Date(0).toISOString());
    assert.equal(Object.hasOwn(stored.creation.input, 'couponAuthority'), false);
  });
  for (const transition of ['attach-to-legacy', 'drop-stored', 'replace-generation']) {
    await check(`journal refuses ${transition} before write even though money, input and redemptionId match`, async () => {
      const intent = await attemptedJournal(transition !== 'attach-to-legacy');
      const before = await prisma.paymentIntent.findUniqueOrThrow({ where: { id: intent.id } });
      const snapshot = intent.snapshot();
      if (transition === 'drop-stored') delete snapshot.creation.couponAuthority;
      else snapshot.creation.couponAuthority = { ...couponAuthority,
        ...(transition === 'replace-generation' ? { bindingId: '22222222-2222-4222-8222-222222222222' } : {}) };
      const forged = PaymentIntentEntity.rehydrate(snapshot);
      await assert.rejects(new PrismaPaymentRepository(prisma).saveIntent({ intent: forged }), { message: 'payment_coupon_authority_conflict' });
      assert.deepEqual(await prisma.paymentIntent.findUniqueOrThrow({ where: { id: intent.id } }), before);
      assert.equal(forged.snapshot().version, 1);
    });
  }
  await check('failed transaction rolls back a frozen journal without advancing the caller version', async () => {
    const intent = await attemptedJournal();
    const before = await prisma.paymentIntent.findUniqueOrThrow({ where: { id: intent.id } });
    intent.claimCreation('synthetic-rollback-recovery', new Date());
    const rollback = new Proxy(prisma, { get(target, property) {
      if (property === '$transaction') return work => target.$transaction(async tx => { await work(tx); throw new Error('synthetic_frozen_rollback'); });
      const value = Reflect.get(target, property); return typeof value === 'function' ? value.bind(target) : value;
    } });
    await assert.rejects(new PrismaPaymentRepository(rollback).saveIntent({ intent }), { message: 'synthetic_frozen_rollback' });
    assert.equal(intent.snapshot().version, 1);
    assert.deepEqual(await prisma.paymentIntent.findUniqueOrThrow({ where: { id: intent.id } }), before);
  });
  await check('lost ACK after frozen journal commit prevents blind replay or generation reassignment', async () => {
    const intent = await attemptedJournal(); intent.claimCreation('synthetic-ack-recovery', new Date());
    const ackLost = new Proxy(prisma, { get(target, property) {
      if (property === '$transaction') return async work => { await target.$transaction(work); throw new Error('synthetic_frozen_ack_lost'); };
      const value = Reflect.get(target, property); return typeof value === 'function' ? value.bind(target) : value;
    } });
    await assert.rejects(new PrismaPaymentRepository(ackLost).saveIntent({ intent }), { message: 'synthetic_frozen_ack_lost' });
    assert.equal(intent.snapshot().version, 1);
    await assert.rejects(new PrismaPaymentRepository(prisma).saveIntent({ intent }), { message: 'payment_intent_concurrent_change' });
    const stored = await prisma.paymentIntent.findUniqueOrThrow({ where: { id: intent.id } });
    assert.equal(stored.version, 2); assert.deepEqual(stored.creation.couponAuthority, couponAuthority);
  });
  await check('malformed persisted sibling is rejected on read rather than becoming legacy authority', async () => {
    const intent = await attemptedJournal();
    const before = await prisma.paymentIntent.findUniqueOrThrow({ where: { id: intent.id } });
    await prisma.paymentIntent.update({ where: { id: intent.id }, data: { creation: { ...before.creation, couponAuthority: null } } });
    await assert.rejects(new PrismaPaymentRepository(prisma).getIntentById(merchantId, intent.id), { message: 'payment_coupon_authority_conflict' });
    assert.equal((await prisma.paymentIntent.findUniqueOrThrow({ where: { id: intent.id } })).version, 1);
  });
  await check('stored bound authority refuses a PSP input outside the immutable journal scope', async () => {
    const intent = await attemptedJournal();
    const before = await prisma.paymentIntent.findUniqueOrThrow({ where: { id: intent.id } });
    await prisma.paymentIntent.update({ where: { id: intent.id }, data: { creation: { ...before.creation,
      input: { ...before.creation.input, sessionId: 'synthetic-other-checkout' } } } });
    await assert.rejects(new PrismaPaymentRepository(prisma).getIntentById(merchantId, intent.id), { message: 'payment_coupon_authority_conflict' });
    assert.equal((await prisma.paymentIntent.findUniqueOrThrow({ where: { id: intent.id } })).version, 1);
  });
  await check('twenty frozen journal snapshots have exactly one CAS winner without changing generation', async () => {
    const initial = await attemptedJournal(), payments = new PrismaPaymentRepository(prisma);
    const intents = await Promise.all(Array.from({ length: 20 }, () => payments.getIntentById(merchantId, initial.id)));
    intents.forEach((intent, index) => assert.equal(intent.claimCreation(`synthetic-concurrent-recovery-${index}`, new Date()), 'recover'));
    const outcomes = await Promise.allSettled(intents.map(intent => payments.saveIntent({ intent })));
    assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(outcomes.filter(result => result.status === 'rejected' && result.reason.message === 'payment_intent_concurrent_change').length, 19);
    const stored = await prisma.paymentIntent.findUniqueOrThrow({ where: { id: initial.id } });
    assert.equal(stored.version, 2); assert.deepEqual(stored.creation.couponAuthority, couponAuthority);
    assert.equal(stored.creation.firstAttemptAt, new Date(0).toISOString());
  });
  await check('twenty starts wait on the exact anchor while no checkout row exists; one creates and nineteen resume', async () => {
    const candidate = await seed(undefined, false, false);
    let signal, release; const locked = new Promise(resolve => { signal = resolve; }), gate = new Promise(resolve => { release = resolve; });
    const holder = prisma.$transaction(async tx => { await lockCheckoutSessionAnchor(tx, merchantId, sessionId); signal(); await gate; });
    let calls = [];
    try {
      await Promise.race([locked, holder.then(() => { throw new Error('absent_anchor_holder_exited'); })]);
      const candidates = Array.from({ length: 20 }, (_, index) => ({ ...candidate, conversationId: `synthetic-anchor-start-${index}` }));
      calls = candidates.map(input => repository.createSessionIfAbsent(input));
      const outcomes = Promise.all(calls);
      await waitForAnchors(20); assert.equal(await prisma.checkoutSession.count(), 0);
      release(); await holder;
      const results = await outcomes, winner = results.find(result => result.created);
      assert.equal(results.filter(result => result.created).length, 1);
      assert.equal(results.filter(result => !result.created).length, 19);
      assert.equal(await prisma.checkoutSession.count(), 1);
      assert.equal((await raw()).conversationId, winner.session.conversationId);
      assert.equal((await raw()).version, 0);
      assert.ok(results.every(result => result.session.conversationId === winner.session.conversationId));
      assert.equal(Object.hasOwn((await raw()).cart, key), false);
      assert.equal((await repository.createSessionIfAbsent(winner.session)).created, false);
    } finally { release(); await Promise.allSettled([holder, ...calls]); }
  });
  await check('a checkout published under the anchor is reread before stale save or telemetry can overwrite it', async () => {
    const candidate = await seed(undefined, false, false);
    let signal, release; const locked = new Promise(resolve => { signal = resolve; }), gate = new Promise(resolve => { release = resolve; });
    const holder = prisma.$transaction(async tx => {
      await lockCheckoutSessionAnchor(tx, merchantId, sessionId);
      // Synthetic private metadata only; there is still no runtime issuer.
      await tx.checkoutSession.create({ data: { merchantId, sessionId, globalUserId: candidate.globalUserId,
        conversationId: candidate.conversationId, cart: { ...candidate.cart, [key]: binding },
        customer: candidate.customer, shipping: candidate.shipping, chatHistory: [], abandonmentScore: 0, triggerAgent: false,
        createdAt: new Date(candidate.createdAt), updatedAt: new Date(candidate.updatedAt) } });
      signal(); await gate;
    });
    let calls = [];
    try {
      await Promise.race([locked, holder.then(() => { throw new Error('publication_holder_exited'); })]);
      const telemetry = new PrismaStorefrontTelemetryRepository(prisma, { async getOrCreate() {
        return { items: [], total: 0, discount: 0, freeShipping: false, couponCode: null };
      } });
      calls = [repository.saveSession({ ...candidate, persistenceVersion: undefined, cart: { ...candidate.cart, currentDiscount: 0 } }),
        telemetry.recordEvent({ merchantId, conversationId: sessionId, event: 'checkout_started' }),
        repository.createSessionIfAbsent({ ...candidate, conversationId: 'synthetic-losing-start' })];
      const outcomes = Promise.allSettled(calls);
      await waitForAnchors(3); assert.equal(await prisma.checkoutSession.count(), 0);
      release(); await holder;
      const results = await outcomes;
      for (const result of results.slice(0, 2)) { assert.equal(result.status, 'rejected'); assert.equal(result.reason.message, 'checkout_coupon_binding_conflict'); }
      assert.equal(results[2].status, 'fulfilled'); assert.equal(results[2].value.created, false);
      assert.equal(Object.hasOwn(results[2].value.session.cart, key), false);
      assert.deepEqual((await raw()).cart[key], binding); assert.equal((await raw()).version, 0);
      assert.equal(await prisma.checkoutEvent.count(), 0);
    } finally { release(); await Promise.allSettled([holder, ...calls]); }
  });
  await check('rollback of a nested first creation releases the anchor and lets one waiting start create normally', async () => {
    const candidate = await seed(undefined, false, false);
    let signal, release; const locked = new Promise(resolve => { signal = resolve; }), gate = new Promise(resolve => { release = resolve; });
    const holder = prisma.$transaction(async tx => {
      const nested = new PrismaCheckoutRepository(tx, true);
      assert.equal((await nested.createSessionIfAbsent(candidate)).created, true);
      // Reacquisition is in this SAME transaction, never a root/autocommit client.
      await lockCheckoutSessionAnchor(tx, merchantId, sessionId);
      signal(); await gate; throw new Error('synthetic_first_create_rollback');
    });
    const rejectedHolder = assert.rejects(holder, { message: 'synthetic_first_create_rollback' });
    let pending;
    try {
      await Promise.race([locked, rejectedHolder.then(() => { throw new Error('rollback_holder_exited'); })]);
      pending = repository.createSessionIfAbsent({ ...candidate, conversationId: 'synthetic-after-rollback' });
      await waitForAnchors(1); assert.equal(await prisma.checkoutSession.count(), 0);
      release(); await rejectedHolder;
      const result = await pending;
      assert.equal(result.created, true); assert.equal(result.session.conversationId, 'synthetic-after-rollback');
      assert.equal((await raw()).conversationId, 'synthetic-after-rollback'); assert.equal(await prisma.checkoutSession.count(), 1);
    } finally { release(); await Promise.allSettled([holder, ...(pending ? [pending] : [])]); }
  });
  await check('lost ACK after first creation never retries automatically and an explicit resume does not overwrite the winner', async () => {
    const candidate = await seed(undefined, false, false); let commits = 0;
    const ackLost = new Proxy(prisma, { get(target, property) {
      if (property === '$transaction') return async work => { commits++; await target.$transaction(work); throw new Error('synthetic_create_ack_lost'); };
      const value = Reflect.get(target, property); return typeof value === 'function' ? value.bind(target) : value;
    } });
    await assert.rejects(new PrismaCheckoutRepository(ackLost).createSessionIfAbsent(candidate), { message: 'synthetic_create_ack_lost' });
    assert.equal(commits, 1); const before = await raw();
    const result = await repository.createSessionIfAbsent({ ...candidate, conversationId: 'synthetic-no-reassignment' });
    assert.equal(result.created, false); assert.equal(result.session.conversationId, candidate.conversationId);
    assert.deepEqual(await raw(), before); assert.equal(await prisma.checkoutSession.count(), 1);
  });
  await check('a held anchor for one tenant does not block the same checkout id in another tenant', async () => {
    const candidate = await seed(undefined, false, false), other = 'synthetic-anchor-other-merchant';
    let signal, release; const locked = new Promise(resolve => { signal = resolve; }), gate = new Promise(resolve => { release = resolve; });
    const holder = prisma.$transaction(async tx => { await lockCheckoutSessionAnchor(tx, merchantId, sessionId); signal(); await gate; });
    let pending, timer;
    try {
      await Promise.race([locked, holder.then(() => { throw new Error('tenant_holder_exited'); })]);
      pending = repository.createSessionIfAbsent({ ...candidate, merchantId: other, conversationId: 'synthetic-other-tenant' });
      const result = await Promise.race([pending, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('cross_tenant_anchor_blocked')), 4000); })]);
      assert.equal(result.created, true); assert.equal(result.session.merchantId, other);
      assert.equal(await prisma.checkoutSession.count({ where: { merchantId } }), 0);
      assert.equal(await prisma.checkoutSession.count({ where: { merchantId: other } }), 1);
    } finally { clearTimeout(timer); release(); await Promise.allSettled([holder, ...(pending ? [pending] : [])]); }
  });
  await check('nested save and event writes reacquire the anchor in the same transaction and rollback together', async () => {
    const candidate = await seed(undefined, false, false);
    await assert.rejects(repository.transaction(async tx => {
      await tx.saveSession(candidate); assert.equal(await prisma.checkoutSession.count(), 0);
      await tx.recordEvent(merchantId, sessionId, 'checkout_started');
      assert.equal((await tx.getSession(merchantId, sessionId)).cart.total, candidate.cart.total);
      throw new Error('synthetic_nested_anchor_rollback');
    }), { message: 'synthetic_nested_anchor_rollback' });
    assert.equal(await prisma.checkoutSession.count(), 0); assert.equal(await prisma.checkoutEvent.count(), 0);
  });
  await check('address locks wait on merchant before anchor while an incentive-enabled nested save can finish', async () => {
    await seed(); const session = await view();
    await prisma.$executeRaw`INSERT INTO merchants(id, name, updated_at) VALUES (${merchantId}, 'Synthetic', CURRENT_TIMESTAMP) ON CONFLICT (id) DO NOTHING`;
    const previousEnabled = process.env.REVENUE_INCENTIVE_EXECUTION_ENABLED, previousIds = process.env.REVENUE_INCENTIVE_EXECUTION_MERCHANT_IDS;
    process.env.REVENUE_INCENTIVE_EXECUTION_ENABLED = 'true'; process.env.REVENUE_INCENTIVE_EXECUTION_MERCHANT_IDS = merchantId;
    let signal, release; const locked = new Promise(resolve => { signal = resolve; }), gate = new Promise(resolve => { release = resolve; });
    const holder = prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM merchants WHERE id=${merchantId} FOR UPDATE`;
      signal(); await gate;
      await new PrismaCheckoutRepository(tx, true).saveSession(session);
    });
    const stop = new ConflictException('synthetic_stop_after_address_locks');
    // Real transaction and SQL locks. Inject a failure at the business read
    // AFTER locks: this is a lock-composition proof, not an address/PSP journey.
    const lockOnly = new Proxy(prisma, { get(target, property) {
      if (property === '$transaction') return work => target.$transaction(tx => work(new Proxy(tx, { get(transaction, key) {
        if (key === 'checkoutSession') return new Proxy(transaction.checkoutSession, { get(model, operation) {
          if (operation === 'findUnique') return async () => { throw stop; };
          const value = Reflect.get(model, operation); return typeof value === 'function' ? value.bind(model) : value;
        } });
        const value = Reflect.get(transaction, key); return typeof value === 'function' ? value.bind(transaction) : value;
      } })));
      const value = Reflect.get(target, property); return typeof value === 'function' ? value.bind(target) : value;
    } });
    let pending, addressStopped;
    try {
      await Promise.race([locked, holder.then(() => { throw new Error('merchant_holder_exited'); })]);
      pending = new UpdateMarketplaceCheckoutAddressService(lockOnly).execute({ ...scope,
        address: { zip: '01310100', street: 'Synthetic', number: '1', neighborhood: 'Synthetic', city: 'Synthetic', state: 'SP' } });
      addressStopped = assert.rejects(pending, error => error === stop);
      const deadline = Date.now() + 9000; let merchantWaiters = 0;
      do {
        merchantWaiters = Number((await prisma.$queryRaw`SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE application_name=${`aacp_write_native_${runId}`} AND wait_event_type='Lock' AND state='active'
            AND query LIKE '%FROM merchants%' AND query LIKE '%FOR UPDATE%'`)[0].n);
        if (merchantWaiters === 1) break; await pause(20);
      } while (Date.now() < deadline);
      assert.equal(merchantWaiters, 1); assert.equal(await countAnchorWaiters(), 0);
      release(); await holder; await addressStopped;
      assert.equal((await raw()).version, 1); assert.deepEqual((await raw()).cart[key], binding);
    } finally {
      release(); await Promise.allSettled([holder, ...(pending ? [pending] : []), ...(addressStopped ? [addressStopped] : [])]);
      if (previousEnabled === undefined) delete process.env.REVENUE_INCENTIVE_EXECUTION_ENABLED;
      else process.env.REVENUE_INCENTIVE_EXECUTION_ENABLED = previousEnabled;
      if (previousIds === undefined) delete process.env.REVENUE_INCENTIVE_EXECUTION_MERCHANT_IDS;
      else process.env.REVENUE_INCENTIVE_EXECUTION_MERCHANT_IDS = previousIds;
    }
  });
  for (const model of [prisma.strategyAssignment, prisma.strategyIncentiveAssignment, prisma.checkoutChatRequest]) assert.equal(await model.count(), 0);
  console.log(JSON.stringify({ status: 'passed', checks, realCheckoutAnchorWaiters: waiters, providerCalls: 0,
    bindingIssuedByRuntime: false, fullCouponLifecycleProof: false, paymentJourneyProof: false }));
} catch (error) { console.error(JSON.stringify({ status: 'failed', test: active })); throw error; }
finally { await prisma.$disconnect(); }

import 'reflect-metadata';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { PrismaClient, Prisma } from '@prisma/client';
import type { AuthorizedOffer, CashbackRules, CheckoutSession, CashbackPaymentBinding } from '@zyon/shared-types';
import { CashbackRepository } from '../src/modules/cashback/infrastructure/cashback.repository.js';
import { CashbackService } from '../src/modules/cashback/application/cashback.service.js';
import { CheckoutCommercialBenefitsService } from '../src/modules/cashback/application/checkout-commercial-benefits.service.js';
import { PrismaCheckoutRepository } from '../src/modules/checkout/infrastructure/prisma/prisma-checkout.repository.js';
import { ApplyCouponUseCase } from '../src/modules/coupons/application/use-cases/apply-coupon.use-case.js';
import { RulesEngineDiscountAdapter } from '../src/modules/coupons/infrastructure/adapters/rules-engine-discount.adapter.js';
import { PrismaBoundCouponRedemption } from '../src/modules/coupons/infrastructure/repositories/prisma-bound-coupon-redemption.js';
import { DEFAULT_RULES } from '../src/modules/merchant/domain/merchant-rules.defaults.js';
import { lockCheckoutSessionAnchor } from '../src/shared/persistence/checkout-session-lock.js';
import { lockStorefrontCart } from '../src/shared/persistence/storefront-cart-lock.js';
import { captureStorefrontCouponForPayment } from '../src/shared/persistence/storefront-coupon/admission.js';
import { readStoredCheckoutCouponBinding } from '../src/modules/checkout/domain/services/checkout-coupon-storage.js';
import { readPaymentCouponAuthority } from '../src/modules/payment/domain/payment-coupon-authority.js';
import { paymentCartFingerprint } from '../src/modules/checkout/domain/services/payment-cart-fingerprint.js';
import type { PaymentIntentSnapshot } from '../src/modules/payment/domain/payment-intent.entity.js';
import { PrismaPaymentRepository } from '../src/modules/payment/infrastructure/prisma-payment.repository.js';
import { ResumePaymentCreationService } from '../src/modules/payment/application/resume-payment-creation.service.js';
import type { PaymentProviderPort } from '../src/modules/payment/domain/ports/payment-provider.port.js';
import { PrismaNormalCheckoutCrossSellAdapter, projectNormalCrossSellCart } from '../src/modules/cross-sell/infrastructure/repositories/prisma-normal-checkout-cross-sell.adapter.js';
import { readNormalCheckoutCrossSellAuthority } from '../src/modules/cross-sell/infrastructure/repositories/prisma-normal-checkout-cross-sell.authority.js';
import { createNormalCrossSellPaymentAdmission } from '../src/modules/payment/infrastructure/prisma-normal-cross-sell-payment-admission.js';
import { CreatePaymentIntentUseCase } from '../src/modules/payment/application/create-payment-intent.use-case.js';
import { PrismaMerchantRepository } from '../src/modules/merchant/infrastructure/prisma-merchant.repository.js';
import { toCheckoutSession } from '../src/modules/checkout/domain/services/checkout-session-projection.js';

// Independent candidate-only tests. Actual schema, published version trigger,
// real repositories and monetary services. No Auth/DI or real PSP claim.
const base = 'postgresql://cashback:cashback-local-test@127.0.0.1:15433/cashback_seed_qa_compiled';
const schema = `cashback_verifier_financial_${randomUUID().replaceAll('-', '')}`;
const scopedUrl = `${base}?schema=${schema}`;
const admin = new pg.Client({ connectionString: base });
let prisma: PrismaClient, cash: CashbackService, journal: CheckoutCommercialBenefitsService, checkout: PrismaCheckoutRepository;
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
const policy: CashbackRules = { earnRateBps: 500, minimumEarnCents: 0, maximumEarnPerOrderCents: null,
  buyerMonthlyEarnLimitCents: null, monthlyBudgetCents: null, releaseTrigger: 'payment_confirmed', releaseDelayDays: 0,
  expiryDays: null, minimumRedeemOrderCents: 0, maximumRedeemBps: 9000, maximumRedeemCents: null,
  allowWithDiscounts: true, terms: 'Independent synthetic QA credit for this merchant only.',
  combination: { allowCoupons: true, allowAdvancedRules: true, limitMode: 'cashback_specific',
    maximumCombinedDiscountBps: null, maximumCombinedDiscountCents: 3000 } };

before(async () => {
  await admin.connect(); await admin.query(`CREATE SCHEMA "${schema}"`);
  const cli = createRequire(import.meta.url).resolve('prisma/build/index.js');
  await promisify(execFile)(process.execPath, [cli, 'db', 'push', '--schema', 'prisma/schema.prisma', '--skip-generate'], {
    cwd: fileURLToPath(new URL('../', import.meta.url)), env: { ...process.env, DATABASE_URL: scopedUrl, CHECKPOINT_DISABLE: '1' }, maxBuffer: 1024 * 1024 });
  await admin.query(`SET search_path TO "${schema}"`);
  await admin.query(await readFile(new URL('../prisma/migrations/20260929020000_checkout_session_write_version/migration.sql', import.meta.url), 'utf8'));
  prisma = new PrismaClient({ datasources: { db: { url: scopedUrl } }, transactionOptions: { timeout: 20000, maxWait: 15000 } });
  const repository = new CashbackRepository(prisma);
  journal = new CheckoutCommercialBenefitsService(repository); cash = new CashbackService(repository, journal);
  checkout = new PrismaCheckoutRepository(prisma, false, undefined, journal);
}, { timeout: 120000 });
after(async () => {
  await prisma?.$disconnect(); assert.match(schema, /^cashback_verifier_financial_[a-f0-9]{32}$/);
  await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await admin.end();
});

async function fixture(options: { native?: boolean; active?: boolean; promotionCents?: number; capCents?: number } = {}) {
  const id = randomUUID().replaceAll('-', ''), merchantId = `qa_fin_${id}`, buyerId = `qa_fin_buyer_${id}`;
  const sessionId = `qa_fin_checkout_${id}`, cartId = `qa_fin_cart_${id}`, productId = `qa_fin_product_${id}`, variantId = `qa_fin_variant_${id}`;
  const native = options.native !== false, active = options.active !== false, promotion = options.promotionCents ?? 0;
  await prisma.merchant.create({ data: { id: merchantId, name: 'Independent financial QA' } });
  await checkout.setRules(merchantId, { ...DEFAULT_RULES, maxDiscountPercent: 20, minimumMarginPercent: 0, allowStackDiscountAndFreeShipping: true });
  await prisma.buyerAccount.create({ data: { globalUserId: buyerId, email: `${id}@cashback.invalid`, displayName: 'Synthetic verifier buyer' } });
  await prisma.product.create({ data: { id: productId, merchantId, name: 'Independent digital QA', type: 'digital',
    metadata: { downloadUrl: 'https://cashback.invalid/synthetic-source.pdf' } } });
  await prisma.productVariant.create({ data: { id: variantId, productId, sku: id } });
  await prisma.productPrice.create({ data: { variantId, basePriceInCents: 12345, costInCents: 2000, currency: 'BRL' } });
  if (native) await prisma.storefrontCart.create({ data: { merchantId, sessionId: cartId, total: 12345,
    expiresAt: new Date(Date.now() + 86400000), items: [{ variantId, productId, sku: id, name: 'Independent digital QA', unitPriceCents: 12345, quantity: 1 }] } });
  await prisma.checkoutSession.create({ data: { merchantId, sessionId, conversationId: cartId, globalUserId: buyerId,
    createdAt: new Date(), updatedAt: new Date(),
    cart: json({ currency: 'BRL', total: (12345 - promotion) / 100, currentDiscount: 0,
      ...(native ? { source: 'storefront', cart_ref: cartId } : {}),
      ...(promotion ? { discountBudget: { version: 1, originalSubtotalCents: 12345, promotionDiscountCents: promotion } } : {}),
      items: [{ sku: id, variantId, product_id: productId, name: 'Independent digital QA', price: (12345 - promotion) / 100,
        cost: 20, quantity: 1, productType: 'digital', fulfillmentStrategy: 'digital' }] }),
    customer: { fullName: 'Synthetic QA', email: `${id}@cashback.invalid`, email_verified: true, cpf: '12345678901', asaasCustomerId: 'qa_synthetic_customer',
      phone: '5500000000001', phone_verified: true, address: { state: 'SP', city: 'QA', zip: '01001000' } } } });
  const rules = { ...policy, combination: { ...policy.combination!, maximumCombinedDiscountCents: options.capCents ?? 3000 } };
  if (active) { await cash.saveDraft(merchantId, rules, 'qa-owner'); await cash.publishProgram(merchantId, 'qa-owner', { requireCombination: true }); }
  await cash.adjustWallet(merchantId, buyerId, { amountCents: 4000, reason: 'Independent QA only', expiryDays: null, idempotencyKey: 'initial' }, 'qa-owner');
  const couponId = `qa_fin_coupon_${id}`, code = 'VERIFY777';
  await prisma.coupon.create({ data: { id: couponId, merchantId, code, discountType: 'fixed', discountValue: 7.77,
    startsAt: new Date(Date.now() - 86400000), endsAt: new Date(Date.now() + 86400000), maxPerBuyer: 5, maxUsages: 5 } });
  const current = () => checkout.getSession(merchantId, sessionId).then(value => { assert.ok(value); return value; });
  async function coupon() {
    const session = await current();
    if (native) {
      const command = new ApplyCouponUseCase({} as never, {} as never, new RulesEngineDiscountAdapter(), prisma, async (tx, scope) => {
        const current = await readNormalCheckoutCrossSellAuthority(tx, scope);
        return toCheckoutSession({ ...current.stored, cart: projectNormalCrossSellCart(current) });
      }, journal);
      return (await command.executeForCheckout({ merchant_id: merchantId, session_id: sessionId, code, expectedVersion: session.persistenceVersion! })).session;
    }
    const redemptionId = `qa_fin_redemption_${id}`;
    await prisma.couponRedemption.create({ data: { id: redemptionId, merchantId, sessionId, couponId, buyerGlobalUserId: buyerId, discountApplied: 7.77, source: 'synthetic_authorized_fixture' } });
    const result = await journal.applyCoupon(session, { redemption_id: redemptionId, discount_applied: 7.77, coupon: { id: couponId, code } });
    assert.ok(result); return result;
  }
  async function advanced(session: CheckoutSession) {
    const offer: AuthorizedOffer = { id: `qa_fin_offer_${id}`, merchantId, sessionId, approved: true, type: 'discount_fixed', value: 3.33,
      marginAfterOffer: 0.7, reason: 'Synthetic trusted authorization', expiresAt: new Date(Date.now() + 600000).toISOString() };
    const result = await journal.applyAdvancedRule(session, offer); assert.ok(result); return result;
  }
  return { id, merchantId, buyerId, sessionId, cartId, couponId, rules, current, coupon, advanced };
}

function snapshot(session: CheckoutSession, binding?: CashbackPaymentBinding): PaymentIntentSnapshot {
  const id = `qa_fin_payment_${randomUUID().replaceAll('-', '')}`;
  const subtotal = Math.round(session.cart.total * 100), discount = Math.round((session.cart.currentDiscount ?? 0) * 100), cashback = binding?.cashbackCents ?? 0;
  const amountCents = subtotal - discount - cashback + 99;
  return { id, merchantId: session.merchantId, sessionId: session.sessionId, idempotencyKey: id, version: 0,
    amountCents, currency: 'BRL', method: 'pix', status: 'pending', amountBreakdown: { version: 1, currency: 'BRL',
      itemsSubtotalCents: subtotal, discountCents: discount, shippingCents: 0, platformFeeCents: 99, totalCents: amountCents,
      cartFingerprint: paymentCartFingerprint(session), ...(binding ? { cashbackCents: cashback,
        cashbackReservationId: binding.reservationId!, cashbackEarningQuoteId: binding.earningQuoteId! } : {}) },
    creation: { state: 'ready', input: { merchantId: session.merchantId, sessionId: session.sessionId, intentId: id,
      amountCents, currency: 'BRL', method: 'pix', provider: 'asaas' } },
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), statusHistory: [] } as PaymentIntentSnapshot;
}
async function capture(session: CheckoutSession, payment: PaymentIntentSnapshot, buyerId = session.globalUserId) {
  return prisma.$transaction(async tx => {
    await journal.lockInTransaction(tx, session.merchantId);
    await tx.$queryRaw`SELECT id FROM merchants WHERE id=${session.merchantId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM merchant_rules WHERE merchant_id=${session.merchantId} FOR UPDATE`;
    await lockCheckoutSessionAnchor(tx, session.merchantId, session.sessionId);
    await tx.$queryRaw`SELECT id FROM checkout_sessions WHERE merchant_id=${session.merchantId} AND session_id=${session.sessionId} FOR UPDATE`;
    await lockStorefrontCart(tx, session.merchantId, session.cart.cart_ref!);
    return captureStorefrontCouponForPayment(tx, payment, { merchantId: session.merchantId, checkoutSessionId: session.sessionId,
      cartId: session.cart.cart_ref!, buyerId });
  });
}
async function persist(payment: PaymentIntentSnapshot) {
  return prisma.paymentIntent.create({ data: { id: payment.id, merchantId: payment.merchantId, sessionId: payment.sessionId,
    idempotencyKey: payment.idempotencyKey, amountCents: payment.amountCents, currency: payment.currency,
    method: payment.method, status: payment.status, amountBreakdown: json(payment.amountBreakdown), creation: json(payment.creation), statusHistory: [] } });
}
async function effects(merchantId: string) {
  return { session: await prisma.checkoutSession.findMany({ where: { merchantId }, select: { sessionId: true, version: true, cart: true } }),
    ledger: await prisma.cashbackLedgerEntry.findMany({ where: { merchantId }, orderBy: { id: 'asc' } }),
    journal: await prisma.cashbackCheckoutBenefits.findMany({ where: { merchantId } }),
    reservations: await prisma.cashbackReservation.findMany({ where: { merchantId } }),
    redemptions: await prisma.couponRedemption.findMany({ where: { merchantId }, orderBy: { id: 'asc' } }) };
}

test('VERIFIER FIN-01 PG captures coupon777 separately from combined1110 and cash1000', async () => {
  const f = await fixture(), session = await f.advanced(await f.coupon());
  assert.equal(session.persistenceVersion, 2); assert.equal(Math.round(session.cart.currentDiscount! * 100), 1110);
  await cash.reserveCheckout(session, 1000, 'reserve');
  const binding = await cash.preparePayment(session, 'capture-key'), payment = snapshot(session, binding);
  // prepare and payment journal use one stable payment key.
  payment.idempotencyKey = 'capture-key';
  const authority = await capture(session, payment); assert.ok(authority); assert.equal(authority.version, 2);
  assert.equal(authority.discountCents, 777); assert.equal(authority.version === 2 && authority.combinedDiscountCents, 1110);
  payment.creation!.couponAuthority = authority; await persist(payment);
  await cash.bindPayment(f.merchantId, f.sessionId, 'capture-key', payment.id, { earningQuoteId: binding.earningQuoteId!, reservationId: binding.reservationId!, cashbackCents: 1000 });
  const quote = await prisma.cashbackEarningQuote.findFirstOrThrow({ where: { merchantId: f.merchantId } });
  assert.equal(payment.amountCents, 10334); assert.equal((quote.data as any).baseCents, 10235); assert.equal((quote.data as any).earnCents, 511);
  assert.equal((quote.data as any).externalCapturedCents, 10334); assert.equal(quote.state, 'bound');
  const source = await prisma.storefrontCart.findUniqueOrThrow({ where: { merchantId_sessionId: { merchantId: f.merchantId, sessionId: f.cartId } } });
  assert.equal(source.discount, 777);
  const row = await prisma.couponRedemption.findFirstOrThrow({ where: { merchantId: f.merchantId } });
  assert.equal(row.discountApplied.toNumber(), 7.77); assert.equal(row.sessionId, f.cartId);
});

test('VERIFIER FIN-02 PG paid native V2 redeems only coupon777 exactly once, not combined1110', async () => {
  const f = await fixture(), session = await f.advanced(await f.coupon());
  await cash.reserveCheckout(session, 1000, 'reserve');
  const binding = await cash.preparePayment(session, 'paid-key'), payment = snapshot(session, binding); payment.idempotencyKey = 'paid-key';
  const authority = await capture(session, payment); assert.ok(authority); payment.creation!.couponAuthority = authority; await persist(payment);
  await cash.bindPayment(f.merchantId, f.sessionId, 'paid-key', payment.id, { earningQuoteId: binding.earningQuoteId!, reservationId: binding.reservationId!, cashbackCents: 1000 });
  const externalOrderId = `qa_fin_external_${f.id}`, eventId = `qa_fin_order_event_${f.id}`;
  // Synthetic approved/order facts; no PSP or notification is invoked here.
  await prisma.paymentIntent.update({ where: { id: payment.id }, data: { status: 'approved', approvedAmountCents: 10334, providerPaymentId: externalOrderId } });
  await prisma.completedOrder.create({ data: { merchantId: f.merchantId, sessionId: f.sessionId, externalOrderId,
    orderTotal: 102.35, currency: 'BRL', completedAt: new Date() } });
  await prisma.outboxMessage.create({ data: { eventId, eventType: 'order.completed', producer: 'checkout', schemaVersion: 1,
    merchantId: f.merchantId, occurredAt: new Date(), correlationId: eventId, causationId: payment.id,
    payload: json({ session_id: f.sessionId, external_order_id: externalOrderId, payment_intent_id: payment.id,
      coupon_authority: { ...authority, orderId: externalOrderId } }) } });
  const consumer = new PrismaBoundCouponRedemption(prisma);
  await consumer.redeem({ merchantId: f.merchantId, eventId }); await consumer.redeem({ merchantId: f.merchantId, eventId });
  const redeemed = await prisma.couponRedemption.findFirstOrThrow({ where: { merchantId: f.merchantId } });
  assert.equal(redeemed.status, 'redeemed'); assert.equal(redeemed.discountApplied.toNumber(), 7.77); assert.equal(redeemed.orderId, externalOrderId);
  assert.equal((await prisma.coupon.findUniqueOrThrow({ where: { id: f.couponId } })).usagesCount, 1);
  const receipts = await prisma.outboxMessage.findMany({ where: { merchantId: f.merchantId, eventType: 'coupon.redeemed' } });
  assert.equal(receipts.length, 1); assert.equal((receipts[0]!.payload as any).discount_applied, 7.77);
});

test('VERIFIER FIN-03 embedded promotion1234 counts once against original12345 and earns475 on9501', async () => {
  const f = await fixture({ native: false, promotionCents: 1234 }), session = await f.advanced(await f.coupon());
  const quote = await cash.quoteCheckout(session); assert.equal(quote.maximumRedeemCents, 656);
  await cash.reserveCheckout(session, 500, 'reserve'); await cash.preparePayment(session, 'promotion-key');
  const row = await prisma.cashbackEarningQuote.findFirstOrThrow({ where: { merchantId: f.merchantId } });
  assert.equal((row.data as any).baseCents, 9501); assert.equal((row.data as any).earnCents, 475);
  assert.equal((row.data as any).orderTotalCents, 9501);
  assert.equal(12345 - 1234 - 777 - 333 - 500, 9501);
});

test('VERIFIER FIN-04 embedded promotion leaves766 cap headroom and rejects coupon777 before journal/cart changes', async () => {
  const f = await fixture({ native: false, promotionCents: 1234, capCents: 2000 });
  const before = await effects(f.merchantId); await assert.rejects(f.coupon(), /cashback_combined_cap_exceeded/);
  const after = await effects(f.merchantId);
  assert.deepEqual(after.session, before.session); assert.deepEqual(after.ledger, before.ledger); assert.deepEqual(after.journal, before.journal);
  assert.equal(after.redemptions.length, 1); assert.equal(after.redemptions[0]!.status, 'cancelled');
});

test('VERIFIER FIN-05 immutable V1 journal stays V1 after enabling new policy and cannot be rebound while pending', async () => {
  const f = await fixture({ active: false }), session = await f.coupon(), payment = snapshot(session);
  const authority = await capture(session, payment); assert.ok(authority); assert.equal(authority.version, 1);
  payment.creation!.couponAuthority = authority; await persist(payment);
  await cash.saveDraft(f.merchantId, f.rules, 'qa-owner'); await cash.publishProgram(f.merchantId, 'qa-owner', { requireCombination: true });
  const before = await effects(f.merchantId); await assert.rejects(f.advanced(await f.current()), /cashback_payment_in_progress/);
  assert.deepEqual(await effects(f.merchantId), before);
  const stored = await prisma.paymentIntent.findUniqueOrThrow({ where: { id: payment.id } });
  assert.deepEqual(readPaymentCouponAuthority({ ...payment, creation: stored.creation }), authority);
  const storedCheckout = await prisma.checkoutSession.findUniqueOrThrow({ where: { merchantId_sessionId: { merchantId: f.merchantId, sessionId: f.sessionId } } });
  assert.equal(readStoredCheckoutCouponBinding(storedCheckout.cart)!.version, 1);
  assert.equal(payment.amountCents, 11667);
});

test('VERIFIER FIN-06 exact buyer/source scope cannot be substituted to capture the same total', async () => {
  const f = await fixture(), session = await f.advanced(await f.coupon()), payment = snapshot(session);
  const before = await effects(f.merchantId);
  await assert.rejects(capture(session, payment, `qa_other_buyer_${f.id}`), /checkout_coupon_binding_conflict/);
  assert.deepEqual(await effects(f.merchantId), before);
  await prisma.storefrontCart.update({ where: { merchantId_sessionId: { merchantId: f.merchantId, sessionId: f.cartId } }, data: { discount: 1110 } });
  const sourceBefore = await effects(f.merchantId); await assert.rejects(capture(session, payment), /checkout_coupon_binding_conflict/);
  assert.deepEqual(await effects(f.merchantId), sourceBefore);
});

test('VERIFIER FIN-07 prepared payment holds cash and atomically rejects a changed cart', async () => {
  const f = await fixture({ native: false }), session = await f.advanced(await f.coupon());
  await cash.reserveCheckout(session, 1000, 'reserve'); await cash.preparePayment(session, 'held-key');
  const before = await effects(f.merchantId), next = { ...structuredClone(session), cart: { ...structuredClone(session.cart), total: 246.9,
    items: session.cart.items.map(item => ({ ...item, quantity: 2 })) } };
  await assert.rejects(checkout.commitCommercialMutation({ expected: session, next }), /cashback_payment_in_progress/);
  assert.deepEqual(await effects(f.merchantId), before);
  assert.equal((await cash.wallet(f.merchantId, f.buyerId)).balance.reservedCents, 1000);
});

test('VERIFIER FIN-08 missing expected earning quote blocks worker resume before any PSP stub send', async () => {
  const f = await fixture({ native: false }), session = await f.advanced(await f.coupon());
  await cash.reserveCheckout(session, 1000, 'reserve'); const binding = await cash.preparePayment(session, 'missing-key');
  const payment = snapshot(session, binding); payment.idempotencyKey = 'missing-key'; await persist(payment);
  await prisma.cashbackEarningQuote.deleteMany({ where: { merchantId: f.merchantId } });
  const payments = new PrismaPaymentRepository(prisma), entity = (await payments.getIntentById(f.merchantId, payment.id))!;
  let sends = 0; const provider = { createPayment: async () => { sends++; throw new Error('provider_must_not_run'); } } as unknown as PaymentProviderPort;
  const worker = new ResumePaymentCreationService(payments, provider, undefined, checkout, cash);
  await assert.rejects(worker.execute(entity), /cashback_payment_binding_invalid/);
  await assert.rejects(worker.execute((await payments.getIntentById(f.merchantId, payment.id))!), /cashback_payment_binding_invalid/);
  assert.equal(sends, 0); assert.equal((await payments.getIntentById(f.merchantId, payment.id))!.snapshot().creation!.state, 'ready');
  assert.equal((await cash.wallet(f.merchantId, f.buyerId)).balance.reservedCents, 1000);
});

for (const order of ['coupon-first', 'rule-first'] as const) test(`VERIFIER FIN-09 actual normal ${order} receipts capture11444 and preserve567 award through first-send retry`, async () => {
  const f = await fixture(), targetId = `qa_fin_target_${f.id}`, targetVariant = `qa_fin_target_variant_${f.id}`;
  await prisma.product.create({ data: { id: targetId, merchantId: f.merchantId, name: 'Independent accepted target', type: 'digital',
    metadata: { downloadUrl: 'https://cashback.invalid/synthetic-target.pdf' } } });
  await prisma.productVariant.create({ data: { id: targetVariant, productId: targetId, sku: 'VERIFYTARGET' } });
  await prisma.productPrice.create({ data: { variantId: targetVariant, basePriceInCents: 2000, costInCents: 200, currency: 'BRL' } });
  const promotionId = `qa_fin_promo_${f.id}`, suggestionId = `qa_fin_suggestion_${f.id}`;
  await prisma.crossSellPromotion.create({ data: { id: promotionId, merchantId: f.merchantId, name: 'Independent actual promotion',
    trigger: { sku_in_cart: [f.id] }, recommendedSkus: ['VERIFYTARGET'], discountPercent: 10, maxDiscountPercent: 20,
    startsAt: new Date('2000-01-01') } });
  await prisma.crossSellSuggestion.create({ data: { id: suggestionId, merchantId: f.merchantId, sessionId: f.sessionId,
    promoId: promotionId, rankedItems: ['VERIFYTARGET'], agentCopy: 'Synthetic offer', computedDiscount: 10, suggestedAt: new Date() } });
  const normal = new PrismaNormalCheckoutCrossSellAdapter(prisma, journal), scope = { merchantId: f.merchantId, sessionId: f.sessionId };
  const offerQuote = await normal.quote(scope, { suggestion_id: suggestionId, targets: [{ sku: 'VERIFYTARGET', variant_id: targetVariant, quantity: 1 }] });
  await normal.accept(scope, { suggestion_id: suggestionId, accepted_skus: ['VERIFYTARGET'], expected_quote: offerQuote });
  let session = await normal.read(scope);
  assert.equal(session.cart.total, 141.45); assert.equal(session.cart.discountBudget!.originalSubtotalCents, 14345);
  assert.equal(session.cart.discountBudget!.promotionDiscountCents, 200);
  await cash.reserveCheckout(session, 2800, 'normal-initial');
  const offerId = `qa_fin_normal_rule_${f.id}`;
  await prisma.authorizedOffer.create({ data: { id: offerId, ...scope, approved: true, type: 'discount_fixed', value: 3.33,
    marginAfterOffer: 0.7, reason: 'Synthetic actual normal rule', expiresAt: new Date(Date.now() + 600000) } });
  if (order === 'coupon-first') {
    session = await f.coupon();
    session = (await normal.applyOffer(scope, { expectedVersion: session.persistenceVersion!, offerId })).session;
  } else {
    session = (await normal.applyOffer(scope, { expectedVersion: session.persistenceVersion!, offerId })).session;
    session = await f.coupon();
  }
  session = await normal.read(scope);
  assert.equal(Math.round(session.cart.currentDiscount! * 100), 1110);
  assert.equal((await cash.quoteCheckout(session)).reservedCents, 1690);
  assert.equal(await prisma.outboxMessage.count({ where: { merchantId: f.merchantId, eventType: 'cross-sell.offer.accepted' } }), 1);
  assert.equal(await prisma.checkoutEvent.count({ where: { merchantId: f.merchantId, eventName: 'cross_sell_accepted' } }), 1);
  const payments = new PrismaPaymentRepository(prisma, captureStorefrontCouponForPayment, undefined,
    createNormalCrossSellPaymentAdmission(async (tx, selectedScope, options) => {
      const current = await readNormalCheckoutCrossSellAuthority(tx, selectedScope, undefined, options);
      return { ...current, projectedCart: projectNormalCrossSellCart(current) };
    }, () => 99));
  const sent: number[] = [];
  const provider: PaymentProviderPort = { preparePayment: async input => input, createPayment: async input => {
    const bound = await prisma.cashbackEarningQuote.findFirstOrThrow({ where: { merchantId: f.merchantId, paymentIntentId: input.intentId } });
    assert.equal(bound.state, 'bound'); assert.equal((bound.data as any).cashbackCents, 1690);
    sent.push(input.amountCents); return { providerPaymentId: `qa_psp_${f.id}`, status: 'requires_action', buyerFacingPayload: { qrCodeCopyPaste: 'synthetic' } };
  }, recoverPayment: async () => null };
  const command = new CreatePaymentIntentUseCase(checkout, new PrismaMerchantRepository(prisma), payments, provider,
    undefined, undefined, undefined, undefined, checkout, undefined, undefined, undefined, prisma, undefined, undefined, undefined, undefined, cash);
  const body = { merchant_id: f.merchantId, session_id: f.sessionId, idempotency_key: `qa_normal_payment_${f.id}`, method: 'pix' as const };
  const context = { marketplaceSurface: 'embed' as const, storefrontCouponScope: {
    merchantId: f.merchantId, checkoutSessionId: f.sessionId, cartId: f.cartId, buyerId: f.buyerId } };
  if (order === 'rule-first') {
    // Explicit interruption after the real financial snapshot/journal exists,
    // before any provider send. All subsequent binding and source reads are real.
    const bind = cash.bindPayment.bind(cash); let interrupted = false;
    cash.bindPayment = async (...args: Parameters<CashbackService['bindPayment']>) => {
      if (args[0] === f.merchantId && !interrupted) { interrupted = true; throw new Error('verifier_pause_before_send'); }
      return bind(...args);
    };
    try { await assert.rejects(command.execute(body, context), /verifier_pause_before_send/); }
    finally { cash.bindPayment = bind; }
    assert.equal(sent.length, 0);
    await cash.saveDraft(f.merchantId, { ...f.rules, earnRateBps: 9000,
      combination: { ...f.rules.combination!, allowCoupons: false, maximumCombinedDiscountCents: 2000 } }, 'qa-owner');
    await cash.publishProgram(f.merchantId, 'qa-owner', { requireCombination: true });
  }
  const created = await command.execute(body, context);
  assert.equal(created.amountCents, 11444); assert.deepEqual(sent, [11444]);
  const saved = (await payments.getIntentById(f.merchantId, created.id))!.snapshot(), authority = saved.creation!.normalCrossSellAuthority!;
  assert.equal(authority.version, 2); assert.equal(authority.amountBreakdown.discountCents, 1110);
  assert.equal(authority.amountBreakdown.cashbackCents, 1690); assert.equal(authority.discountOwner!.kind, 'cashback_combination');
  if (authority.discountOwner!.kind !== 'cashback_combination') assert.fail();
  assert.equal(authority.discountOwner.coupon!.discountCents, 777); assert.equal(authority.discountOwner.advanced!.discountCents, 333);
  assert.equal(authority.discountOwner.cashbackRuleVersion, 1);
  assert.equal(saved.creation!.couponAuthority!.discountCents, 777);
  assert.equal(saved.creation!.couponAuthority!.version === 2 && saved.creation!.couponAuthority!.combinedDiscountCents, 1110);
  const earning = await prisma.cashbackEarningQuote.findFirstOrThrow({ where: { merchantId: f.merchantId } });
  assert.equal((earning.data as any).baseCents, 11345); assert.equal((earning.data as any).earnCents, 567);
  assert.equal((earning.data as any).externalCapturedCents, 11444);
});

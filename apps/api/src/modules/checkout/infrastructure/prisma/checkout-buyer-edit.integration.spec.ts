import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaCheckoutRepository } from "./prisma-checkout.repository.js";
import { PrismaPaymentRepository } from "../../../payment/infrastructure/prisma-payment.repository.js";
import { PaymentIntentEntity } from "../../../payment/domain/payment-intent.entity.js";
import { CancelCheckoutPaymentUseCase } from "../../../payment/application/cancel-checkout-payment.use-case.js";
import { ReopenEmbedCheckoutUseCase } from "../../../embed/application/reopen-embed-checkout.use-case.js";
import { ApplyCouponUseCase } from "../../../coupons/application/use-cases/apply-coupon.use-case.js";
import { PrismaCouponRepository } from "../../../coupons/infrastructure/repositories/prisma-coupon.repository.js";
import { PrismaCouponTransactionRepository } from "../../../coupons/infrastructure/repositories/prisma-coupon-transaction.repository.js";
import { RulesEngineDiscountAdapter } from "../../../coupons/infrastructure/adapters/rules-engine-discount.adapter.js";
import { CheckoutBenefitsService } from "../../application/services/checkout-benefits.service.js";
import { CheckoutSavedAddressService } from "../../application/services/checkout-saved-address.service.js";
import { PrismaBuyerAddressRepository } from "../../../buyer-account/infrastructure/prisma-buyer-address.repository.js";
import { PrismaBuyerAccountRepository } from "../../../buyer-account/infrastructure/prisma-buyer-account.repository.js";
import { ListBuyerAddressesUseCase } from "../../../buyer-account/application/use-cases/list-buyer-addresses.use-case.js";
import { checkoutSession, merchantRules } from "../../__tests__/checkout-test-fixtures.js";
import { buildExperienceFromSession } from "../../application/services/checkout-experience.service.js";

const url = new URL(process.env.CHECKOUT_EDIT_TEST_DATABASE_URL ?? "postgresql://invalid/disabled");
const enabled = url.hostname === "127.0.0.1" && url.port === "56528" && url.pathname === "/checkout_edits_qa";
const prisma = new PrismaClient({ datasources: { db: { url: url.toString() } } });
const sessions = new PrismaCheckoutRepository(prisma), payments = new PrismaPaymentRepository(prisma);
const coupons = new ApplyCouponUseCase(new PrismaCouponRepository(prisma), new PrismaCouponTransactionRepository(prisma), new RulesEngineDiscountAdapter(), prisma);
const integration = (name: string, fn: () => Promise<void>) => test(name, { skip: !enabled, timeout: 30_000 }, fn);
before(async () => { if (enabled) await prisma.$connect(); });
after(async () => { await prisma.$disconnect(); });

async function seed(total = 300) {
  const merchantId = `edit_qa_${randomUUID()}`, sessionId = randomUUID(), buyerId = randomUUID();
  await prisma.merchant.create({ data: { id: merchantId, name: "Checkout editing QA" } });
  await prisma.merchantRule.create({ data: { merchantId, ...merchantRules({ allowFreeShipping: false }) } });
  const session = checkoutSession({ merchantId, sessionId, globalUserId: buyerId,
    cart: { currency: "BRL", total, items: [{ sku: "kit", name: "Kit QA", price: total, cost: total * .4, quantity: 1 }] },
    customer: { email: `${buyerId}@example.test`, email_verified: true, address_verified: true,
      address: { zip: "01310100", street: "Paulista", number: "100", complement: "", neighborhood: "Bela Vista", city: "São Paulo", state: "SP" } } });
  await sessions.saveSession(session);
  return (await sessions.getSession(merchantId, sessionId))!;
}

async function pending(session: Awaited<ReturnType<typeof seed>>, method: "pix" | "card" = "pix") {
  const intent = PaymentIntentEntity.create({ merchantId: session.merchantId, sessionId: session.sessionId, method,
    amountCents: 33599, currency: "BRL", idempotencyKey: randomUUID() });
  intent.prepareCreation({ merchantId: session.merchantId, sessionId: session.sessionId, intentId: intent.id, method,
    amountCents: 33599, currency: "BRL", provider: "asaas", providerAccountFingerprint: "qa-frozen-route", settlementMode: "immediate_split" });
  intent.markRequiresAction({ providerPaymentId: `pay_qa_${intent.id}` });
  await payments.saveIntent({ intent });
  return intent;
}

function reopening(state: "cancelled" | "unknown", calls: string[]) {
  const provider = { createPayment: async () => { throw new Error("No real payment allowed in QA"); },
    cancelPayment: async (input: { providerPaymentId: string }) => { calls.push(input.providerPaymentId); return { state }; } };
  return new ReopenEmbedCheckoutUseCase(sessions, new CancelCheckoutPaymentUseCase(payments, provider), { platformFeeBrl: .99 } as never);
}

integration("confirmed cancellation reopens one persisted checkout; an uncertain cancellation never mutates totals", async () => {
  const session = await seed(); session.paymentMethod = "pix"; session.cart.currentDiscount = 30;
  await sessions.saveSession(session); const old = await pending(session), calls: string[] = [];
  await assert.rejects(reopening("unknown", calls).execute(session.merchantId, session.sessionId, "payment"), /unconfirmed/);
  assert.equal((await sessions.getSession(session.merchantId, session.sessionId))?.cart.currentDiscount, 30);
  await assert.rejects(pending(session, "card"));
  const result = await reopening("cancelled", calls).execute(session.merchantId, session.sessionId, "payment");
  assert.equal((await payments.getIntentById(session.merchantId, old.id))?.snapshot().status, "cancelled");
  assert.equal((await sessions.getSession(session.merchantId, session.sessionId))?.paymentMethod, undefined);
  assert.equal(result.experience.totals.total_to_pay, 335.99);
  assert.ok(result.revision! > 1);
  await pending((await sessions.getSession(session.merchantId, session.sessionId))!, "card");
  assert.equal((await payments.listForSession(session.merchantId, session.sessionId)).length, 2);
  await assert.rejects(reopening("cancelled", calls).execute("another-merchant", session.sessionId, "payment"));
});

integration("merchant locks prevent two simultaneous payment intents after reopening", async () => {
  const session = await seed();
  const results = await Promise.allSettled([pending(session), pending(session, "card")]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal((await payments.listForSession(session.merchantId, session.sessionId)).length, 1);
});

integration("eligible EDITQA10 coupon updates the authoritative total, cancels its reservation on edit and can be applied again once", async () => {
  const session = await seed();
  await prisma.coupon.create({ data: { id: randomUUID(), merchantId: session.merchantId, code: "EDITQA10", discountType: "percent",
    discountValue: 10, minCartTotal: 100, maxUsages: 3, maxPerBuyer: 1, allowedSkus: ["kit"], startsAt: new Date(Date.now() - 1000) } });
  const apply = async () => coupons.executeForCheckout({ merchant_id: session.merchantId, session_id: session.sessionId, code: "EDITQA10",
    expectedVersion: (await sessions.getSession(session.merchantId, session.sessionId))!.persistenceVersion });
  const first = await apply();
  assert.equal(first.result.discount_applied, 30);
  assert.equal(buildExperienceFromSession(first.session, { serviceFee: .99 }).totals.total_to_pay, 305.99);
  await assert.rejects(apply(), /ALREADY_APPLIED/);
  await sessions.reopenForBuyerEdit(session.merchantId, session.sessionId, "payment");
  assert.equal((await prisma.couponRedemption.findFirstOrThrow({ where: { merchantId: session.merchantId } })).status, "cancelled");
  const again = await apply(); assert.equal(again.result.discount_applied, 30);
  assert.equal(await prisma.couponRedemption.count({ where: { merchantId: session.merchantId } }), 1);
  await pending(again.session);
  await assert.rejects(apply(), /NOT_MUTABLE/);
  const below = await seed(90);
  await prisma.coupon.create({ data: { id: randomUUID(), merchantId: below.merchantId, code: "EDITQA10", discountType: "percent",
    discountValue: 10, minCartTotal: 100, startsAt: new Date(Date.now() - 1000) } });
  await assert.rejects(coupons.executeForCheckout({ merchant_id: below.merchantId, session_id: below.sessionId, code: "EDITQA10",
    expectedVersion: below.persistenceVersion }), /COUPON_MIN_CART_NOT_MET/);
  assert.equal((await sessions.getSession(below.merchantId, below.sessionId))?.cart.currentDiscount ?? 0, 0);
});

integration("progressive discount is persisted, capped by merchant rules and never compounded on retries or method changes", async () => {
  const session = await seed();
  const service = new CheckoutBenefitsService(sessions, sessions, { getContext: async () => ({ checkout_settings: {
    progressive_discount: { enabled: true, stages: { initial_coupon: 5, exit_intent: 5, abandoned_cart: 10, payment_nudge: 15 } } } }),
    getInterventionConfig: async () => ({ advancedRules: [] }) } as never, payments, coupons);
  const first = await service.prepare(session.merchantId, session.sessionId, "pix");
  assert.equal(first.cart.currentDiscount, 30); // 15% requested; merchant cap is 10%.
  assert.equal((await service.prepare(session.merchantId, session.sessionId, "pix")).cart.currentDiscount, 30);
  await sessions.reopenForBuyerEdit(session.merchantId, session.sessionId, "payment");
  const changed = await service.prepare(session.merchantId, session.sessionId, "card");
  assert.equal(changed.cart.currentDiscount, 30);
  assert.equal(buildExperienceFromSession(changed, { serviceFee: .99 }).totals.total_to_pay, 305.99);
});

integration("named workplace address persists beside the original default and is reusable by the verified buyer", async () => {
  const session = await seed(), original = session.customer!.address!;
  await prisma.buyerAccount.create({ data: { globalUserId: session.globalUserId, email: session.customer!.email!, displayName: "Fixture Buyer", passwordHash: "qa-unusable", address: original } });
  const addresses = new PrismaBuyerAddressRepository(prisma);
  const service = new CheckoutSavedAddressService(addresses, new ListBuyerAddressesUseCase(addresses, new PrismaBuyerAccountRepository(prisma)));
  session.customer = { ...session.customer, deliveryAddressLabel: "Trabalho", address: { ...original, street: "Rua do Trabalho", number: "42" } };
  assert.equal(await service.saveComplete(session), true);
  assert.equal(await service.saveComplete(session), true);
  const list = await addresses.list(session.globalUserId);
  assert.equal(list.length, 2); assert.equal(list.find(item => item.isDefault)?.street, original.street);
  assert.equal(list.find(item => item.label === "Trabalho")?.number, "42");
  const selected = await service.resolve(session, "Quero entregar no trabalho");
  assert.equal(selected?.session.customer?.address?.street, "Rua do Trabalho");
  assert.equal(selected?.session.customer?.address_verified, false);
  assert.equal(await service.resolve({ ...session, customer: { ...session.customer, email_verified: false } }, "Quero entregar no trabalho"), undefined);
});

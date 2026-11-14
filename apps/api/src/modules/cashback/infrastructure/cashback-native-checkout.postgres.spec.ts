import "reflect-metadata";
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { PrismaClient, Prisma } from "@prisma/client";
import { Module } from "@nestjs/common";
import { NestFactory, Reflector } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import type { AuthorizedOffer, CashbackRules } from "@zyon/shared-types";
import { CashbackRepository } from "./cashback.repository.js";
import { CashbackService } from "../application/cashback.service.js";
import { CheckoutCommercialBenefitsService } from "../application/checkout-commercial-benefits.service.js";
import { CashbackErrorFilter } from "../presentation/cashback-error.filter.js";
import { ApplyCouponUseCase } from "../../coupons/application/use-cases/apply-coupon.use-case.js";
import { RulesEngineDiscountAdapter } from "../../coupons/infrastructure/adapters/rules-engine-discount.adapter.js";
import { WidgetCouponsController } from "../../coupons/presentation/http/widget-coupons.controller.js";
import { PrismaCheckoutRepository } from "../../checkout/infrastructure/prisma/prisma-checkout.repository.js";
import { CHECKOUT_SESSION_REPOSITORY } from "../../checkout/domain/ports/checkout-session.repository.port.js";
import { CHECKOUT_EXPERIENCE_CONFIG } from "../../checkout/domain/checkout-experience.config.js";
import { MERCHANT_REPOSITORY } from "../../merchant/domain/ports/merchant-repository.port.js";
import { DEFAULT_RULES } from "../../merchant/domain/merchant-rules.defaults.js";
import { EmbedCheckoutGuardHelper } from "../../embed/presentation/http/embed-checkout.controller.js";
import { EmbedAuthGuard } from "../../embed/presentation/http/embed-auth.guard.js";
import { EmbedTokenService } from "../../embed/domain/embed-token.service.js";
import { lockCheckoutSessionAnchor } from "../../../shared/persistence/checkout-session-lock.js";
import { lockStorefrontCart } from "../../../shared/persistence/storefront-cart-lock.js";
import { captureStorefrontCouponForPayment, readStorefrontCouponForCheckout } from "../../../shared/persistence/storefront-coupon/admission.js";
import { readStoredCheckoutCouponBinding } from "../../checkout/domain/services/checkout-coupon-storage.js";
import { paymentCartFingerprint } from "../../checkout/domain/services/payment-cart-fingerprint.js";
import type { PaymentIntentSnapshot } from "../../payment/domain/payment-intent.entity.js";
import { PrismaNormalCheckoutCrossSellAdapter, projectNormalCrossSellCart } from "../../cross-sell/infrastructure/repositories/prisma-normal-checkout-cross-sell.adapter.js";
import { lockNormalCheckoutCrossSell, readNormalCheckoutCrossSellAuthority } from "../../cross-sell/infrastructure/repositories/prisma-normal-checkout-cross-sell.authority.js";
import { parseCheckoutCouponBinding } from "../../checkout/domain/services/checkout-coupon-binding.js";
import { toCheckoutSession } from "../../checkout/domain/services/checkout-session-projection.js";
import { CheckoutWhatsAppConversationAdapter } from "../../whatsapp-channel/infrastructure/adapters/checkout-whatsapp-conversation.adapter.js";
import { WhatsAppCheckoutBenefitsService } from "../../whatsapp-channel/application/services/whatsapp-checkout-benefits.service.js";
import type { WhatsAppConversationState } from "../../whatsapp-channel/domain/ui/meta-ui.types.js";
import { PrismaPaymentRepository } from "../../payment/infrastructure/prisma-payment.repository.js";
import { createNormalCrossSellPaymentAdmission } from "../../payment/infrastructure/prisma-normal-cross-sell-payment-admission.js";
import { CreatePaymentIntentUseCase } from "../../payment/application/create-payment-intent.use-case.js";
import { PrismaMerchantRepository } from "../../merchant/infrastructure/prisma-merchant.repository.js";
import type { PaymentProviderPort } from "../../payment/domain/ports/payment-provider.port.js";
import { CompleteOrderUseCase } from "../../checkout/application/use-cases/complete-order.use-case.js";
import { PrismaPaymentApprovalReader } from "../../checkout/infrastructure/adapters/prisma-payment-approval.reader.js";
import { PrismaBoundCouponRedemption } from "../../coupons/infrastructure/repositories/prisma-bound-coupon-redemption.js";
import { CheckoutOfferService } from "../../checkout/application/services/checkout-offer.service.js";

// An actual generated Prisma client and the candidate schema, only on local PG.
const baseUrl = "postgresql://cashback:cashback-local-test@127.0.0.1:15433/cashback";
const pg=createRequire(import.meta.url)("pg") as {Client:new(options:{connectionString:string})=>{
  connect():Promise<void>;query(sql:string):Promise<unknown>;end():Promise<void>}};
const schema = "cashback_native_" + randomUUID().replaceAll("-", "");
const url = `${baseUrl}?schema=${schema}`;
const db = new pg.Client({ connectionString: baseUrl });
let prisma: PrismaClient, cashback: CashbackService, benefits: CheckoutCommercialBenefitsService;
let coupons: ApplyCouponUseCase, sessions: PrismaCheckoutRepository, app: INestApplication, endpoint: string;
const origin = "https://qa.cashback.invalid";
const tokens = new EmbedTokenService({ value: Buffer.alloc(32, 7) });
const policy: CashbackRules = { earnRateBps: 500, minimumEarnCents: 0, maximumEarnPerOrderCents: null,
  buyerMonthlyEarnLimitCents: null, monthlyBudgetCents: null, releaseTrigger: "payment_confirmed", releaseDelayDays: 0,
  expiryDays: null, minimumRedeemOrderCents: 0, maximumRedeemBps: 9000, maximumRedeemCents: null,
  allowWithDiscounts: true, terms: "Credito de testes na mesma loja, sem contato ou provedor.",
  combination: { allowCoupons: true, allowAdvancedRules: true, limitMode: "cashback_specific",
    maximumCombinedDiscountBps: 3000, maximumCombinedDiscountCents: null } };

before(async () => {
  await db.connect(); await db.query(`CREATE SCHEMA "${schema}"`);
  const apiRoot = fileURLToPath(new URL("../../../../", import.meta.url));
  const cli = `${process.env.APPDATA}/npm/node_modules/pnpm/bin/pnpm.cjs`;
  const push = spawnSync(process.execPath, [cli, "exec", "prisma", "db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"],
    { cwd: apiRoot, env: { ...process.env, DATABASE_URL: url }, encoding: "utf8", timeout: 90000 });
  assert.equal(push.status, 0, push.stderr + push.stdout);
  prisma = new PrismaClient({ datasources: { db: { url } }, transactionOptions: { timeout: 20000, maxWait: 15000 } });
  await prisma.$connect();
  // db push does not create operational triggers. Use the exact deployed one.
  const trigger = await readFile(new URL("../../../../prisma/migrations/20260929020000_checkout_session_write_version/migration.sql", import.meta.url), "utf8");
  await db.query(`SET search_path TO "${schema}"`); await db.query(trigger);
  const repository = new CashbackRepository(prisma);
  benefits = new CheckoutCommercialBenefitsService(repository); cashback = new CashbackService(repository, benefits);
  sessions = new PrismaCheckoutRepository(prisma);
  coupons = new ApplyCouponUseCase({} as any, {} as any, new RulesEngineDiscountAdapter(), prisma, async(tx,scope)=>{
    const current=await readNormalCheckoutCrossSellAuthority(tx,scope);
    return toCheckoutSession({...current.stored,cart:projectNormalCrossSellCart(current)});
  }, benefits);
  // ready-prod-loader intentionally disables emitted constructor metadata.
  Reflect.defineMetadata("design:paramtypes", [ApplyCouponUseCase, EmbedCheckoutGuardHelper, Object, Object, Object, CashbackService], WidgetCouponsController);
  Reflect.defineMetadata("design:paramtypes", [EmbedTokenService, Reflector], EmbedAuthGuard);
  class CouponHttpProofModule {}
  Module({ controllers: [WidgetCouponsController], providers: [
    { provide: ApplyCouponUseCase, useValue: coupons },
    { provide: EmbedCheckoutGuardHelper, useValue: new EmbedCheckoutGuardHelper(sessions) },
    { provide: CHECKOUT_SESSION_REPOSITORY, useValue: sessions },
    { provide: MERCHANT_REPOSITORY, useValue: { getProfile: (id: string) => prisma.merchant.findUnique({ where: { id } }) } },
    { provide: CHECKOUT_EXPERIENCE_CONFIG, useValue: { platformFeeBrl: 0 } },
    { provide: CashbackService, useValue: cashback },
    { provide: EmbedTokenService, useValue: tokens }, Reflector,
    { provide: EmbedAuthGuard, useValue: new EmbedAuthGuard(tokens, new Reflector()) },
  ] })(CouponHttpProofModule);
  app = await NestFactory.create(CouponHttpProofModule, { logger: ["error"], abortOnError: false });
  app.setGlobalPrefix("v1"); app.useGlobalFilters(new CashbackErrorFilter());
  await app.listen(0, "127.0.0.1"); endpoint = await app.getUrl();
}, { timeout: 120000 });

after(async () => {
  await app?.close(); await prisma?.$disconnect();
  await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await db.end();
});

async function seed() {
  const suffix = randomUUID().replaceAll("-", "");
  const merchantId = "qa_" + suffix, buyerId = "buyer_" + suffix, sessionId = "checkout_" + suffix;
  const cartId = "cart_" + suffix, productId = "product_" + suffix, variantId = "variant_" + suffix;
  await prisma.merchant.create({ data: { id: merchantId, name: "Synthetic cashback" } });
  await sessions.setRules(merchantId, { ...DEFAULT_RULES, maxDiscountPercent: 20, minimumMarginPercent: 0, allowStackDiscountAndFreeShipping: true });
  await prisma.buyerAccount.create({ data: { globalUserId: buyerId, email: suffix + "@example.invalid", displayName: "Synthetic Buyer" } });
  await prisma.product.create({ data: { id: productId, merchantId, name: "Synthetic digital", type: "digital", metadata: {downloadUrl:"https://qa.cashback.invalid/file.pdf"} } });
  await prisma.productVariant.create({ data: { id: variantId, productId, sku: "SKU" } });
  await prisma.productPrice.create({ data: { variantId, basePriceInCents: 10000, costInCents: 2000, currency: "BRL" } });
  await prisma.coupon.create({ data: { id: "coupon_" + suffix, merchantId, code: "SAVE10", discountType: "fixed", discountValue: 10,
    maxUsages: 5, maxPerBuyer: 5, startsAt: new Date("2000-01-01"), endsAt: new Date("2100-01-01") } });
  await prisma.storefrontCart.create({ data: { merchantId, sessionId: cartId, total: 10000, expiresAt: new Date("2100-01-01"),
    items: [{ variantId, productId, sku: "SKU", name: "Synthetic digital", unitPriceCents: 10000, quantity: 1 }] } });
  await prisma.checkoutSession.create({ data: { id: sessionId, merchantId, sessionId, conversationId: cartId, globalUserId: buyerId,
    createdAt: new Date(), updatedAt: new Date(),
    cart: { source: "storefront", cart_ref: cartId, currency: "BRL", total: 100, currentDiscount: 0,
      items: [{ sku: "SKU", variantId, product_id: productId, name: "Synthetic digital", price: 100, cost: 20, quantity: 1,
        productType: "digital", fulfillmentStrategy: "digital" }] },
    customer: { fullName: "Synthetic Buyer", email: suffix + "@example.invalid", email_verified: true,
      phone: "5511990000000", phone_verified: true, address: { city: "Synthetic", state: "SP", zip: "01310100" } } } });
  await cashback.saveDraft(merchantId, policy, "qa-owner"); await cashback.publishProgram(merchantId, "qa-owner");
  await cashback.adjustWallet(merchantId, buyerId, { amountCents: 3000, expiryDays: null, reason: "Synthetic QA only", idempotencyKey: suffix }, "qa-owner");
  return (await sessions.getSession(merchantId, sessionId))!;
}
async function applyRule(session: NonNullable<Awaited<ReturnType<typeof sessions.getSession>>>) {
  const offer: AuthorizedOffer = { id: "offer_" + randomUUID(), merchantId: session.merchantId, sessionId: session.sessionId,
    approved: true, type: "discount_fixed", value: 5, marginAfterOffer: 0.7, reason: "Synthetic authorized rule",
    expiresAt: new Date(Date.now() + 60000).toISOString() };
  return (await benefits.applyAdvancedRule(session, offer))!;
}
function token(session: { merchantId: string; sessionId: string }, readOnly = false) {
  const now = Math.floor(Date.now() / 1000);
  return tokens.sign({ typ: "aacp_embed_v1", merchantId: session.merchantId, whatsappCheckoutSessionId: session.sessionId,
    issuedAtUnix: now, expiresAtUnix: now + 120, nonce: randomUUID(), allowedOrigin: origin,
    scopes: readOnly ? ["payment:intents:read"] : ["coupons:apply", "payment:intents:read"] });
}
async function postCoupon(session: { merchantId: string; sessionId: string }, readOnly = false) {
  return fetch(endpoint + "/v1/embed/coupons/apply", { method: "POST", headers: { "Content-Type": "application/json", Origin: origin,
    "x-aacp-embed-token": token(session, readOnly) }, body: JSON.stringify({ session_id: session.sessionId, code: "SAVE10",
    merchant_id: "forged", buyer_global_user_id: "forged", cart: { total: 0, items: [] } }) });
}

test("CS-06 real authenticated HTTP and native PG preserve rule 5 + coupon 10 + cashback 15 = 70", async () => {
  let session = await seed(); await cashback.reserveCheckout(session, 3000, "reserve_" + session.sessionId);
  session = await applyRule(session);
  const denied = await postCoupon(session, true); assert.equal(denied.status, 403, await denied.clone().text());
  assert.equal(await prisma.couponRedemption.count({ where: { merchantId: session.merchantId } }), 0);
  const response = await postCoupon(session); assert.equal(response.status, 201, await response.clone().text());
  const body = await response.json() as any;
  assert.equal(body.experience.totals.discount, 15); assert.equal(body.experience.totals.cashback_cents, 1500);
  assert.equal(body.experience.totals.total, 70); assert.equal(body.experience.totals.total_to_pay, 70);
  const actual = (await sessions.getSession(session.merchantId, session.sessionId))!;
  assert.equal(actual.persistenceVersion, 2); assert.equal(actual.cart.currentDiscount, 15);
  const source = await prisma.storefrontCart.findUniqueOrThrow({ where: { merchantId_sessionId: { merchantId: session.merchantId, sessionId: session.cart.cart_ref! } } });
  assert.equal(source.discount, 1000); assert.equal(source.couponCode, "SAVE10");
  const reservation = await prisma.couponRedemption.findFirstOrThrow({ where: { merchantId: session.merchantId } });
  assert.equal(reservation.discountApplied.toNumber(), 10); assert.equal(reservation.sessionId, session.cart.cart_ref);
});

test("CS-06 native PG coupon then rule captures V2 component identity without spending coupon 15", async () => {
  const initial = await seed(); await cashback.reserveCheckout(initial, 3000, "reserve_" + initial.sessionId);
  const coupon = await coupons.executeForCheckout({ merchant_id: initial.merchantId, session_id: initial.sessionId, code: "SAVE10", expectedVersion: initial.persistenceVersion });
  const session = await applyRule(coupon.session);
  assert.equal(session.persistenceVersion, 2); assert.equal((await cashback.quoteCheckout(session)).reservedCents, 1500);
  const binding = await cashback.preparePayment(session, "payment_" + initial.sessionId);
  assert.equal(binding.cashbackCents, 1500);
  const id = "payment_" + randomUUID();
  const snapshot = { id, merchantId: session.merchantId, sessionId: session.sessionId, idempotencyKey: id, version: 0,
    amountCents: 7000, currency: "BRL", method: "pix", status: "pending",
    amountBreakdown: { version: 1, currency: "BRL", itemsSubtotalCents: 10000, discountCents: 1500, cashbackCents: 1500,
      cashbackReservationId: binding.reservationId!, shippingCents: 0, platformFeeCents: 0, totalCents: 7000, cartFingerprint: paymentCartFingerprint(session) },
    creation: { state: "ready", input: { merchantId: session.merchantId, sessionId: session.sessionId, intentId: id,
      amountCents: 7000, currency: "BRL", method: "pix" } }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), statusHistory: [] } as PaymentIntentSnapshot;
  const authority = await prisma.$transaction(async tx => {
    await benefits.lockInTransaction(tx, session.merchantId);
    await tx.$queryRaw`SELECT id FROM merchants WHERE id=${session.merchantId} FOR UPDATE`;
    await lockCheckoutSessionAnchor(tx, session.merchantId, session.sessionId);
    await tx.$queryRaw`SELECT id FROM checkout_sessions WHERE merchant_id=${session.merchantId} AND session_id=${session.sessionId} FOR UPDATE`;
    await lockStorefrontCart(tx, session.merchantId, session.cart.cart_ref!);
    const candidate = await readStorefrontCouponForCheckout(tx, session, { requireVerifiedBuyer: true, requireRegion: true });
    assert.equal(candidate!.discountCents, 1000); assert.equal(candidate!.combinedDiscountCents, 1500);
    return captureStorefrontCouponForPayment(tx, snapshot, { merchantId: session.merchantId, checkoutSessionId: session.sessionId,
      cartId: session.cart.cart_ref!, buyerId: session.globalUserId });
  });
  assert.equal(authority!.version, 2); assert.equal(authority!.discountCents, 1000);
  assert.equal(authority!.version === 2 && authority!.combinedDiscountCents, 1500);
  const stored = await prisma.checkoutSession.findUniqueOrThrow({ where: { merchantId_sessionId: { merchantId: session.merchantId, sessionId: session.sessionId } } });
  assert.equal(readStoredCheckoutCouponBinding(stored.cart)!.version, 2); assert.equal(stored.version, 3);
  assert.equal((await prisma.couponRedemption.findFirstOrThrow({ where: { merchantId: session.merchantId } })).discountApplied.toNumber(), 10);
});

test("CS-04 forged commercial revision cannot turn a legacy source coupon into V2 authority", async () => {
  const initial = await seed();
  const applied = await coupons.executeForCheckout({ merchant_id: initial.merchantId, session_id: initial.sessionId, code: "SAVE10", expectedVersion: initial.persistenceVersion });
  const forged = { ...applied.session, cart: { ...applied.session.cart, currentDiscount: 15, commercialBenefitsVersion: 99 } };
  const before = await prisma.couponRedemption.findMany({ where: { merchantId: initial.merchantId } });
  await assert.rejects(prisma.$transaction(tx => readStorefrontCouponForCheckout(tx, forged)), /binding_conflict/);
  assert.deepEqual(await prisma.couponRedemption.findMany({ where: { merchantId: initial.merchantId } }), before);
});

async function acceptRealNormalOffer(standalone=false) {
  let initial = await seed();const suffix = randomUUID().replaceAll("-", "");
  if(standalone){
    const {cart_ref:_source,...cart}=initial.cart;
    await prisma.checkoutSession.update({where:{merchantId_sessionId:{merchantId:initial.merchantId,sessionId:initial.sessionId}},
      data:{cart:{...cart,source:"checkout"}as unknown as Prisma.InputJsonObject}});
    initial=(await sessions.getSession(initial.merchantId,initial.sessionId))!;
  }
  const productId = "target_" + suffix, variantId = "target_variant_" + suffix;
  await prisma.product.create({ data: { id: productId, merchantId: initial.merchantId, name: "Synthetic target", type: "digital", metadata: {downloadUrl:"https://qa.cashback.invalid/target.pdf"} } });
  await prisma.productVariant.create({ data: { id: variantId, productId, sku: "TARGET" } });
  await prisma.productPrice.create({ data: { variantId, basePriceInCents: 1000, costInCents: 100, currency: "BRL" } });
  const promotionId = "promotion_" + suffix, suggestionId = "suggestion_" + suffix;
  await prisma.crossSellPromotion.create({ data: { id: promotionId, merchantId: initial.merchantId, name: "Synthetic real offer",
    trigger: { sku_in_cart: ["SKU"] }, recommendedSkus: ["TARGET"], discountPercent: 10, maxDiscountPercent: 20,
    startsAt: new Date("2000-01-01") } });
  await prisma.crossSellSuggestion.create({ data: { id: suggestionId, merchantId: initial.merchantId, sessionId: initial.sessionId,
    promoId: promotionId, rankedItems: ["TARGET"], agentCopy: "Synthetic", computedDiscount: 10, suggestedAt: new Date() } });
  const adapter = new PrismaNormalCheckoutCrossSellAdapter(prisma, benefits), scope = { merchantId: initial.merchantId, sessionId: initial.sessionId };
  const quote = await adapter.quote(scope, { suggestion_id: suggestionId, targets: [{ sku: "TARGET", variant_id: variantId, quantity: 1 }] });
  const ack = await adapter.accept(scope, { suggestion_id: suggestionId, accepted_skus: ["TARGET"], expected_quote: quote });
  const session = await adapter.read(scope);
  assert.equal(ack.persistenceVersion, standalone?2:1); assert.equal(session.cart.total, 109);
  assert.equal(session.cart.discountBudget!.promotionDiscountCents, 100);
  assert.equal(await prisma.outboxMessage.count({ where: { merchantId: initial.merchantId, eventType: "cross-sell.offer.accepted" } }), 1);
  const offer = await prisma.authorizedOffer.create({ data: { id: "approved_" + suffix, ...scope,
    type: "discount_fixed", value: 5, marginAfterOffer: .7, approved: true, reason: "Synthetic actual approved offer",
    expiresAt: new Date(Date.now() + 600000) } });
  return { adapter, scope, session, offer };
}

for (const order of ["coupon-first", "rule-first"] as const) test(`CS-06 real normal receipt + ${order} keeps C/A/cash distinct`, async () => {
  const f = await acceptRealNormalOffer(); let session = f.session;
  await cashback.reserveCheckout(session, 3000, "normal_reserve_" + session.sessionId);
  if (order === "coupon-first") {
    session = (await coupons.executeForCheckout({ merchant_id: session.merchantId, session_id: session.sessionId,
      code: "SAVE10", expectedVersion: session.persistenceVersion })).session;
    session = (await f.adapter.applyOffer(f.scope, { expectedVersion: session.persistenceVersion, offerId: f.offer.id })).session;
  } else {
    session = (await f.adapter.applyOffer(f.scope, { expectedVersion: session.persistenceVersion, offerId: f.offer.id })).session;
    session = (await coupons.executeForCheckout({ merchant_id: session.merchantId, session_id: session.sessionId,
      code: "SAVE10", expectedVersion: session.persistenceVersion })).session;
  }
  const actual = await f.adapter.read(f.scope);
  assert.equal(actual.persistenceVersion, 3); assert.equal(actual.cart.currentDiscount, 15);
  const quote = await cashback.quoteCheckout(actual);
  assert.equal(quote.reservedCents, 1700); // 30% of 110, minus embedded promotion 1, C10 and A5.
  assert.equal(10900 - 1500 - quote.reservedCents, 7700);
  const authority = await prisma.$transaction(async tx => {
    await benefits.lockInTransaction(tx, session.merchantId); await lockNormalCheckoutCrossSell(tx, f.scope);
    return readNormalCheckoutCrossSellAuthority(tx, f.scope);
  });
  const owner=authority.discountOwner;assert.ok(owner);
  assert.equal(owner.kind, "cashback_combination");
  if (owner.kind !== "cashback_combination") assert.fail();
  assert.equal(owner.coupon!.discountCents, 1000);
  assert.equal(owner.advanced!.discountCents, 500);
  assert.equal(owner.discountCents, 1500); assert.equal(owner.cashbackRuleVersion, 1);
  const source = await prisma.storefrontCart.findUniqueOrThrow({ where: { merchantId_sessionId: { merchantId: session.merchantId, sessionId: session.cart.cart_ref! } } });
  assert.equal(source.discount, 1000);
  const updated = await f.adapter.updateCart(f.scope, { expectedVersion: actual.persistenceVersion,
    items: [{ sku: "SKU", quantity: 2 }] });
  assert.equal(updated.persistenceVersion, 4); assert.equal(updated.cart.currentDiscount, 10);
  assert.equal((await cashback.quoteCheckout(updated)).reservedCents, 0);
  assert.equal((await f.adapter.read(f.scope)).cart.currentDiscount, 10);
});

for(const failedHistory of [false,true])test(`CS-06 exact private V1 binding ${failedHistory?"refuses rewrite after failed payment":"upgrades before any payment"}`, async () => {
  const initial = await seed();
  let session = (await coupons.executeForCheckout({ merchant_id: initial.merchantId, session_id: initial.sessionId,
    code: "SAVE10", expectedVersion: initial.persistenceVersion })).session;
  const candidate = await prisma.$transaction(tx => readStorefrontCouponForCheckout(tx, session, { requireVerifiedBuyer: true, requireRegion: true }));
  assert.ok(candidate);
  const binding = parseCheckoutCouponBinding({ version: 1, state: "active", bindingId: randomUUID(), merchantId: session.merchantId,
    cartId: candidate.cartId, checkoutSessionId: session.sessionId, buyerId: session.globalUserId,
    reservationBuyerId: candidate.reservationBuyerId, redemptionId: candidate.redemptionId, couponId: candidate.couponId,
    discountCents: 1000, basisHash: paymentCartFingerprint(session) });
  await prisma.checkoutSession.update({ where: { merchantId_sessionId: { merchantId: session.merchantId, sessionId: session.sessionId } },
    data: { cart: { ...session.cart, _storefrontCouponBinding: binding } as unknown as Prisma.InputJsonObject } });
  session = (await sessions.getSession(session.merchantId, session.sessionId))!;
  if(failedHistory){
    await prisma.paymentIntent.create({data:{id:randomUUID(),merchantId:session.merchantId,sessionId:session.sessionId,
      idempotencyKey:randomUUID(),amountCents:9000,currency:"BRL",method:"pix",status:"failed"}});
    const before=await prisma.checkoutSession.findUniqueOrThrow({where:{merchantId_sessionId:{merchantId:session.merchantId,sessionId:session.sessionId}}});
    await assert.rejects(applyRule(session),error=>Boolean(error&&typeof error==="object"&&"code"in error&&error.code==="cashback_payment_requires_reopen"));
    assert.deepEqual(await prisma.checkoutSession.findUniqueOrThrow({where:{merchantId_sessionId:{merchantId:session.merchantId,sessionId:session.sessionId}}}),before);
    assert.equal((await sessions.getSession(session.merchantId,session.sessionId))!.cart.currentDiscount,10);
    return;
  }
  const next = await applyRule(session);
  assert.equal(next.cart.currentDiscount, 15);
  const stored = await prisma.checkoutSession.findUniqueOrThrow({ where: { merchantId_sessionId: { merchantId: session.merchantId, sessionId: session.sessionId } } });
  const upgraded = readStoredCheckoutCouponBinding(stored.cart)!;
  assert.equal(upgraded.version, 2); assert.equal(upgraded.bindingId, binding.bindingId);
  assert.equal(upgraded.version === 2 && upgraded.combinedDiscountCents, 1500);
  assert.equal((await sessions.getSession(session.merchantId, session.sessionId))!.cart.currentDiscount, 15);
  assert.equal(await prisma.paymentIntent.count({ where: { merchantId: session.merchantId } }), 0);
});

function nativeAdapter(){
  const merchants={getRules:(id:string)=>sessions.getRules(id),getProfile:(id:string)=>prisma.merchant.findUnique({where:{id}})};
  const commands=new WhatsAppCheckoutBenefitsService(benefits,cashback,coupons,{execute:async()=>{throw Error("unexpected_offer");}}as any,merchants as any,{platformFeeBrl:0});
  const unexpected={execute:async()=>{throw Error("model_or_provider_must_not_run");}};
  return new CheckoutWhatsAppConversationAdapter(unexpected as any,sessions,unexpected as any,
    {executeForMerchant:async()=>({name:"Synthetic Store",agentTone:"consultative"})}as any,
    undefined,undefined,undefined,undefined,undefined,undefined,prisma,
    undefined,undefined,undefined,coupons,undefined,{platformFeeBrl:0},undefined,undefined,undefined,undefined,cashback,commands);
}

test("CS-06 actual Meta respondStore path uses same canonical wallet and coupon transaction, with quantities and total", async () => {
  const initial=await seed();let session=await applyRule(initial);
  await cashback.reserveCheckout(session,2500,"meta_reserve_"+session.sessionId);
  const adapter=nativeAdapter();
  const state:WhatsAppConversationState={version:1,conversationId:session.cart.cart_ref!,checkoutSessionId:session.sessionId,
    stage:"checkout",history:[],revision:"synthetic",page:0,previousViews:[]};
  const input={merchantId:session.merchantId,buyer:{globalUserId:session.globalUserId,phone:session.customer!.phone!},state,
    message:"Aplicar cupom SAVE10",messageId:randomUUID()};
  const denied=await adapter.respondStore({...input,buyer:{...input.buyer,phone:"5511888888888"}});
  assert.match(denied.agentMessage,/identidade/);
  assert.equal(await prisma.couponRedemption.count({where:{merchantId:session.merchantId}}),0);
  const result=await adapter.respondStore(input);
  const summary=result.blocks.find(block=>block.type==="checkout_summary")!;
  assert.ok(summary);const data=summary.data as any;
  assert.equal(data.items[0].quantity,1);assert.equal(data.totals.discount,15);
  assert.equal(data.totals.cashback_cents,1500);assert.equal(data.totals.total_to_pay,70);
  assert.match(result.agentMessage,/70,00/);assert.equal(result.state.checkoutSessionId,session.sessionId);
  session=(await sessions.getSession(session.merchantId,session.sessionId))!;
  assert.equal((await cashback.quoteCheckout(session)).reservedCents,1500);
  const choice=await adapter.respondStore({...input,state:result.state,message:"Remover cashback",messageId:randomUUID()});
  assert.match(choice.agentMessage,/removido/);
  assert.equal((await cashback.quoteCheckout(session)).reservedCents,0);
  assert.equal((await sessions.getSession(session.merchantId,session.sessionId))!.cart.currentDiscount,15);
});

test("CS-05 actual authenticated HTTP and Meta reject pending payment before any coupon quota or wallet change",async()=>{
  let session=await seed();session=await applyRule(session);
  await cashback.reserveCheckout(session,2500,"pending_reserve_"+session.sessionId);
  await cashback.preparePayment(session,"pending_payment_"+session.sessionId);
  const walletBefore=await cashback.wallet(session.merchantId,session.globalUserId);
  const ledgerBefore=await prisma.cashbackLedgerEntry.findMany({where:{merchantId:session.merchantId},orderBy:{id:"asc"}});
  const checkoutBefore=await prisma.checkoutSession.findUniqueOrThrow({where:{merchantId_sessionId:{merchantId:session.merchantId,sessionId:session.sessionId}}});
  const http=await postCoupon(session);assert.equal(http.status,409,await http.clone().text());
  const state:WhatsAppConversationState={version:1,conversationId:session.cart.cart_ref!,checkoutSessionId:session.sessionId,
    stage:"checkout",history:[],revision:"synthetic",page:0,previousViews:[]};
  const response=await nativeAdapter().respondStore({merchantId:session.merchantId,state,message:"Aplicar cupom SAVE10",messageId:randomUUID(),
    buyer:{globalUserId:session.globalUserId,phone:session.customer!.phone!}});
  assert.match(response.agentMessage,/N.o consegui confirmar/);assert.doesNotMatch(response.agentMessage,/SAVE10 aplicado/);
  assert.equal(await prisma.couponRedemption.count({where:{merchantId:session.merchantId}}),0);
  assert.equal((await prisma.coupon.findUniqueOrThrow({where:{merchantId_code:{merchantId:session.merchantId,code:"SAVE10"}}})).usagesCount,0);
  assert.deepEqual(await cashback.wallet(session.merchantId,session.globalUserId),walletBefore);
  assert.deepEqual(await prisma.cashbackLedgerEntry.findMany({where:{merchantId:session.merchantId},orderBy:{id:"asc"}}),ledgerBefore);
  assert.deepEqual(await prisma.checkoutSession.findUniqueOrThrow({where:{merchantId_sessionId:{merchantId:session.merchantId,sessionId:session.sessionId}}}),checkoutBefore);
});

test("CS-06 real normal NEW and FIRST SEND pin original C/A/cash policy across published-policy change",async()=>{
  const f=await acceptRealNormalOffer();let session=f.session;
  await prisma.checkoutSession.update({where:{merchantId_sessionId:f.scope},data:{customer:{...session.customer,
    cpf:"12345678901",asaasCustomerId:"cus_synthetic"}as unknown as Prisma.InputJsonObject}});
  session=await f.adapter.read(f.scope);
  session=(await coupons.executeForCheckout({merchant_id:session.merchantId,session_id:session.sessionId,code:"SAVE10",expectedVersion:session.persistenceVersion})).session;
  session=(await f.adapter.applyOffer(f.scope,{expectedVersion:session.persistenceVersion,offerId:f.offer.id})).session;
  await cashback.reserveCheckout(session,1700,"normal-payment-reserve");
  const capture=createNormalCrossSellPaymentAdmission(async(tx,scope,options)=>{
    const current=await readNormalCheckoutCrossSellAuthority(tx,scope,undefined,options);
    return {...current,projectedCart:projectNormalCrossSellCart(current)};
  },()=>99);
  const payments=new PrismaPaymentRepository(prisma,captureStorefrontCouponForPayment,undefined,capture);
  const originalSave=payments.saveIntentWithSettlementPlan.bind(payments);
  payments.saveIntentWithSettlementPlan=async input=>{
    await originalSave(input);
    // A real configuration change after NEW commit, before first PSP dispatch.
    await cashback.saveDraft(session.merchantId,{...policy,combination:{...policy.combination!,allowCoupons:false,maximumCombinedDiscountBps:1000}},"qa-owner");
    await cashback.publishProgram(session.merchantId,"qa-owner");
  };
  const sent:Array<{intentId:string;amountCents:number}>=[];
  const provider:PaymentProviderPort={preparePayment:async input=>input,createPayment:async input=>{
    const quote=await prisma.cashbackEarningQuote.findFirstOrThrow({where:{merchantId:session.merchantId,paymentIntentId:input.intentId}});
    assert.equal(quote.state,"bound");sent.push(input);
    return {providerPaymentId:"psp_"+session.sessionId,status:"requires_action",buyerFacingPayload:{qrCodeCopyPaste:"synthetic"}};
  },recoverPayment:async()=>null};
  const command=new CreatePaymentIntentUseCase(sessions,new PrismaMerchantRepository(prisma),payments,provider,
    undefined,undefined,undefined,undefined,sessions,undefined,undefined,undefined,prisma,undefined,undefined,undefined,undefined,cashback);
  const body={merchant_id:session.merchantId,session_id:session.sessionId,idempotency_key:"normal-payment",
    method:"pix"as const,accepted_offer_id:f.offer.id};
  const context={marketplaceSurface:"embed"as const,storefrontCouponScope:{merchantId:session.merchantId,
    checkoutSessionId:session.sessionId,cartId:session.cart.cart_ref!,buyerId:session.globalUserId}};
  const created=await command.execute(body,context);
  assert.equal(created.amountCents,7799);assert.equal(sent.length,1);
  const snapshot=(await payments.getIntentById(session.merchantId,created.id))!.snapshot();
  assert.equal(snapshot.creation!.normalCrossSellAuthority!.version,2);
  const owner=snapshot.creation!.normalCrossSellAuthority!.discountOwner!;
  assert.equal(owner.kind,"cashback_combination");if(owner.kind!=="cashback_combination")assert.fail();
  assert.equal(owner.cashbackRuleVersion,1);assert.equal(owner.discountCents,1500);assert.equal(owner.coupon!.discountCents,1000);
  assert.equal(snapshot.amountBreakdown!.cashbackCents,1700);
  assert.equal((await command.execute(body,context)).id,created.id);assert.equal(sent.length,1);
  const paid=(await payments.getIntentById(session.merchantId,created.id))!;
  paid.markApproved({providerPaymentId:created.providerPaymentId!,approvedAmountCents:7799});await payments.saveIntent({intent:paid});
  const complete=new CompleteOrderUseCase(sessions,sessions,sessions,sessions,undefined,undefined,undefined,sessions,
    undefined,undefined,undefined,undefined,undefined,new PrismaMerchantRepository(prisma),undefined,undefined,new PrismaPaymentApprovalReader(prisma),undefined,cashback);
  await complete.executePaymentApproval({merchant_id:session.merchantId,session_id:session.sessionId,
    external_order_id:created.providerPaymentId!,order_total:77,currency:"BRL",accepted_offer_id:f.offer.id},created.id);
  const event=await prisma.outboxMessage.findFirstOrThrow({where:{merchantId:session.merchantId,eventType:"order.completed"}});
  assert.equal((event.payload as any).coupon_authority.discountCents,1000);
  assert.equal((event.payload as any).coupon_authority.combinedDiscountCents,1500);
  const consumer=new PrismaBoundCouponRedemption(prisma);
  await consumer.redeem({merchantId:session.merchantId,eventId:event.eventId});await consumer.redeem({merchantId:session.merchantId,eventId:event.eventId});
  const redemption=await prisma.couponRedemption.findFirstOrThrow({where:{merchantId:session.merchantId}});
  assert.equal(redemption.status,"redeemed");assert.equal(redemption.discountApplied.toNumber(),10);
  assert.equal((await prisma.coupon.findUniqueOrThrow({where:{id:redemption.couponId}})).usagesCount,1);
  assert.equal((await cashback.wallet(session.merchantId,session.globalUserId)).balance.availableCents,1685);
});

test("CS-06 standalone normal paid compound redeems coupon component once, never C+A",async()=>{
  const f=await acceptRealNormalOffer(true);let session=f.session;
  await prisma.checkoutSession.update({where:{merchantId_sessionId:f.scope},data:{customer:{...session.customer,
    cpf:"12345678901",asaasCustomerId:"cus_synthetic"}as unknown as Prisma.InputJsonObject}});
  session=await f.adapter.read(f.scope);
  session=(await coupons.executeForCheckout({merchant_id:session.merchantId,session_id:session.sessionId,code:"SAVE10",expectedVersion:session.persistenceVersion})).session;
  session=(await f.adapter.applyOffer(f.scope,{expectedVersion:session.persistenceVersion,offerId:f.offer.id})).session;
  await cashback.reserveCheckout(session,1700,"normal-standalone-reserve");
  const capture=createNormalCrossSellPaymentAdmission(async(tx,scope,options)=>{
    const current=await readNormalCheckoutCrossSellAuthority(tx,scope,undefined,options);
    return {...current,projectedCart:projectNormalCrossSellCart(current)};
  },()=>99);
  const payments=new PrismaPaymentRepository(prisma,captureStorefrontCouponForPayment,undefined,capture);
  const merchants=new PrismaMerchantRepository(prisma);
  const provider:PaymentProviderPort={preparePayment:async input=>input,createPayment:async()=>({
    providerPaymentId:"psp_"+session.sessionId,status:"requires_action",buyerFacingPayload:{qrCodeCopyPaste:"synthetic"}}),recoverPayment:async()=>null};
  const command=new CreatePaymentIntentUseCase(sessions,merchants,payments,provider,undefined,undefined,undefined,undefined,
    sessions,undefined,undefined,undefined,prisma,undefined,undefined,undefined,undefined,cashback);
  const created=await command.execute({merchant_id:session.merchantId,session_id:session.sessionId,idempotency_key:"standalone-paid",
    method:"pix",accepted_offer_id:f.offer.id});
  assert.equal(created.amountCents,7799);
  const payment=(await payments.getIntentById(session.merchantId,created.id))!;
  payment.markApproved({providerPaymentId:created.providerPaymentId!,approvedAmountCents:7799});await payments.saveIntent({intent:payment});
  const complete=new CompleteOrderUseCase(sessions,sessions,sessions,sessions,undefined,undefined,undefined,sessions,
    undefined,undefined,undefined,undefined,undefined,merchants,undefined,undefined,new PrismaPaymentApprovalReader(prisma),undefined,cashback);
  await complete.executePaymentApproval({merchant_id:session.merchantId,session_id:session.sessionId,
    external_order_id:created.providerPaymentId!,order_total:77,currency:"BRL",accepted_offer_id:f.offer.id},created.id);
  const event=await prisma.outboxMessage.findFirstOrThrow({where:{merchantId:session.merchantId,eventType:"order.completed"}});
  assert.equal((event.payload as any).normal_coupon_owner.discountCents,1000);
  const consumer=new PrismaBoundCouponRedemption(prisma);
  await consumer.redeem({merchantId:session.merchantId,eventId:event.eventId});
  await consumer.redeem({merchantId:session.merchantId,eventId:event.eventId});
  const redemption=await prisma.couponRedemption.findFirstOrThrow({where:{merchantId:session.merchantId}});
  assert.equal(redemption.discountApplied.toNumber(),10);assert.equal(redemption.status,"redeemed");
  assert.equal((await prisma.coupon.findUniqueOrThrow({where:{id:redemption.couponId}})).usagesCount,1);
  assert.equal(await prisma.outboxMessage.count({where:{merchantId:session.merchantId,eventType:"coupon.redeemed"}}),1);
  assert.equal((await cashback.wallet(session.merchantId,session.globalUserId)).balance.availableCents,1685);
});

for(const order of ["coupon-first","policy-first"]as const)test(`CS-06 actual published advanced policy and coupon compose ${order}`,async()=>{
  const f=await acceptRealNormalOffer();let session=f.session;
  await prisma.checkoutSetting.create({data:{merchantId:session.merchantId,mode:"hybrid",widgetBehavior:{},interventionPolicy:{},
    triggerRules:[],suppressionRules:[],handoff:{},advancedRules:[{id:"qa-pix-rule",enabled:true,priority:1,
    conditions:[{field:"payment_method",operator:"eq",value:"pix"}],action:{type:"offer_discount",params:{percent:10,maxDiscountReais:5}}}]}});
  await cashback.reserveCheckout(session,3000,"normal-policy-reserve");
  if(order==="coupon-first"){
    session=(await coupons.executeForCheckout({merchant_id:session.merchantId,session_id:session.sessionId,code:"SAVE10",expectedVersion:session.persistenceVersion})).session;
    session=(await f.adapter.prepareBenefits(f.scope,{expectedVersion:session.persistenceVersion,method:"pix"})).session;
  }else{
    session=(await f.adapter.prepareBenefits(f.scope,{expectedVersion:session.persistenceVersion,method:"pix"})).session;
    session=(await coupons.executeForCheckout({merchant_id:session.merchantId,session_id:session.sessionId,code:"SAVE10",expectedVersion:session.persistenceVersion})).session;
  }
  assert.equal(session.persistenceVersion,3);assert.equal(session.cart.currentDiscount,15);
  assert.equal((await cashback.quoteCheckout(session)).reservedCents,1700);
  const authority=await prisma.$transaction(async tx=>{
    await benefits.lockInTransaction(tx,session.merchantId);await lockNormalCheckoutCrossSell(tx,f.scope);
    return readNormalCheckoutCrossSellAuthority(tx,f.scope);
  });
  const owner=authority.discountOwner;assert.ok(owner);
  assert.equal(owner.kind,"cashback_combination");
  if(owner.kind!=="cashback_combination")assert.fail();
  assert.equal(owner.coupon!.discountCents,1000);
  assert.equal(owner.advanced!.kind,"checkout_policy");assert.equal(owner.advanced!.discountCents,500);
});

test("CS-06 accepting another real normal product after C+A releases cash, preserves C and keeps both receipts",async()=>{
  const f=await acceptRealNormalOffer();let session=f.session;
  session=(await coupons.executeForCheckout({merchant_id:session.merchantId,session_id:session.sessionId,code:"SAVE10",expectedVersion:session.persistenceVersion})).session;
  session=(await f.adapter.applyOffer(f.scope,{expectedVersion:session.persistenceVersion,offerId:f.offer.id})).session;
  await cashback.reserveCheckout(session,1700,"second-normal-reserve");
  const suffix=randomUUID(),productId="extra_"+suffix,variantId="extra_variant_"+suffix,promotionId="extra_promotion_"+suffix,suggestionId="extra_suggestion_"+suffix;
  await prisma.product.create({data:{id:productId,merchantId:session.merchantId,name:"Synthetic extra",type:"digital",metadata:{downloadUrl:"https://qa.cashback.invalid/extra.pdf"}}});
  await prisma.productVariant.create({data:{id:variantId,productId,sku:"EXTRA"}});
  await prisma.productPrice.create({data:{variantId,basePriceInCents:1000,costInCents:100,currency:"BRL"}});
  await prisma.crossSellPromotion.create({data:{id:promotionId,merchantId:session.merchantId,name:"Second real offer",trigger:{sku_in_cart:["SKU"]},
    recommendedSkus:["EXTRA"],discountPercent:10,maxDiscountPercent:20,startsAt:new Date("2000-01-01")}});
  await prisma.crossSellSuggestion.create({data:{id:suggestionId,...f.scope,promoId:promotionId,rankedItems:["EXTRA"],agentCopy:"Synthetic",computedDiscount:10,suggestedAt:new Date()}});
  const beforeWallet=await cashback.wallet(session.merchantId,session.globalUserId);
  const redemption=await prisma.couponRedemption.findFirstOrThrow({where:{merchantId:session.merchantId}});
  const quote=await f.adapter.quote(f.scope,{suggestion_id:suggestionId,targets:[{sku:"EXTRA",variant_id:variantId,quantity:1}]});
  assert.deepEqual(await cashback.wallet(session.merchantId,session.globalUserId),beforeWallet);
  const command={suggestion_id:suggestionId,accepted_skus:["EXTRA"],expected_quote:quote};
  const ack=await f.adapter.accept(f.scope,command);
  assert.equal(ack.persistenceVersion,4);
  const actual=await f.adapter.read(f.scope);
  assert.equal(actual.cart.total,118);assert.equal(actual.cart.currentDiscount,10);assert.equal(actual.cart.items.length,3);
  assert.equal((await cashback.quoteCheckout(actual)).reservedCents,0);
  assert.deepEqual(await prisma.couponRedemption.findFirstOrThrow({where:{merchantId:session.merchantId}}),redemption);
  assert.equal(await prisma.outboxMessage.count({where:{merchantId:session.merchantId,eventType:"cross-sell.offer.accepted"}}),2);
  assert.deepEqual(await f.adapter.accept(f.scope,command),ack);
  assert.equal((await sessions.getSession(session.merchantId,session.sessionId))!.persistenceVersion,4);
});

for(const pending of [false,true])test(`CS-07 same-value explicit offer ${pending?"is immutable during payment":"retains production acceptance without adding another advanced discount"}`,async()=>{
  const f=await acceptRealNormalOffer();let session=f.session;
  await prisma.checkoutSetting.create({data:{merchantId:session.merchantId,mode:"hybrid",widgetBehavior:{},interventionPolicy:{},
    triggerRules:[],suppressionRules:[],handoff:{},advancedRules:[{id:"qa-equal-rule",enabled:true,priority:1,conditions:[],
      action:{type:"offer_discount",params:{percent:10,maxDiscountReais:5}}}]}});
  session=(await f.adapter.prepareBenefits(f.scope,{expectedVersion:session.persistenceVersion,method:"pix"})).session;
  assert.equal(session.cart.currentDiscount,5);
  const oldCommercialVersion=session.cart.commercialBenefitsVersion!;
  if(pending){
    await cashback.preparePayment(session,"equal-owner-pending");
    const before=await prisma.checkoutSession.findUniqueOrThrow({where:{merchantId_sessionId:f.scope}});
    const journalBefore=await prisma.cashbackCheckoutBenefits.findUniqueOrThrow({where:{merchantId_sessionId:f.scope}});
    await assert.rejects(f.adapter.applyOffer(f.scope,{expectedVersion:session.persistenceVersion,offerId:f.offer.id}),
      error=>Boolean(error&&typeof error==="object"&&"code"in error&&error.code==="cashback_payment_in_progress"));
    assert.deepEqual(await prisma.checkoutSession.findUniqueOrThrow({where:{merchantId_sessionId:f.scope}}),before);
    assert.deepEqual(await prisma.cashbackCheckoutBenefits.findUniqueOrThrow({where:{merchantId_sessionId:f.scope}}),journalBefore);
    assert.equal(await prisma.acceptedOffer.count({where:f.scope}),0);return;
  }
  session=(await f.adapter.applyOffer(f.scope,{expectedVersion:session.persistenceVersion,offerId:f.offer.id})).session;
  assert.equal(session.cart.currentDiscount,5);assert.equal(session.persistenceVersion,3);
  assert.equal(session.cart.commercialBenefitsVersion,oldCommercialVersion+1);
  assert.equal(await prisma.acceptedOffer.count({where:f.scope}),1);
  const authority=await prisma.$transaction(async tx=>{
    await benefits.lockInTransaction(tx,session.merchantId);await lockNormalCheckoutCrossSell(tx,f.scope);
    return readNormalCheckoutCrossSellAuthority(tx,f.scope);
  });
  const owner=authority.discountOwner;assert.ok(owner);
  assert.equal(owner.kind,"cashback_combination");if(owner.kind!=="cashback_combination")assert.fail();
  assert.equal(owner.advanced!.kind,"accepted_offer");assert.equal(owner.advanced!.discountCents,500);
  if(owner.advanced?.kind!=="accepted_offer")assert.fail();assert.equal(owner.advanced.authorizedOfferId,f.offer.id);
  const replay=(await benefits.applyAdvancedRule(session,{id:f.offer.id,...f.scope,type:"discount_fixed",value:5,approved:true,
    marginAfterOffer:.7,reason:f.offer.reason,expiresAt:f.offer.expiresAt.toISOString()}))!;
  assert.equal(replay.persistenceVersion,session.persistenceVersion);
  assert.equal(replay.cart.commercialBenefitsVersion,session.cart.commercialBenefitsVersion);
  assert.equal((await sessions.getSession(session.merchantId,session.sessionId))!.persistenceVersion,3);
});

test("CS-06 equal policy amount on a new payment method changes only owner/version and keeps C/cash exact",async()=>{
  const f=await acceptRealNormalOffer();let session=f.session;
  await prisma.checkoutSetting.create({data:{merchantId:session.merchantId,mode:"hybrid",widgetBehavior:{},interventionPolicy:{},
    triggerRules:[],suppressionRules:[],handoff:{},advancedRules:["pix","card"].map((method,index)=>({id:"qa-"+method,enabled:true,priority:index+1,
      conditions:[{field:"payment_method",operator:"eq",value:method}],action:{type:"offer_discount",params:{percent:10,maxDiscountReais:5}}}))}});
  session=(await coupons.executeForCheckout({merchant_id:session.merchantId,session_id:session.sessionId,code:"SAVE10",expectedVersion:session.persistenceVersion})).session;
  await cashback.reserveCheckout(session,2200,"method-owner-reserve");
  session=(await f.adapter.prepareBenefits(f.scope,{expectedVersion:session.persistenceVersion,method:"pix"})).session;
  // Initial real cross-sell acceptance rebases J1; C is J2 and policy A is J3.
  assert.equal(session.cart.currentDiscount,15);assert.equal(session.cart.commercialBenefitsVersion,3);
  assert.equal((await cashback.quoteCheckout(session)).reservedCents,1700);
  const oldFingerprint=paymentCartFingerprint(session);
  session=(await f.adapter.prepareBenefits(f.scope,{expectedVersion:session.persistenceVersion,method:"card"})).session;
  assert.equal(session.persistenceVersion,4);assert.equal(session.cart.currentDiscount,15);assert.equal(session.cart.commercialBenefitsVersion,4);
  assert.notEqual(paymentCartFingerprint(session),oldFingerprint);
  assert.equal((await cashback.quoteCheckout(session)).reservedCents,1700);
  const current=await prisma.$transaction(async tx=>{
    await benefits.lockInTransaction(tx,session.merchantId);await lockNormalCheckoutCrossSell(tx,f.scope);
    return readNormalCheckoutCrossSellAuthority(tx,f.scope);
  });
  const owner=current.discountOwner;assert.ok(owner);assert.equal(owner.kind,"cashback_combination");if(owner.kind!=="cashback_combination")assert.fail();
  assert.equal(owner.coupon!.discountCents,1000);assert.equal(owner.advanced!.discountCents,500);
  assert.equal(owner.advanced!.kind,"checkout_policy");if(owner.advanced?.kind!=="checkout_policy")assert.fail();
  assert.equal(owner.advanced.ruleId,"qa-card");assert.equal(owner.advanced.paymentMethod,"card");
});

test("CS-04 real candidate uses C10 plus A5 under cash-specific30 despite general5 without mutating cash on generation",async()=>{
  let session=await seed();
  await sessions.setRules(session.merchantId,{maxDiscountPercent:5,minimumMarginPercent:0});
  session=(await coupons.executeForCheckout({merchant_id:session.merchantId,session_id:session.sessionId,code:"SAVE10",expectedVersion:session.persistenceVersion})).session;
  await cashback.reserveCheckout(session,2000,"candidate-quote-reserve");
  const walletBefore=await cashback.wallet(session.merchantId,session.globalUserId);
  const cartBefore=await prisma.checkoutSession.findUniqueOrThrow({where:{merchantId_sessionId:{merchantId:session.merchantId,sessionId:session.sessionId}}});
  const candidateService=new CheckoutOfferService(sessions,undefined,undefined,undefined,undefined,cashback,benefits);
  const rules=await sessions.getRules(session.merchantId);
  const candidate=await candidateService.authorizeOffer("Quero desconto",session,rules,"payment",[]);
  assert.equal(candidate.approved,true);assert.equal(candidate.type,"discount_percent");assert.equal(candidate.value,5);
  assert.deepEqual(await cashback.wallet(session.merchantId,session.globalUserId),walletBefore);
  assert.deepEqual(await prisma.checkoutSession.findUniqueOrThrow({where:{merchantId_sessionId:{merchantId:session.merchantId,sessionId:session.sessionId}}}),cartBefore);
  const offer=await sessions.getOffer(session.merchantId,candidate.id);assert.ok(offer);
  session=(await benefits.applyAdvancedRule(session,offer))!;
  assert.equal(session.cart.currentDiscount,15);assert.equal((await cashback.quoteCheckout(session)).reservedCents,1500);
  assert.equal(10000-1500-(await cashback.quoteCheckout(session)).reservedCents,7000);
});

for(const scenario of ["respect-general","flags","margin","pending","stale","money-cap"]as const)
test(`CS-04 real candidate refuses ${scenario} without changing wallet, ledger, cart or frozen quote`,async()=>{
  let session=await seed();await sessions.setRules(session.merchantId,{maxDiscountPercent:5,minimumMarginPercent:0});
  session=(await coupons.executeForCheckout({merchant_id:session.merchantId,session_id:session.sessionId,code:"SAVE10",expectedVersion:session.persistenceVersion})).session;
  await cashback.reserveCheckout(session,2000,"candidate-negative-reserve");
  if(scenario==="respect-general"||scenario==="flags"||scenario==="money-cap"){
    const combination={...policy.combination!,...(scenario==="respect-general"?{limitMode:"respect_general"as const}:{}) ,
      ...(scenario==="flags"?{allowAdvancedRules:false}:{}),...(scenario==="money-cap"?{maximumCombinedDiscountBps:null,maximumCombinedDiscountCents:1200}:{})};
    await cashback.saveDraft(session.merchantId,{...policy,combination},"qa-owner");await cashback.publishProgram(session.merchantId,"qa-owner");
  }
  if(scenario==="margin")await sessions.setRules(session.merchantId,{minimumMarginPercent:90});
  if(scenario==="pending")await cashback.preparePayment(session,"candidate-negative-payment");
  const wallet=await cashback.wallet(session.merchantId,session.globalUserId);
  const ledger=await prisma.cashbackLedgerEntry.findMany({where:{merchantId:session.merchantId},orderBy:{id:"asc"}});
  const row=await prisma.checkoutSession.findUniqueOrThrow({where:{merchantId_sessionId:{merchantId:session.merchantId,sessionId:session.sessionId}}});
  const quotes=await prisma.cashbackEarningQuote.findMany({where:{merchantId:session.merchantId}});
  const input=scenario==="stale"?{...session,cart:{...session.cart,total:200,items:session.cart.items.map(item=>({...item,quantity:2}))}}:session;
  const candidate=await new CheckoutOfferService(sessions,undefined,undefined,undefined,undefined,cashback,benefits)
    .authorizeOffer("Quero desconto",input,await sessions.getRules(session.merchantId),"payment",[]);
  assert.equal(candidate.approved,false);assert.equal(candidate.type,"none");assert.equal(candidate.value,0);
  assert.equal(await prisma.authorizedOffer.count({where:{merchantId:session.merchantId,approved:true}}),0);
  assert.deepEqual(await cashback.wallet(session.merchantId,session.globalUserId),wallet);
  assert.deepEqual(await prisma.cashbackLedgerEntry.findMany({where:{merchantId:session.merchantId},orderBy:{id:"asc"}}),ledger);
  assert.deepEqual(await prisma.checkoutSession.findUniqueOrThrow({where:{merchantId_sessionId:{merchantId:session.merchantId,sessionId:session.sessionId}}}),row);
  assert.deepEqual(await prisma.cashbackEarningQuote.findMany({where:{merchantId:session.merchantId}}),quotes);
});

for(const source of ["coupon","telemetry"]as const)test(`CLOCK actual ${source} writer uses PostgreSQL authority even when host clock is five seconds ahead`,async()=>{
  const f=await acceptRealNormalOffer(true);let session=f.session;
  const RealDate=globalThis.Date;
  const AheadDate=new Proxy(RealDate,{
    construct(target,args){return Reflect.construct(target,args.length?args:[target.now()+5000]);},
    get(target,key){return key==="now"?()=>target.now()+5000:Reflect.get(target,key);},
  });
  try{
    globalThis.Date=AheadDate;
    if(source==="coupon")session=(await coupons.executeForCheckout({merchant_id:session.merchantId,session_id:session.sessionId,
      code:"SAVE10",expectedVersion:session.persistenceVersion})).session;
    else await sessions.recordEvent(session.merchantId,session.sessionId,"checkout_started");
  }finally{globalThis.Date=RealDate;}
  session=await f.adapter.read(f.scope);
  const event=await prisma.checkoutEvent.findFirstOrThrow({where:{...f.scope,eventName:source==="coupon"?"coupon_applied":"checkout_started"}});
  const [clock]=await prisma.$queryRaw<Array<{now:Date}>>`SELECT clock_timestamp() AS now`;
  assert.ok(event.occurredAt.getTime()<=clock!.now.getTime(),"Trusted persisted event must use the same PG clock as its authority reader");
  if(source==="coupon"){
    const outbox=await prisma.outboxMessage.findFirstOrThrow({where:{merchantId:session.merchantId,eventType:"coupon.applied"}});
    assert.equal(outbox.occurredAt.getTime(),event.occurredAt.getTime());
  }
  if(source==="telemetry"){
    const stored=await prisma.checkoutSession.findUniqueOrThrow({where:{merchantId_sessionId:f.scope}});
    assert.equal(stored.updatedAt.getTime(),event.occurredAt.getTime());
  }
  session=(await f.adapter.applyOffer(f.scope,{expectedVersion:session.persistenceVersion,offerId:f.offer.id})).session;
  assert.equal(session.cart.currentDiscount,source==="coupon"?15:5);
});

test("CLOCK a forged future stage event remains refused by the exact commercial guard",async()=>{
  const f=await acceptRealNormalOffer(true);
  await prisma.checkoutEvent.create({data:{...f.scope,eventName:"checkout_started",occurredAt:new Date(Date.now()+60000)}});
  const before=await prisma.checkoutSession.findUniqueOrThrow({where:{merchantId_sessionId:f.scope}});
  await assert.rejects(f.adapter.applyOffer(f.scope,{expectedVersion:f.session.persistenceVersion,offerId:f.offer.id}),
    error=>Boolean(error&&typeof error==="object"&&"reason"in error&&error.reason==="stage_evidence_invalid"));
  assert.deepEqual(await prisma.checkoutSession.findUniqueOrThrow({where:{merchantId_sessionId:f.scope}}),before);
  assert.equal(await prisma.acceptedOffer.count({where:f.scope}),0);
});

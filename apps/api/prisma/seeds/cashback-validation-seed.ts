import "reflect-metadata";
import { Prisma, PrismaClient } from "@prisma/client";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import type { AuthorizedOffer, CashbackRules, CheckoutSession, CashbackCheckoutQuote, CashbackBalance } from "@zyon/shared-types";
import { CashbackRepository } from "../../src/modules/cashback/infrastructure/cashback.repository.js";
import { CashbackService } from "../../src/modules/cashback/application/cashback.service.js";
import { CashbackQueriesService } from "../../src/modules/cashback/application/cashback-queries.service.js";
import { CheckoutCommercialBenefitsService } from "../../src/modules/cashback/application/checkout-commercial-benefits.service.js";
import { paymentCartFingerprint } from "../../src/modules/checkout/domain/services/payment-cart-fingerprint.js";
import { PasswordHasher } from "../../src/modules/auth/domain/services/password-hasher.service.js";
import { embedCheckoutSessionId } from "../../src/modules/embed/domain/embed-checkout-session.js";
import type { EmbedTokenClaims } from "../../src/modules/embed/domain/embed-token.service.js";
import { fingerprint } from "../../src/modules/cashback/domain/cashback.js";
import { WHATSAPP_TEMPLATE_TYPES } from "../../src/modules/whatsapp-templates/domain/catalog/template-types.js";
import { CheckoutCartAuthorityService } from "../../src/modules/checkout/application/services/checkout-cart-authority.service.js";
import type { ValidateCartForPaymentUseCase } from "../../src/modules/commerce/application/validate-cart-for-payment.use-case.js";
import { lockCheckoutSessionAnchor } from "../../src/shared/persistence/checkout-session-lock.js";
import { lockStorefrontCart } from "../../src/shared/persistence/storefront-cart-lock.js";
import { CASHBACK_QA_NAMESPACE, CASHBACK_QA_MERCHANT_KEYS, CashbackSeedError, qaMerchantId, qaId, validateCashbackSeedTarget,
  type CashbackSeedTargetInput, type CashbackQaMerchantKey } from "./cashback-validation-guard.js";

const DAY = 86400000;
const REGISTRY = qaId("registry");
export const CASHBACK_QA_BUYER = qaId("buyer-canonical");
export const CASHBACK_QA_OTHER_BUYER = qaId("buyer-other");
export const CASHBACK_QA_PREVIOUS_WA_BUYER = qaId("buyer-whatsapp-before-link");
export const CASHBACK_QA_PHONE = "5520000000000"; // Synthetic all-zero subscriber, SQL-format compliant; never sent.
type ProductType = "physical" | "digital" | "service" | "food";
const TYPES: ProductType[] = ["physical", "digital", "service", "food"];
const BASE_RULES: CashbackRules = { earnRateBps: 500, minimumEarnCents: 0, maximumEarnPerOrderCents: null,
  buyerMonthlyEarnLimitCents: null, monthlyBudgetCents: 100000, releaseTrigger: "payment_confirmed", releaseDelayDays: 0,
  expiryDays: 90, minimumRedeemOrderCents: 0, maximumRedeemBps: 9000, maximumRedeemCents: null, allowWithDiscounts: true,
  terms: "SEED QA: credito promocional para esta loja; pagamentos e comprovacoes de canal sao fixtures locais, sem provedor.",
  combination: { allowCoupons: true, allowAdvancedRules: true, limitMode: "cashback_specific", maximumCombinedDiscountBps: 3000, maximumCombinedDiscountCents: null } };
export interface CashbackSeedCase {
  key: string; merchantId: string; sessionId: string; buyerId: string; channel: "website" | "whatsapp";
  embedNonce: string;
  expected: Partial<Pick<CashbackCheckoutQuote, "eligible" | "reason" | "maximumRedeemCents" | "reservedCents" | "estimatedEarnCents">> & { productsCents?: number; discountCents?: number; cashbackCents?: number; netProductsCents?: number };
  fixture?: string;
}
export interface CashbackSeedManifest {
  version: typeof CASHBACK_QA_NAMESPACE; environment: "local" | "homolog"; referenceAt: string; targetHash: string;
  evidenceScope: string; externalCalls: 0; realProviderEvidence: false; markerMerchantId: string;
  merchants: Array<{ id: string; key: CashbackQaMerchantKey; ownerId: string; ownerEmail: string; storeSlug: string; billingPlan: string }>;
  buyers: Array<{ id: string; email: string }>;
  cases: CashbackSeedCase[];
  expectedWallets: Record<string, Partial<CashbackBalance>>;
  expectedMetrics: Record<string, Record<string, number>>;
  expectedReconciliationIssues: Record<string, string[]>;
  catalog: Array<{ merchantId: string; type: ProductType; productId: string; variantId: string; priceCents: number; costCents: number }>;
  payments: Array<{ id: string; merchantId: string; orderId: string | null; kind: string; amountCents: number; synthetic: true }>;
  refunds: Array<{ merchantId: string; orderId: string; externalRefundCents: number; cashbackRestoreCents: number; fullOrderReturn: boolean }>;
  httpChecks: Array<{ key: string; method: "GET" | "POST"; route: string; merchantId: string; buyerId?: string; body?: Record<string, unknown>; expectedStatus: number; expected?: unknown }>;
}
interface SeedMarker { version: string; environment: string; targetHash: string; referenceAt: string; steps: string[]; manifest?: CashbackSeedManifest; }
export interface CashbackSeedOptions extends CashbackSeedTargetInput { ownerPassword: string; manifestPath?: string; }
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
function fail(code: string): never { throw new CashbackSeedError(code); }
function assertEqual(actual: unknown, expected: unknown, code: string) { if (fingerprint(actual) !== fingerprint(expected)) fail(code); }
function rulesFor(key: CashbackQaMerchantKey): CashbackRules {
  const rules = structuredClone(BASE_RULES);
  if (key === "general") rules.combination!.limitMode = "respect_general";
  if (key === "blocked-coupon") rules.combination!.allowCoupons = false;
  if (key === "blocked-rule") rules.combination!.allowAdvancedRules = false;
  if (key === "fulfillment") rules.releaseTrigger = "order_fulfilled";
  if (key === "expiry") rules.expiryDays = 3;
  return rules;
}
function ownerEmail(key: CashbackQaMerchantKey) { return `${qaId(`owner-${key}`)}@cashback.invalid`; }
export const cashbackQaEmbedNonce = (key: CashbackQaMerchantKey, caseKey: string) => qaId(`${key}-${caseKey}-nonce`);
export const cashbackQaSessionId = (key: CashbackQaMerchantKey, caseKey: string) => embedCheckoutSessionId({ merchantId: qaMerchantId(key), nonce: cashbackQaEmbedNonce(key,caseKey) } as EmbedTokenClaims);
async function ensureSeedMemberships(prisma:PrismaClient,merchants:CashbackSeedManifest["merchants"]):Promise<void>{
  for(const merchant of merchants){
    const members=[{id:merchant.ownerId,email:merchant.ownerEmail,role:"OWNER" as const},...(merchant.key === "specific"?[{id:qaId("staff-specific"),email:`${qaId("staff-specific")}@cashback.invalid`,role:"STAFF" as const}]:[])];
    for(const member of members){
      const user=await prisma.merchantUser.findUnique({where:{id:member.id}});
      if(!user||user.merchantId !== merchant.id||user.email !== member.email||user.role !== member.role.toLowerCase())fail("cashback_seed_membership_user_mismatch");
      const existing=await prisma.merchantTeamMember.findUnique({where:{merchantId_userId:{merchantId:merchant.id,userId:member.id}}});
      if(existing&&existing.role !== member.role)fail("cashback_seed_membership_role_mismatch");
      await prisma.merchantTeamMember.upsert({where:{merchantId_userId:{merchantId:merchant.id,userId:member.id}},update:{},create:{id:qaId(`membership-${member.id}`),merchantId:merchant.id,userId:member.id,role:member.role}});
    }
  }
}

async function ensureSeedTemplatesInactive(prisma:PrismaClient,merchants:CashbackSeedManifest["merchants"]):Promise<void>{
  // Precreate the actual complete platform catalog, including the registry
  // merchant seen by the application's normal paginated template initializer.
  // This one-time QA upgrade changes no consent, financial fact or provider ID.
  for(const merchantId of [REGISTRY,...merchants.map(merchant=>merchant.id)]){
    for(const type of WHATSAPP_TEMPLATE_TYPES)for(const channel of ["email","whatsapp"] as const){
      await prisma.postSaleMessageTemplate.upsert({where:{merchantId_type_channel:{merchantId,type,channel}},
        update:{isActive:false},create:{id:qaId(`template-${merchantId}-${type}-${channel}`),merchantId,type,channel,name:"QA inativo",body:"QA: nao enviar",isActive:false}});
    }
    await prisma.postSaleMessageTemplate.updateMany({where:{merchantId,isActive:true},data:{isActive:false}});
  }
}

async function ensureSeedWidgetSource(prisma:PrismaClient):Promise<void>{
  const merchantId=qaMerchantId("specific"),sessionId=cashbackQaSessionId("specific","editable"),cartRef=qaId("widget-source-cart");
  await prisma.$transaction(async tx=>{
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`cashback:${merchantId}`},0))::text`;
    await tx.$queryRaw`SELECT id FROM merchants WHERE id=${merchantId} FOR UPDATE`;
    await lockCheckoutSessionAnchor(tx,merchantId,sessionId);await lockStorefrontCart(tx,merchantId,cartRef);
    const merchant=await tx.merchant.findUniqueOrThrow({where:{id:merchantId}});
    const settings=merchant.storeSettings as {qaSeedVersion?:string;qaOnly?:boolean}|null;
    if(settings?.qaSeedVersion!==CASHBACK_QA_NAMESPACE||settings.qaOnly!==true)fail("cashback_seed_widget_merchant_collision");
    const row=await tx.checkoutSession.findUniqueOrThrow({where:{merchantId_sessionId:{merchantId,sessionId}}});
    if(row.id!==qaId("specific-sessionrow-editable")||row.globalUserId!==CASHBACK_QA_BUYER)fail("cashback_seed_widget_buyer_scope_mismatch");
    const blockers=await tx.$queryRaw<Array<Record<string,number>>>`SELECT
      (SELECT count(*)::int FROM payment_intents WHERE merchant_id=${merchantId} AND session_id=${sessionId}) AS payments,
      (SELECT count(*)::int FROM completed_orders WHERE merchant_id=${merchantId} AND session_id=${sessionId}) AS orders,
      (SELECT count(*)::int FROM cashback_checkout_benefits WHERE merchant_id=${merchantId} AND session_id=${sessionId}) AS journals,
      (SELECT count(*)::int FROM cashback_reservations WHERE merchant_id=${merchantId} AND session_id=${sessionId}) AS reservations,
      (SELECT count(*)::int FROM cashback_earning_quotes WHERE merchant_id=${merchantId} AND session_id=${sessionId}) AS quotes,
      (SELECT count(*)::int FROM coupon_redemptions WHERE merchant_id=${merchantId} AND session_id=${sessionId}) AS coupons,
      (SELECT count(*)::int FROM accepted_offers WHERE merchant_id=${merchantId} AND session_id=${sessionId}) AS accepted`;
    if(Object.values(blockers[0]!).some(value=>value!==0))fail("cashback_seed_widget_financial_activity_present");
    const cart=row.cart as unknown as CheckoutSession["cart"];
    if((cart.currentDiscount??0)!==0||(cart.cart_ref&&cart.cart_ref!==cartRef)||cart.commercialBenefitsVersion||cart.commercialNudge)fail("cashback_seed_widget_cart_already_commercial");
    const variant=await tx.productVariant.findUniqueOrThrow({where:{id:qaId("specific-variant-physical")},include:{product:true,price:true,stock:true}});
    if(variant.productId!==qaId("specific-product-physical")||variant.product.merchantId!==merchantId||variant.product.type!=="physical"||!variant.isActive||!variant.product.isActive
      ||variant.product.deletedAt||variant.price?.basePriceInCents!==10000||variant.price.currency!=="BRL"||variant.stock.reduce((n,s)=>n+s.quantity-s.reserved,0)!==100)fail("cashback_seed_widget_catalog_mismatch");
    const items=[{variantId:variant.id,productId:variant.productId,sku:variant.sku,name:variant.product.name,quantity:1,unitPriceCents:10000}];
    const byId=await tx.storefrontCart.findUnique({where:{id:cartRef}});
    if(byId&&(byId.merchantId!==merchantId||byId.sessionId!==cartRef))fail("cashback_seed_widget_source_collision");
    const existing=await tx.storefrontCart.findUnique({where:{merchantId_sessionId:{merchantId,sessionId:cartRef}}});
    if(existing&&(existing.id!==cartRef||fingerprint(existing.items)!==fingerprint(items)||existing.total!==10000||existing.discount!==0||existing.couponCode!==null||existing.freeShipping||existing.expiresAt<=new Date()))fail("cashback_seed_widget_source_drift");
    if(!existing)await tx.storefrontCart.create({data:{id:cartRef,merchantId,sessionId:cartRef,items:json(items),total:10000,discount:0,freeShipping:false,expiresAt:new Date(Date.now()+7*DAY)}});
    const external={execute:async()=>{throw new Error("cashback_seed_external_commerce_forbidden");}} as unknown as ValidateCartForPaymentUseCase;
    const authority=new CheckoutCartAuthorityService(tx as PrismaClient,external);
    const canonical=JSON.parse(JSON.stringify(await authority.resolveStorefront(merchantId,cartRef))) as CheckoutSession["cart"];
    if(canonical.source!=="storefront"||canonical.cart_ref!==cartRef||canonical.total!==100||canonical.currentDiscount!==0||canonical.items.length!==1||canonical.items[0]!.variantId!==variant.id)fail("cashback_seed_widget_authority_mismatch");
    if(fingerprint(row.cart)!==fingerprint(canonical)){
      const clock=await tx.$queryRaw<Array<{now:Date}>>`SELECT clock_timestamp() AS now`;
      const changed=await tx.checkoutSession.updateMany({where:{id:row.id,merchantId,sessionId,version:row.version},data:{cart:json(canonical),updatedAt:clock[0]!.now}});
      if(changed.count!==1)fail("cashback_seed_widget_cas_conflict");
      const saved=await tx.checkoutSession.findUniqueOrThrow({where:{merchantId_sessionId:{merchantId,sessionId}}});
      if(saved.version!==row.version+1)fail("cashback_seed_widget_version_trigger_required");
    }
  },{timeout:20000,maxWait:10000,isolationLevel:"Serializable"});
}

/** Creates only reserved QA tenants. Financial effects run through production services. */
export async function seedCashbackValidation(options: CashbackSeedOptions): Promise<CashbackSeedManifest> {
  const target = validateCashbackSeedTarget(options);
  if (typeof options.ownerPassword !== "string" || options.ownerPassword.length < 20) fail("cashback_seed_private_password_required_min20");
  const prisma = new PrismaClient({ datasources: { db: { url: target.databaseUrl } } });
  const lock = `cashback-seed:${CASHBACK_QA_NAMESPACE}`;
  // Dedicated session lock spans service transactions without nesting them.
  const { Client } = createRequire(import.meta.url)("pg") as { Client: new (options:{connectionString:string}) => {connect():Promise<void>;query(sql:string,values?:string[]):Promise<unknown>;end():Promise<void>} };
  const guardConnection = new Client({ connectionString: target.databaseUrl });
  await guardConnection.connect(); await guardConnection.query("SELECT pg_advisory_lock(hashtextextended($1,0))::text", [lock]);
  try {
    const actual = await prisma.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
    if (actual[0]?.name !== target.database) fail("cashback_seed_connected_database_mismatch");
    let registry = await prisma.merchant.findUnique({ where: { id: REGISTRY } });
    let marker = (registry?.storeSettings as { cashbackQaSeed?: SeedMarker } | null)?.cashbackQaSeed;
    if (registry && (!marker || marker.version !== CASHBACK_QA_NAMESPACE || marker.environment !== target.environment || marker.targetHash !== target.targetHash)) fail("cashback_seed_registry_collision");
    for (const key of CASHBACK_QA_MERCHANT_KEYS) {
      const existing = await prisma.merchant.findUnique({ where: { id: qaMerchantId(key) } });
      if (existing && (existing.storeSettings as { qaSeedVersion?: string } | null)?.qaSeedVersion !== CASHBACK_QA_NAMESPACE) fail("cashback_seed_merchant_collision");
    }
    if (marker?.manifest) {
      if(!marker.steps.includes("memberships-v1")){
        await ensureSeedMemberships(prisma,marker.manifest.merchants);marker.steps.push("memberships-v1");
        await prisma.merchant.update({where:{id:REGISTRY},data:{storeSettings:json({cashbackQaSeed:marker})}});
      }
      if(!marker.steps.includes("communications-catalog-v2")){
        await ensureSeedTemplatesInactive(prisma,marker.manifest.merchants);marker.steps.push("communications-catalog-v2");
        await prisma.merchant.update({where:{id:REGISTRY},data:{storeSettings:json({cashbackQaSeed:marker})}});
      }
      if(!marker.steps.includes("widget-source-cart-v1")){
        await ensureSeedWidgetSource(prisma);marker.steps.push("widget-source-cart-v1");
        await prisma.merchant.update({where:{id:REGISTRY},data:{storeSettings:json({cashbackQaSeed:marker})}});
      }
      await validateCashbackSeedManifest(prisma, marker.manifest);
      if (options.manifestPath) await writeManifest(options.manifestPath, marker.manifest);
      return marker.manifest;
    }
    marker ??= { version: CASHBACK_QA_NAMESPACE, environment: target.environment, targetHash: target.targetHash, referenceAt: new Date().toISOString(), steps: [] };
    if (!registry) registry = await prisma.merchant.create({ data: { id: REGISTRY, name: "QA cashback seed registry", storeSettings: json({ cashbackQaSeed: marker }), melhorEnvioEnabled: false } });
    const mark = async () => { await prisma.merchant.update({ where: { id: REGISTRY }, data: { storeSettings: json({ cashbackQaSeed: marker }) } }); };
    const step = async (key: string, operation: () => Promise<void>) => { if (marker!.steps.includes(key)) return; await operation(); marker!.steps.push(key); await mark(); };
    const reference = new Date(marker.referenceAt);
    const repository = new CashbackRepository(prisma), benefits = new CheckoutCommercialBenefitsService(repository), cashback = new CashbackService(repository, benefits), queries = new CashbackQueriesService(repository, cashback);
    const manifest: CashbackSeedManifest = { version: CASHBACK_QA_NAMESPACE, environment: target.environment, referenceAt: marker.referenceAt, targetHash: target.targetHash,
      evidenceScope: "Synthetic QA prerequisites and provider states; real cashback services and persistent PostgreSQL effects. HTTP, OTP possession, Meta and PSP delivery require separate evidence.", externalCalls: 0, realProviderEvidence: false, markerMerchantId: REGISTRY,
      merchants: CASHBACK_QA_MERCHANT_KEYS.map(key => ({ id: qaMerchantId(key), key, ownerId: qaId(`owner-${key}`), ownerEmail: ownerEmail(key), storeSlug: qaMerchantId(key), billingPlan: key === "isolation" ? "starter" : "growth" })),
      buyers: [{ id: CASHBACK_QA_BUYER, email: `${CASHBACK_QA_BUYER}@cashback.invalid` }, { id: CASHBACK_QA_OTHER_BUYER, email: `${CASHBACK_QA_OTHER_BUYER}@cashback.invalid` }],
      cases: [], expectedWallets: {}, expectedMetrics: {}, expectedReconciliationIssues: {}, catalog: [], payments: [], refunds: [], httpChecks: [] };
    const passwordHash = await new PasswordHasher().hash(options.ownerPassword);
    await step("prerequisites", async () => {
      for (const buyer of manifest.buyers) {
        const existing = await prisma.buyerAccount.findUnique({ where: { globalUserId: buyer.id } });
        if (existing && existing.email !== buyer.email) fail("cashback_seed_buyer_collision");
        await prisma.buyerAccount.upsert({ where: { globalUserId: buyer.id }, update: {}, create: { globalUserId: buyer.id, email: buyer.email, passwordHash, displayName: buyer.id === CASHBACK_QA_BUYER ? "QA Cashback Canal Unico" : "QA Cashback Outro Cliente" } });
        await prisma.buyerPreference.upsert({ where: { globalUserId: buyer.id }, update: { emailOptIn: false, whatsappOptIn: false }, create: { globalUserId: buyer.id, emailOptIn: false, whatsappOptIn: false } });
      }
      for (const merchant of manifest.merchants) {
        await prisma.merchant.upsert({ where: { id: merchant.id }, update: {}, create: { id: merchant.id, name: `QA Cashback ${merchant.key}`, storeSlug: merchant.storeSlug, melhorEnvioEnabled: false, cryptoPaymentsEnabled: false, storeSettings: json({ qaSeedVersion: CASHBACK_QA_NAMESPACE, qaOnly: true, providerDeliveryDisabled: true }) } });
        const existingOwner = await prisma.merchantUser.findUnique({ where: { email: merchant.ownerEmail } });
        if (existingOwner && (existingOwner.id !== merchant.ownerId || existingOwner.merchantId !== merchant.id)) fail("cashback_seed_owner_collision");
        await prisma.merchantUser.upsert({ where: { id: merchant.ownerId }, update: {}, create: { id: merchant.ownerId, merchantId: merchant.id, email: merchant.ownerEmail, role: "owner", passwordHash } });
        if(merchant.key === "specific") await prisma.merchantUser.upsert({where:{id:qaId("staff-specific")},update:{},create:{id:qaId("staff-specific"),merchantId:merchant.id,email:`${qaId("staff-specific")}@cashback.invalid`,role:"staff",passwordHash}});
        await prisma.merchantBillingSubscription.upsert({ where: { merchantId: merchant.id }, update: {}, create: { merchantId: merchant.id, status: merchant.billingPlan === "starter" ? "starter" : "active", planKey: merchant.billingPlan, provider: "qa_seed_no_provider" } });
        await prisma.merchantRule.upsert({ where: { merchantId: merchant.id }, update: {}, create: { merchantId: merchant.id, maxDiscountPercent: 20, minimumMarginPercent: merchant.key === "margin" ? 38 : 0, allowFreeShipping: true, allowShippingDiscount: true, allowBonusItem: false, allowStackDiscountAndFreeShipping: true, couponBoxEnabled: true, freeShippingMinCartValue: 100, maxShippingSubsidy: 10, maxPartialShippingDiscount: 5, offerExpirationMinutes: 15, blockedRegions: [], brandVoice: "QA cashback", originZip: "01001000" } });
        for (const buyer of manifest.buyers) {
          await prisma.buyerIdentity.upsert({ where: { merchantId_identityKey: { merchantId: merchant.id, identityKey: `email:${buyer.email}` } }, update: {}, create: { merchantId: merchant.id, identityKey: `email:${buyer.email}`, globalUserId: buyer.id } });
          for (const channel of ["email", "whatsapp"]) await prisma.campaignContactConsent.upsert({ where: { merchantId_globalUserId_channel_purpose: { merchantId: merchant.id, globalUserId: buyer.id, channel, purpose: "marketing" } }, update: { status: "revoked", revokedAt: reference }, create: { merchantId: merchant.id, globalUserId: buyer.id, channel, purpose: "marketing", status: "revoked", policyVersion: CASHBACK_QA_NAMESPACE, source: "qa_seed", evidence: json({ synthetic: true, noContactAuthorized: true }), revokedAt: reference } });
        }
        for (const type of ["cashback_available", "cashback_expiring"]) for (const channel of ["email", "whatsapp"]) await prisma.postSaleMessageTemplate.upsert({ where: { merchantId_type_channel: { merchantId: merchant.id, type, channel } }, update: { isActive: false }, create: { id: qaId(`${merchant.key}-${type}-${channel}`), merchantId: merchant.id, type, channel, name: "QA inativo", body: "QA: nao enviar", isActive: false } });
      }
    });
    await step("memberships-v1",()=>ensureSeedMemberships(prisma,manifest.merchants));
    await step("communications-catalog-v2",()=>ensureSeedTemplatesInactive(prisma,manifest.merchants));
    for (const merchant of manifest.merchants) for (const type of TYPES) {
      const productId = qaId(`${merchant.key}-product-${type}`), variantId = qaId(`${merchant.key}-variant-${type}`), costCents = merchant.key === "margin" ? 5000 : 2000;
      manifest.catalog.push({ merchantId: merchant.id, type, productId, variantId, priceCents: 10000, costCents });
      await step(`catalog:${merchant.key}:${type}`, async () => {
        await prisma.product.upsert({ where: { id: productId }, update: {}, create: { id: productId, merchantId: merchant.id, name: `QA Cashback ${type}`, type, slug: productId, description: "Fixture QA sem entrega ou provedor.", metadata: json({ qaSeedVersion: CASHBACK_QA_NAMESPACE }) } });
        await prisma.productVariant.upsert({ where: { id: variantId }, update: {}, create: { id: variantId, productId, sku: variantId, ...(type === "physical" || type === "food" ? { weightGrams: 100, lengthCm: 10, widthCm: 10, heightCm: 10 } : {}) } });
        await prisma.productPrice.upsert({ where: { variantId }, update: {}, create: { id: qaId(`${merchant.key}-price-${type}`), variantId, basePriceInCents: 10000, costInCents: costCents } });
        await prisma.productStock.upsert({ where: { id: qaId(`${merchant.key}-stock-${type}`) }, update: {}, create: { id: qaId(`${merchant.key}-stock-${type}`), variantId, quantity: 100 } });
      });
    }
    for (const key of CASHBACK_QA_MERCHANT_KEYS) await step(`program:${key}`, async () => {
      if (key === "disabled") return;
      await cashback.saveDraft(qaMerchantId(key), key === "draft" ? {} : rulesFor(key), qaId(`owner-${key}`));
      if (key !== "draft") await cashback.publishProgram(qaMerchantId(key), qaId(`owner-${key}`), { requireCombination: true });
    });

    const makeSession = async (key: CashbackQaMerchantKey, caseKey: string, type: ProductType = "physical", buyerId = CASHBACK_QA_BUYER, amount = 100): Promise<CheckoutSession> => {
      const recordId = qaId(`${key}-sessionrow-${caseKey}`), sessionId = cashbackQaSessionId(key,caseKey);
      const cart: CheckoutSession["cart"] = { currency: "BRL", total: amount, items: [{ sku: qaId(`${key}-variant-${type}`), variantId: qaId(`${key}-variant-${type}`), product_id: qaId(`${key}-product-${type}`), name: `QA Cashback ${type}`, price: amount, cost: key === "margin" ? 50 : 20, quantity: 1, productType: type }] };
      const record = await prisma.checkoutSession.upsert({ where: { merchantId_sessionId: { merchantId: qaMerchantId(key), sessionId } }, update: {}, create: { id: recordId, merchantId: qaMerchantId(key), sessionId, globalUserId: buyerId, conversationId: qaId(`${key}-conversation-${caseKey}`), cart: json(cart), createdAt: reference, updatedAt: reference } });
      return { merchantId: record.merchantId, sessionId: record.sessionId, globalUserId: record.globalUserId, conversationId: record.conversationId, cart: record.cart as unknown as CheckoutSession["cart"], shipping: record.shipping as unknown as CheckoutSession["shipping"], abandonmentScore: 0, triggerAgent: false, chatHistory: [], createdAt: record.createdAt.toISOString(), updatedAt: record.updatedAt.toISOString() };
    };
    const fund = async (key: CashbackQaMerchantKey, amountCents = 3000, buyerId = CASHBACK_QA_BUYER, suffix = "initial") => {
      const commandKey = qaId(`${key}-fund-${suffix}`);
      const existing = await prisma.$queryRaw<Array<{ command_key: string }>>`SELECT command_key FROM cashback_event_receipts WHERE merchant_id=${qaMerchantId(key)} AND command_key=${`adjust:${commandKey}`}`;
      if (!existing.length) await cashback.adjustWallet(qaMerchantId(key), buyerId, { amountCents, reason: `Seed QA ${CASHBACK_QA_NAMESPACE}`, idempotencyKey: commandKey, expiryDays: null }, qaId(`owner-${key}`));
    };
    const compose = async (input: CheckoutSession, couponValue = 10, advancedValue = 5) => {
      let s = input;
      if (couponValue) {
        const couponId = qaId(`${s.sessionId}-coupon`), redemptionId = qaId(`${s.sessionId}-redemption`);
        await prisma.coupon.upsert({ where: { id: couponId }, update: {}, create: { id: couponId, merchantId: s.merchantId, code: "QACASH10", discountType: "fixed", discountValue: couponValue, startsAt: new Date(reference.getTime() - DAY), endsAt: new Date(reference.getTime() + 30*DAY) } });
        await prisma.couponRedemption.upsert({ where: { id: redemptionId }, update: {}, create: { id: redemptionId, couponId, merchantId: s.merchantId, sessionId: s.sessionId, buyerGlobalUserId: s.globalUserId, discountApplied: couponValue, source: "qa_authorized_fixture" } });
        s = (await benefits.applyCoupon(s, { redemption_id: redemptionId, discount_applied: couponValue, coupon: { id: couponId, code: "QACASH10" } }))!;
      }
      if (advancedValue) {
        const offer: AuthorizedOffer = { id: qaId(`${s.sessionId}-offer`), merchantId: s.merchantId, sessionId: s.sessionId, type: "discount_fixed", value: advancedValue, approved: true, reason: "QA server-authorized fixture", marginAfterOffer: 0.6, expiresAt: new Date(reference.getTime() + 30*DAY).toISOString() };
        await prisma.authorizedOffer.upsert({ where: { id: offer.id }, update: {}, create: { ...offer, expiresAt: new Date(offer.expiresAt) } });
        s = (await benefits.applyAdvancedRule(s, offer))!;
        await prisma.acceptedOffer.upsert({ where: { merchantId_sessionId_offerId: { merchantId: s.merchantId, sessionId: s.sessionId, offerId: offer.id } }, update: {}, create: { id: qaId(`${s.sessionId}-accepted`), merchantId: s.merchantId, sessionId: s.sessionId, offerId: offer.id, type: offer.type, value: offer.value, marginAfterOffer: offer.marginAfterOffer, acceptedAt: reference, expiresAt: new Date(offer.expiresAt) } });
      }
      return s;
    };
    const payment = async (s: CheckoutSession, kind: string, status = "approved", completedAt = reference, fulfilledAt: Date | null = null) => {
      const paymentKey = qaId(`${s.sessionId}-paykey`), id = qaId(`${s.sessionId}-payment`), orderId = qaId(`${s.sessionId}-order`);
      const binding = await cashback.preparePayment(s, paymentKey);
      const gross = Math.round(s.cart.items.reduce((sum, line) => sum + line.price * line.quantity, 0)*100), discount = Math.round((s.cart.currentDiscount ?? 0)*100), total = gross-discount-binding.cashbackCents;
      const breakdown = { version: 1, currency: "BRL", cartFingerprint: paymentCartFingerprint(s), itemsSubtotalCents: gross, discountCents: discount, cashbackCents: binding.cashbackCents, cashbackReservationId: binding.reservationId, cashbackEarningQuoteId: binding.earningQuoteId, shippingCents: 0, platformFeeCents: 99, totalCents: total+99 };
      const providerFixtureAt=status === "pending"?new Date(reference.getTime()-2*DAY):reference;
      await prisma.paymentIntent.upsert({ where: { id }, update: {}, create: { id, merchantId: s.merchantId, sessionId: s.sessionId, idempotencyKey: paymentKey, amountCents: total+99, currency: "BRL", method: "qa_no_provider", status, amountBreakdown: json(breakdown), creation: json({ qaSeedVersion: CASHBACK_QA_NAMESPACE, syntheticProviderState: true, noProviderCall: true }), statusHistory: json([{ status, source: "qa_seed_no_provider", at: providerFixtureAt.toISOString() }]),createdAt:providerFixtureAt } });
      await cashback.bindPayment(s.merchantId, s.sessionId, paymentKey, id);
      if(status === "pending"&&binding.earningQuoteId)await prisma.$executeRaw`UPDATE cashback_earning_quotes SET created_at=${providerFixtureAt} WHERE merchant_id=${s.merchantId} AND id=${binding.earningQuoteId}`;
      if (status === "approved") {
        await prisma.completedOrder.upsert({ where: { id: orderId }, update: {}, create: { id: orderId, merchantId: s.merchantId, sessionId: s.sessionId, externalOrderId: orderId, orderTotal: total/100, currency: "BRL", status: "approved", completedAt, fulfilledAt, shippingCents: 0, lineItemsJson: json(s.cart.items) } });
        await cashback.confirmedPayment({ merchantId: s.merchantId, paymentIntentId: id, session: s, orderId, orderTotalCents: total });
      }
      return { id, merchantId: s.merchantId, orderId: status === "approved" ? orderId : null, kind, amountCents: total+99, synthetic: true as const };
    };
    const addCase = (key: string, s: CheckoutSession, expected: CashbackSeedCase["expected"], channel: "website" | "whatsapp" = "website", fixture?: string) => {
      const merchantKey=manifest.merchants.find(m=>m.id === s.merchantId)!.key;
      const possible=["stacking","whatsapp","blocked","margin","balance","disabled","await-fulfillment","uncertain","editable"];
      const caseKey=possible.find(name=>cashbackQaSessionId(merchantKey,name) === s.sessionId);if(!caseKey)fail("cashback_seed_case_nonce_missing");
      manifest.cases.push({ key, merchantId: s.merchantId, sessionId: s.sessionId, buyerId: CASHBACK_QA_BUYER, embedNonce:cashbackQaEmbedNonce(merchantKey,caseKey),channel, expected, ...(fixture ? { fixture } : {}) });
    };

    // Link a previously used WhatsApp identity to the canonical website account.
    await step("verified-shared-identity", async () => {
      const wa = await makeSession("specific", "whatsapp", "physical", CASHBACK_QA_PREVIOUS_WA_BUYER);
      await prisma.buyerIdentity.upsert({ where: { merchantId_identityKey: { merchantId: wa.merchantId, identityKey: `phone:${CASHBACK_QA_PHONE}` } }, update: {}, create: { merchantId: wa.merchantId, identityKey: `phone:${CASHBACK_QA_PHONE}`, globalUserId: CASHBACK_QA_PREVIOUS_WA_BUYER } });
      await prisma.whatsAppSession.upsert({ where: { merchantId_buyerPhone_deviceId: { merchantId: wa.merchantId, buyerPhone: CASHBACK_QA_PHONE, deviceId: qaId("no-real-device") } }, update: {}, create: { id: qaId("whatsapp-session"), merchantId: wa.merchantId, buyerPhone: CASHBACK_QA_PHONE, deviceId: qaId("no-real-device"), checkoutSessionId: wa.sessionId } });
      await fund("specific",1000,CASHBACK_QA_PREVIOUS_WA_BUYER,"wa-before-link"); await fund("specific",2000,CASHBACK_QA_BUYER,"site-before-link");
      const verificationId = qaId("synthetic-possession-proof-not-real-otp");
      await prisma.$executeRaw`INSERT INTO buyer_verified_phones(phone,buyer_id,verification_id) VALUES(${CASHBACK_QA_PHONE},${CASHBACK_QA_BUYER},${verificationId}) ON CONFLICT(phone) DO NOTHING`;
      await cashback.linkVerifiedIdentity({ merchantId: wa.merchantId, previousBuyerId: CASHBACK_QA_PREVIOUS_WA_BUYER, canonicalBuyerId: CASHBACK_QA_BUYER, verificationId });
    });
    for (const key of ["specific", "general"] as const) {
      await step(`stacking:${key}`, async () => {
        if (key === "general") await fund(key);
        const s = await compose(await makeSession(key,"stacking"));
        await cashback.reserveCheckout(s,key === "specific" ? 1500 : 500,qaId(`${key}-reserve-stacking`));
        await payment(s,"frozen stacking read fixture","pending");
      });
      const s = await makeSession(key,"stacking");
      addCase(`${key}-100-10-5-cash`,s,{ eligible:true,reason:null,reservedCents:key === "specific" ? 1500:500,productsCents:10000,discountCents:1500,cashbackCents:key === "specific" ? 1500:500,netProductsCents:key === "specific" ? 7000:8000 });
      const p=await prisma.paymentIntent.findUniqueOrThrow({where:{id:qaId(`${s.sessionId}-payment`)}}); manifest.payments.push({id:p.id,merchantId:p.merchantId,orderId:null,kind:"stacking pending fixture",amountCents:p.amountCents,synthetic:true});
    }
    const wa=await makeSession("specific","whatsapp"); addCase("same-account-whatsapp",wa,{eligible:true,reason:null},"whatsapp","Durable QA proof simulates verified ownership; not a real OTP or WhatsApp delivery.");
    await makeSession("specific","editable");
    await step("widget-source-cart-v1",()=>ensureSeedWidgetSource(prisma));
    for (const key of ["blocked-coupon","blocked-rule"] as const) {
      await step(`blocked:${key}`,async()=>{await fund(key);await compose(await makeSession(key,"blocked"),key === "blocked-coupon"?10:0,key === "blocked-rule"?5:0);});
      addCase(key,await makeSession(key,"blocked"),{eligible:false,maximumRedeemCents:0,reason:key === "blocked-coupon"?"cashback_coupon_combination_not_allowed":"cashback_rule_combination_not_allowed"});
    }
    await step("margin",async()=>{await fund("margin");await makeSession("margin","margin");});
    addCase("minimum-margin",await makeSession("margin","margin"),{eligible:true,reason:null,maximumRedeemCents:1379});
    for(const key of ["paused","ended","isolation"] as const){
      await step(`state:${key}`,async()=>{await fund(key,key === "isolation"?777:3000);await makeSession(key,"balance");if(key !== "isolation")await cashback.pauseProgram(qaMerchantId(key),qaId(`owner-${key}`),key === "ended");});
      addCase(key,await makeSession(key,"balance"),{eligible:true,reason:null,maximumRedeemCents:key === "isolation"?777:3000,...(key !== "isolation"?{estimatedEarnCents:0}:{})});
    }
    for(const key of ["disabled","draft"] as const)addCase(key,await makeSession(key,"disabled"),{eligible:false,reason:"cashback_disabled",maximumRedeemCents:0});
    await step("catalog-earnings",async()=>{for(const type of TYPES)await payment(await makeSession("specific",`paid-${type}`,type),`approved ${type}`);});
    for(const type of TYPES){const id=qaId(`${cashbackQaSessionId("specific",`paid-${type}`)}-payment`);const p=await prisma.paymentIntent.findUniqueOrThrow({where:{id}});manifest.payments.push({id,merchantId:p.merchantId,orderId:qaId(`${p.sessionId}-order`),kind:`approved ${type}`,amountCents:p.amountCents,synthetic:true});}
    await step("fulfillment",async()=>{await payment(await makeSession("fulfillment","await-fulfillment","service"),"awaiting fulfillment");});
    addCase("pending-fulfillment-award",await makeSession("fulfillment","await-fulfillment","service"),{eligible:true},"website","Approved synthetic payment; earned credit awaits persisted fulfillment.");
    await step("expiry",async()=>{await payment(await makeSession("expiry","expired","digital"),"expired award","approved",new Date(reference.getTime()-5*DAY));await payment(await makeSession("expiry","expiring","food"),"expiring award","approved",new Date(reference.getTime()-DAY));});
    await step("pending",async()=>{await fund("pending");const s=await makeSession("pending","uncertain");await cashback.reserveCheckout(s,1000,qaId("pending-reserve"));await payment(s,"pending no provider","pending");});
    addCase("pending-payment",await makeSession("pending","uncertain"),{reservedCents:1000},"website","Pending state is an explicit PSP fixture; no real pending provider payment exists.");
    await step("refund",async()=>{
      await fund("refund");let s=await makeSession("refund","partial-refund");
      if(!s.cart.items[0] || s.cart.items[0].quantity === 1){s={...s,cart:{...s.cart,items:[{...s.cart.items[0]!,price:50,cost:10,quantity:2}]}};await prisma.checkoutSession.update({where:{merchantId_sessionId:{merchantId:s.merchantId,sessionId:s.sessionId}},data:{cart:json(s.cart)}});}
      await cashback.reserveCheckout(s,2000,qaId("refund-reserve"));const p=await payment(s,"partially refunded");
      await cashback.processRefundOrder({merchantId:s.merchantId,orderId:p.orderId!,returnedItems:[{variantId:s.cart.items[0]!.variantId!,quantity:1}],commandKey:qaId("refund-first-half"),providerRefundId:qaId("synthetic-refund-no-provider")});
    });
    const refundSession=await makeSession("refund","partial-refund"),refundOrder=qaId(`${refundSession.sessionId}-order`);
    const preview=await cashback.previewRefundOrder({merchantId:refundSession.merchantId,orderId:refundOrder,returnedItems:[{variantId:refundSession.cart.items[0]!.variantId!,quantity:1}]});
    if(!preview)fail("cashback_seed_refund_preview_missing");assertEqual({external:preview.externalRefundCents,cashback:preview.cashbackRestoreCents,full:preview.fullOrderReturn},{external:4099,cashback:1000,full:true},"cashback_seed_refund_allocation_mismatch"); manifest.refunds.push({merchantId:refundSession.merchantId,orderId:refundOrder,externalRefundCents:4099,cashbackRestoreCents:1000,fullOrderReturn:true});
    await step("loss-after-spent-source",async()=>{
      const source=await payment(await makeSession("loss","source","digital",CASHBACK_QA_BUYER,200),"source credit later revoked");
      const spend=await makeSession("loss","spent","digital");await cashback.reserveCheckout(spend,1000,qaId("loss-spend-reserve"));await payment(spend,"spent source credit");
      await prisma.paymentIntent.update({where:{id:source.id},data:{status:"refunded"}});
      await cashback.confirmedExternalRefund({merchantId:source.merchantId,paymentIntentId:source.id});
    });
    await step("other-buyer",async()=>{await fund("specific",200,CASHBACK_QA_OTHER_BUYER,"other-buyer");});
    for(const p of await prisma.paymentIntent.findMany({where:{merchantId:{in:manifest.merchants.map(m=>m.id)}},orderBy:{id:"asc"}}))if(!manifest.payments.some(item=>item.id === p.id)){
      const order=await prisma.completedOrder.findFirst({where:{merchantId:p.merchantId,sessionId:p.sessionId},select:{id:true}});
      manifest.payments.push({id:p.id,merchantId:p.merchantId,orderId:order?.id??null,kind:`synthetic ${p.status}`,amountCents:p.amountCents,synthetic:true});
    }

    manifest.expectedWallets = {
      specific:{availableCents:3500,reservedCents:1500,pendingCents:0,usedCents:0}, general:{availableCents:2500,reservedCents:500},
      "blocked-coupon":{availableCents:3000,reservedCents:0},"blocked-rule":{availableCents:3000,reservedCents:0},margin:{availableCents:3000},
      paused:{availableCents:3000},ended:{availableCents:3000},isolation:{availableCents:777},fulfillment:{pendingCents:500,availableCents:0},
      expiry:{availableCents:500,expiredCents:500},pending:{availableCents:2000,reservedCents:1000},refund:{availableCents:2200,usedCents:1000,reversedCents:200},loss:{availableCents:450,lossCents:1000,usedCents:1000,reversedCents:1000}
    };
    manifest.expectedMetrics = {specific:{grantedCents:2000,releasedCents:2000,availableCents:3700,reservedCents:1500},general:{availableCents:2500,reservedCents:500},fulfillment:{grantedCents:500,pendingCents:500},expiry:{grantedCents:1000,expiredCents:500,availableCents:500},refund:{grantedCents:400,redeemedCents:2000,restoredCents:1000,reversedCents:200,availableCents:2200},loss:{lossCents:1000,availableCents:450}};
    for(const key of ["specific","general","pending"] as const)manifest.expectedReconciliationIssues[qaMerchantId(key)]=["cashback_payment_requires_reconciliation"];
    for(const item of manifest.cases)manifest.httpChecks.push({key:`quote:${item.key}`,method:"POST",route:"/embed/cashback/quote",merchantId:item.merchantId,buyerId:item.buyerId,body:{session_id:item.sessionId},expectedStatus:201,expected:item.expected});
    for(const merchant of manifest.merchants){manifest.httpChecks.push({key:`program:${merchant.key}`,method:"GET",route:"/dashboard/cashback/program",merchantId:merchant.id,expectedStatus:200});manifest.httpChecks.push({key:`wallet:${merchant.key}`,method:"GET",route:`/buyer/me/cashback?merchant_id=${merchant.id}`,merchantId:merchant.id,buyerId:CASHBACK_QA_BUYER,expectedStatus:200,expected:manifest.expectedWallets[merchant.key]??{availableCents:0}});}
    manifest.httpChecks.push({key:"tenant-isolation-owner",method:"GET",route:"/dashboard/cashback/customers",merchantId:qaMerchantId("isolation"),expectedStatus:200,expected:{forbiddenBuyerBalancesFromOtherMerchants:true}});
    await validateCashbackSeedManifest(prisma,manifest);
    marker.manifest=manifest;await mark();
    if(options.manifestPath)await writeManifest(options.manifestPath,manifest);
    return manifest;
  } finally { await guardConnection.query("SELECT pg_advisory_unlock(hashtextextended($1,0))::text",[lock]).catch(()=>undefined);await guardConnection.end();await prisma.$disconnect(); }
}

/** Independent HTTP still has to prove route auth, DI and presentation. */
export async function validateCashbackSeedManifest(prisma:PrismaClient,manifest:CashbackSeedManifest):Promise<void>{
  const repository=new CashbackRepository(prisma),cashback=new CashbackService(repository),queries=new CashbackQueriesService(repository,cashback);
  for(const merchant of manifest.merchants){const member=await prisma.merchantTeamMember.findUnique({where:{merchantId_userId:{merchantId:merchant.id,userId:merchant.ownerId}}});if(member?.role !== "OWNER")fail("cashback_seed_owner_membership_missing");}
  const staff=await prisma.merchantTeamMember.findUnique({where:{merchantId_userId:{merchantId:qaMerchantId("specific"),userId:qaId("staff-specific")}}});if(staff?.role !== "STAFF")fail("cashback_seed_staff_membership_missing");
  for(const item of manifest.cases){const row=await prisma.checkoutSession.findUniqueOrThrow({where:{merchantId_sessionId:{merchantId:item.merchantId,sessionId:item.sessionId}}});const session={merchantId:row.merchantId,sessionId:row.sessionId,globalUserId:row.globalUserId,cart:row.cart,shipping:row.shipping} as unknown as CheckoutSession;const actual=await cashback.quoteCheckout(session);for(const [key,value]of Object.entries(item.expected)){if(["productsCents","discountCents","cashbackCents","netProductsCents"].includes(key))continue;assertEqual(actual[key as keyof CashbackCheckoutQuote],value,`cashback_seed_quote_mismatch:${item.key}:${key}`);}
    if(item.expected.netProductsCents!==undefined){const gross=session.cart.items.reduce((n,i)=>n+Math.round(i.price*100)*i.quantity,0),net=gross-Math.round((session.cart.currentDiscount??0)*100)-await cashback.checkoutCashbackCents(session);assertEqual(net,item.expected.netProductsCents,`cashback_seed_net_mismatch:${item.key}`);}}
  for(const [key,expected]of Object.entries(manifest.expectedWallets)){const actual=await cashback.wallet(qaMerchantId(key as CashbackQaMerchantKey),CASHBACK_QA_BUYER);for(const [field,value]of Object.entries(expected))assertEqual(actual.balance[field as keyof CashbackBalance],value,`cashback_seed_wallet_mismatch:${key}:${field}`);}
  for(const [key,expected]of Object.entries(manifest.expectedMetrics)){const actual=await queries.metrics(qaMerchantId(key as CashbackQaMerchantKey),{});for(const [field,value]of Object.entries(expected))assertEqual(actual[field as keyof typeof actual],value,`cashback_seed_metrics_mismatch:${key}:${field}`);}
  const site=await cashback.wallet(qaMerchantId("specific"),CASHBACK_QA_BUYER),wa=await cashback.wallet(qaMerchantId("specific"),CASHBACK_QA_PREVIOUS_WA_BUYER);assertEqual(wa.buyerId,site.buyerId,"cashback_seed_canonical_identity_mismatch");assertEqual(wa.balance,site.balance,"cashback_seed_channel_wallet_mismatch");
  const claims=await prisma.campaignContactConsent.count({where:{merchantId:{in:manifest.merchants.map(m=>m.id)},status:"granted"}});if(claims)fail("cashback_seed_contact_consent_not_disabled");
  const templateMerchants=[REGISTRY,...manifest.merchants.map(m=>m.id)];
  const templates=await prisma.postSaleMessageTemplate.findMany({where:{merchantId:{in:templateMerchants}},select:{merchantId:true,type:true,channel:true,isActive:true}});
  if(templates.some(template=>template.isActive))fail("cashback_seed_message_template_active");
  const templateKeys=new Set(templates.map(template=>JSON.stringify([template.merchantId,template.type,template.channel])));
  for(const merchantId of templateMerchants)for(const type of WHATSAPP_TEMPLATE_TYPES)for(const channel of ["email","whatsapp"])
    if(!templateKeys.has(JSON.stringify([merchantId,type,channel])))fail("cashback_seed_template_catalog_incomplete");
  if(await prisma.merchantPaymentConnection.count({where:{merchantId:{in:manifest.merchants.map(m=>m.id)}}}))fail("cashback_seed_real_provider_connection_present");
  for(const merchant of manifest.merchants){const result=await cashback.reconcile(merchant.id),codes=[...new Set(result.issues.map(item=>item.code))].sort();assertEqual(codes,manifest.expectedReconciliationIssues[merchant.id]??[],`cashback_seed_reconciliation_mismatch:${merchant.key}`);}
}
async function writeManifest(path:string,manifest:CashbackSeedManifest){const target=resolve(path);await mkdir(dirname(target),{recursive:true});await writeFile(target,JSON.stringify(manifest,null,2)+"\n",{mode:0o600});}
export async function runCashbackSeedCli(env:NodeJS.ProcessEnv=process.env):Promise<void>{
  const manifest=await seedCashbackValidation({databaseUrl:env.CASHBACK_QA_DATABASE_URL??"",environment:env.CASHBACK_QA_ENV as "local"|"homolog",confirmation:env.CASHBACK_QA_CONFIRM??"",expectedHost:env.CASHBACK_QA_EXPECT_HOST,expectedDatabase:env.CASHBACK_QA_EXPECT_DATABASE,deploymentEnvironment:env.CASHBACK_QA_DEPLOYMENT_ENVIRONMENT,runtimeEnvironment:env,ownerPassword:env.CASHBACK_QA_OWNER_PASSWORD??"",manifestPath:env.CASHBACK_QA_MANIFEST_PATH});
  process.stdout.write(JSON.stringify({version:manifest.version,environment:manifest.environment,merchants:manifest.merchants.length,cases:manifest.cases.length,externalCalls:0,manifestWritten:Boolean(env.CASHBACK_QA_MANIFEST_PATH)})+"\n");
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)runCashbackSeedCli().catch(error=>{process.stderr.write(`${error instanceof CashbackSeedError?error.code:"cashback_seed_failed_details_redacted"}\n`);process.exitCode=1;});

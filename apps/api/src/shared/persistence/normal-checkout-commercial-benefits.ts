import type { Prisma } from "@prisma/client";
import { UnprocessableEntityException } from "@nestjs/common";
import { z } from "zod";
import type { Cart, CheckoutEventName } from "@zyon/shared-types";
import { moneyCents } from "@zyon/rules-engine";
import { toCheckoutSession } from "../../modules/checkout/domain/services/checkout-session-projection.js";
import { toMerchantRules } from "../../modules/checkout/infrastructure/prisma/merchant-rules.mapper.js";
import { DEFAULT_PROGRESSIVE_DISCOUNT_STAGES } from "../../modules/checkout/domain/services/progressive-discount-policy.service.js";
import { assertNormalCommercialGrantBasis, createNormalPolicyBenefitAuthorization, normalCommercialBenefitHash,
  normalCommercialBasisCart, NormalCommercialBenefitReviewRequired, type NormalCommercialPaymentMethod } from "../../modules/checkout/domain/services/normal-commercial-benefit-proof.js";
import { NORMAL_COMMERCIAL_BENEFIT_EVENT, normalCommercialBenefitAuthorizationSchema,
  normalCheckoutPolicyDiscountOwnerSchema, normalCheckoutAcceptedOfferDiscountOwnerSchema } from "../../modules/checkout/domain/contracts/normal-commercial-benefit-proof.schemas.js";

const id = z.string().min(1).max(200), method = z.enum(["pix", "card", "boleto", "crypto"]);
const stage = z.number().finite().min(0).max(100);
const progressiveSchema = z.object({ enabled: z.boolean(), mode: z.enum(["progressive_only", "coupon_only", "both"]).optional(),
  maxProgressivePercent: stage.optional(), stages: z.object({ initial_coupon: stage.optional(), exit_intent: stage.optional(),
    abandoned_cart: stage.optional(), payment_nudge: stage.optional() }).optional() }).transform(value => ({ ...value,
      stages: { ...DEFAULT_PROGRESSIVE_DISCOUNT_STAGES, ...value.stages } }));
const advancedSchema = z.array(z.object({ id: id.optional(), productId: id.optional(), enabled: z.boolean(), priority: z.number().finite(),
  conditions: z.array(z.object({ field: z.string(), operator: z.string(), value: z.union([z.string(), z.number().finite(), z.boolean(), z.array(z.string())]) })).max(100),
  action: z.object({ type: z.string(), params: z.record(z.string(), z.union([z.string(), z.number().finite(), z.boolean()])) }) })).max(20);
const scopeSchema = z.object({ merchantId: id, sessionId: id, globalUserId: id, version: z.number().int().min(0).max(2_147_483_646) });
export type NormalCommercialStoredScope = z.infer<typeof scopeSchema>;
export interface NormalCommercialReadInput { stored: NormalCommercialStoredScope; canonicalCart: Cart; now: Date }
const fail = (reason: string): never => { throw new NormalCommercialBenefitReviewRequired(reason); };
export const normalCommercialBenefitReview = () => new UnprocessableEntityException({ code: "cross_sell_quote_review_required",
  message: "As condições do benefício mudaram. Revise o pedido antes de pagar." });

/** Real scoped rows only. No default policy provisioning, network, private key,
 * caller-supplied buyer/method authority or detached transaction is introduced. */
export async function readNormalCommercialPolicyContext(tx: Prisma.TransactionClient, input: NormalCommercialReadInput, selectedMethod?: NormalCommercialPaymentMethod) {
  const scope = scopeSchema.parse(input.stored);
  const stored = await tx.checkoutSession.findUnique({ where: { merchantId_sessionId: { merchantId: scope.merchantId, sessionId: scope.sessionId } } });
  if (!stored || stored.merchantId !== scope.merchantId || stored.sessionId !== scope.sessionId || stored.globalUserId !== scope.globalUserId
    || stored.version !== scope.version) return fail("session_changed");
  const row = await tx.merchantRule.findUnique({ where: { merchantId: scope.merchantId }, select: {
    merchantId:true,maxDiscountPercent:true,allowFreeShipping:true,allowShippingDiscount:true,allowBonusItem:true,
    allowStackDiscountAndFreeShipping:true,freeShippingMinCartValue:true,maxShippingSubsidy:true,maxPartialShippingDiscount:true,
    offerExpirationMinutes:true,blockedRegions:true,brandVoice:true,couponBoxEnabled:true,autonomousEngineEnabled:true } });
  if (!row || row.merchantId !== scope.merchantId) return fail("policy_missing");
  // Minimum margin is informational and deliberately excluded from eligibility
  // and the fingerprint; even a malformed analytics value cannot block a grant.
  const rules = toMerchantRules({ maxDiscountPercent: row.maxDiscountPercent, minimumMarginPercent: Number.NaN,
    allowFreeShipping: row.allowFreeShipping, allowShippingDiscount: row.allowShippingDiscount, allowBonusItem: row.allowBonusItem,
    allowStackDiscountAndFreeShipping: row.allowStackDiscountAndFreeShipping, freeShippingMinCartValue: row.freeShippingMinCartValue,
    maxShippingSubsidy: row.maxShippingSubsidy, maxPartialShippingDiscount: row.maxPartialShippingDiscount,
    offerExpirationMinutes: row.offerExpirationMinutes, blockedRegions: row.blockedRegions, brandVoice: row.brandVoice,
    couponBoxEnabled: row.couponBoxEnabled, autonomousEngineEnabled: row.autonomousEngineEnabled });
  const setting = await tx.checkoutSetting.findUnique({ where: { merchantId: scope.merchantId },
    select:{merchantId:true,interventionPolicy:true,advancedRules:true} });
  if (setting && setting.merchantId !== scope.merchantId) return fail("policy_scope_invalid");
  const intervention = z.object({ progressiveDiscount: progressiveSchema.optional() }).parse(setting?.interventionPolicy ?? {});
  let advancedRules = advancedSchema.parse(setting?.advancedRules ?? []);
  // Match the existing experiment shaper's control-arm exclusion. Reviewed
  // recipe-reference variants remain disabled as in PromptExperimentAdapter.
  await tx.$queryRaw`SELECT id FROM prompt_experiments WHERE merchant_id=${scope.merchantId} AND status='running' FOR SHARE`;
  const experiments = await tx.promptExperiment.findMany({ where: { merchantId: scope.merchantId, status: "running" }, select: { id:true }, take: 2 });
  if (experiments.length > 1) return fail("experiment_ambiguous");
  const experiment = experiments[0];
  let assignment: { id: string; isControl: boolean; appliedRuleId: string | null } | undefined;
  if (experiment) {
    await tx.$queryRaw`SELECT id FROM prompt_variants WHERE experiment_id=${experiment.id} FOR SHARE`;
    const variants = await tx.promptVariant.findMany({where:{experimentId:experiment.id},
      select:{id:true,weight:true,isControl:true,appliedRuleId:true,systemPrompt:true},take:101});
    if(variants.length>100)return fail("experiment_ambiguous");
    let selected = stored.promptVariantId ? variants.find(variant => variant.id === stored.promptVariantId) : undefined;
    if (!stored.promptVariantId && variants.length) {
      let hash = 0; for (let index = 0; index < scope.sessionId.length; index++) hash = ((hash << 5) - hash + scope.sessionId.charCodeAt(index)) | 0;
      const total = variants.reduce((sum, variant) => sum + variant.weight, 0);
      if (total > 0) { let target = Math.abs(hash) % total + 1; selected = variants.at(-1);
        for (const variant of variants) { target -= variant.weight; if (target <= 0) { selected = variant; break; } } }
    }
    if (selected && !variants.some(variant=>variant.systemPrompt.includes("checkout-chat-baseline-v1:"))) {
      assignment = { id: selected.id, isControl: selected.isControl, appliedRuleId: selected.appliedRuleId };
      if (selected.isControl) { const ids = new Set(variants.flatMap(variant => variant.appliedRuleId ? [variant.appliedRuleId] : []));
        advancedRules = advancedRules.filter(rule => !rule.id || !ids.has(rule.id)); }
    }
  }
  const rows = await tx.checkoutEvent.findMany({ where: { merchantId: scope.merchantId, sessionId: scope.sessionId,
    eventName: { not: NORMAL_COMMERCIAL_BENEFIT_EVENT } }, select:{id:true,merchantId:true,sessionId:true,eventName:true,occurredAt:true},
    orderBy: [{ occurredAt: "asc" }, { id: "asc" }], take: 10001 });
  if (rows.length > 10000 || rows.some(event => event.merchantId !== scope.merchantId || event.sessionId !== scope.sessionId
    || event.occurredAt.getTime() > input.now.getTime())) return fail("stage_evidence_invalid");
  const events = rows.map(event => ({ id: event.id, eventName: event.eventName as CheckoutEventName }));
  const session = { ...toCheckoutSession(stored), cart: input.canonicalCart };
  const pickedMethod = selectedMethod ?? (stored.paymentMethod === null ? undefined : method.parse(stored.paymentMethod));
  const { minimumMarginPercent: _analytics, brandVoice: _voice, ...commercialRules } = rules;
  return { session, stored, rules, advancedRules, progressivePolicy: intervention.progressiveDiscount, events, method: pickedMethod,
    settingsHash: normalCommercialBenefitHash({ merchantId: scope.merchantId, rules: commercialRules, advancedRules,
      progressive: intervention.progressiveDiscount ?? null, assignment: assignment ?? null }) };
}

export function normalAcceptedOfferTermsHash(offer: { id: string; merchantId: string; sessionId: string; type: string; value: { toNumber(): number }; approved: boolean; expiresAt: Date },
  accepted: { id: string; merchantId: string; sessionId: string; offerId: string; type: string; value: { toNumber(): number }; acceptedAt: Date; expiresAt: Date }) {
  return normalCommercialBenefitHash({ offer: { id: offer.id, merchantId: offer.merchantId, sessionId: offer.sessionId,
    type: offer.type, value: offer.value.toNumber(), approved: offer.approved, expiresAt: offer.expiresAt.toISOString() },
    accepted: { id: accepted.id, merchantId: accepted.merchantId, sessionId: accepted.sessionId, offerId: accepted.offerId,
      type: accepted.type, value: accepted.value.toNumber(), acceptedAt: accepted.acceptedAt.toISOString(), expiresAt: accepted.expiresAt.toISOString() } });
}

export async function readNormalCheckoutCommercialBenefitOwner(tx: Prisma.TransactionClient, input: NormalCommercialReadInput) {
  if (moneyCents(input.canonicalCart.currentDiscount ?? 0) === 0) return undefined;
  try {
    const context = await readNormalCommercialPolicyContext(tx, input);
    const rows = await tx.checkoutEvent.findMany({ where: { merchantId: context.stored.merchantId, sessionId: context.stored.sessionId,
      eventName: NORMAL_COMMERCIAL_BENEFIT_EVENT }, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take: 201 });
    if (!rows.length || rows.length > 200) return fail("authorization_missing");
    const parsed = rows.map(row => ({ row, grant: normalCommercialBenefitAuthorizationSchema.parse(row.metadata) }))
      .sort((a, b) => b.grant.checkoutVersion - a.grant.checkoutVersion);
    const { row, grant } = parsed[0]!;
    if (parsed[1]?.grant.checkoutVersion === grant.checkoutVersion || row.merchantId !== context.stored.merchantId || row.sessionId !== context.stored.sessionId
      || grant.merchantId !== context.stored.merchantId || grant.checkoutSessionId !== context.stored.sessionId || grant.buyerId !== context.stored.globalUserId
      || grant.checkoutVersion > context.stored.version || row.occurredAt.getTime() > input.now.getTime()
      || grant.origin !== "accepted_offer" && grant.paymentMethod !== context.method
      || grant.settingsHash !== context.settingsHash) return fail("authorization_changed");
    const { approvedCart } = assertNormalCommercialGrantBasis(input.canonicalCart, grant, context.rules);
    const stageEvents = grant.stageEventIds.map(id => context.events.find(event => event.id === id));
    if (stageEvents.some(event => !event)) return fail("stage_evidence_invalid");
    const scopedEvents = stageEvents.filter((event): event is NonNullable<typeof event> => event !== undefined);
    const identity = { merchantId: grant.merchantId, checkoutSessionId: grant.checkoutSessionId, buyerId: grant.buyerId,
      discountCents: grant.discountCents, authorizationEventId: row.id };
    if (grant.origin !== "accepted_offer") {
      if(!context.method)return fail("payment_method_required");
      const evaluated = createNormalPolicyBenefitAuthorization({ ...context, method:context.method, session: { ...context.session, cart: approvedCart }, events: scopedEvents });
      if (!evaluated || evaluated.origin !== grant.origin || evaluated.discountCents < grant.discountCents || evaluated.ruleId !== grant.ruleId) return fail("policy_no_longer_eligible");
      return normalCheckoutPolicyDiscountOwnerSchema.parse({ ...identity, kind: "checkout_policy", origin: grant.origin,
        paymentMethod: grant.paymentMethod, settingsHash: grant.settingsHash, eventIds: grant.stageEventIds, ...(grant.ruleId ? { ruleId: grant.ruleId } : {}) });
    }
    if (!grant.offer) return fail("offer_missing");
    await tx.$queryRaw`SELECT id FROM authorized_offers WHERE merchant_id=${grant.merchantId} AND session_id=${grant.checkoutSessionId} AND id=${grant.offer.authorizedOfferId} FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM accepted_offers WHERE merchant_id=${grant.merchantId} AND session_id=${grant.checkoutSessionId} AND id=${grant.offer.acceptedOfferRowId} FOR SHARE`;
    const offer = await tx.authorizedOffer.findFirst({ where: { id: grant.offer.authorizedOfferId, merchantId: grant.merchantId, sessionId: grant.checkoutSessionId } });
    const accepted = await tx.acceptedOffer.findFirst({ where: { id: grant.offer.acceptedOfferRowId, merchantId: grant.merchantId, sessionId: grant.checkoutSessionId,
      offerId: grant.offer.authorizedOfferId } });
    if (!offer || !accepted || !offer.approved || offer.expiresAt.getTime() <= input.now.getTime() || accepted.expiresAt.getTime() <= input.now.getTime()
      || accepted.acceptedAt.getTime() > input.now.getTime() || offer.type !== accepted.type || !offer.value.equals(accepted.value)
      || normalAcceptedOfferTermsHash(offer, accepted) !== grant.offer.termsHash) return fail("offer_changed");
    const requested = offer.type === "discount_fixed" ? moneyCents(offer.value.toNumber())
      : offer.type === "discount_percent" && offer.value.toNumber() >= 0 && offer.value.toNumber() <= 100
        ? Math.round(approvedCart.total * offer.value.toNumber()) : null;
    if (requested === null || requested < grant.discountCents) return fail("offer_amount_invalid");
    return normalCheckoutAcceptedOfferDiscountOwnerSchema.parse({ ...identity, kind: "accepted_offer", ...grant.offer });
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof NormalCommercialBenefitReviewRequired || error instanceof SyntaxError) throw normalCommercialBenefitReview();
    throw error;
  }
}

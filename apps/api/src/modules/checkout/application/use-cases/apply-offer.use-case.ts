import { ConflictException, Inject, Injectable, NotFoundException, Optional , Logger} from "@nestjs/common";
import type {
  ApplyOfferRequest,
  ApplyOfferResponse,
  AuthorizedOffer,
  CheckoutSession,
  ChatTurn,
  MerchantRules,
  CommercialNotice
} from "@zyon/shared-types";
import { z } from "zod";
import { evaluateCombinedDiscount, moneyCents } from "@zyon/rules-engine";
import { CHECKOUT_SESSION_REPOSITORY, type CheckoutSessionRepository } from "../../domain/ports/checkout-session.repository.port.js";
import { OFFER_REPOSITORY, type OfferRepository } from "../../domain/ports/offer.repository.port.js";
import { COMMERCE_OFFER_PORT, type CommerceOfferPort } from "../../domain/ports/commerce-offer.port.js";
import { AcceptCheckoutOfferUseCase } from "./accept-checkout-offer.use-case.js";
import { MERCHANT_REPOSITORY, type MerchantRepository } from "../../../merchant/domain/ports/merchant-repository.port.js";
import { readExistingMerchantRules } from "../../../merchant/application/services/read-existing-merchant-rules.js";
import { buildExperienceFromSession } from "../services/checkout-experience.service.js";
import { CHECKOUT_EXPERIENCE_CONFIG, type CheckoutExperienceConfig } from "../../domain/checkout-experience.config.js";
import { TenantBoundaryGuard } from "../../domain/services/tenant-boundary.guard.js";
import { DEFAULT_PLATFORM_FEE_BRL } from "../../../../shared/config/platform-fee.config.js";
import { commercialNotice } from "../../../storefront/domain/services/commercial-notice.js";
import { NORMAL_CHECKOUT_CROSS_SELL, type NormalCheckoutCrossSellPort } from "../../../cross-sell/domain/ports/normal-checkout-cross-sell.port.js";
import { normalCheckoutOfferCommandSchema } from "../../domain/contracts/normal-commercial-benefit-proof.schemas.js";

const contextualPolicy = z.object({ maxDiscountPercent: z.number().finite().min(0).max(100),
  minimumMarginPercent: z.number().finite().min(0).max(100), merchantId: z.string().optional() });

@Injectable()
export class ApplyOfferUseCase {
  private readonly logger = new Logger(ApplyOfferUseCase.name);

  constructor(
    @Inject(CHECKOUT_SESSION_REPOSITORY) private readonly sessions: CheckoutSessionRepository,
    @Inject(OFFER_REPOSITORY) private readonly offers: OfferRepository,
    @Inject(COMMERCE_OFFER_PORT) private readonly commerce: CommerceOfferPort,
    private readonly acceptCheckoutOffer: AcceptCheckoutOfferUseCase,
    @Optional() @Inject(MERCHANT_REPOSITORY) private readonly merchantRepo?: MerchantRepository,
    @Inject(CHECKOUT_EXPERIENCE_CONFIG) private readonly experienceConfig: CheckoutExperienceConfig = { platformFeeBrl: DEFAULT_PLATFORM_FEE_BRL },
    @Optional() @Inject(NORMAL_CHECKOUT_CROSS_SELL) private readonly normal?: Pick<NormalCheckoutCrossSellPort, "applyOffer">
  ) {}

  async execute(value: ApplyOfferRequest): Promise<ApplyOfferResponse> {
    const input: ApplyOfferRequest = { merchant_id: value.merchant_id, session_id: value.session_id, offer_id: value.offer_id };
    const storedSession = await this.sessions.getSession(input.merchant_id, input.session_id);
    if (!storedSession) throw new NotFoundException("checkout_session_not_found");
    if (storedSession.cart.items.some(item => item.crossSellIntent !== undefined)) {
      if (!this.normal) throw new Error("CHECKOUT_NORMAL_OFFER_PERSISTENCE_UNAVAILABLE");
      const committed = await this.normal.applyOffer({ merchantId: input.merchant_id, sessionId: input.session_id },
        normalCheckoutOfferCommandSchema.parse({ offerId: input.offer_id, expectedVersion: storedSession.persistenceVersion }));
      // Writer errors remain outside the projection catch. Nothing below can
      // apply an offer again or claim that its committed grant rolled back.
      try {
        if(committed.session.merchantId!==input.merchant_id||committed.session.sessionId!==input.session_id
          ||committed.session.globalUserId!==storedSession.globalUserId
          ||committed.session.persistenceVersion!==(storedSession.persistenceVersion??-1)+1
          ||committed.offer.id!==input.offer_id)throw new Error("normal_offer_projection_scope_invalid");
        const merchant=await this.merchantRepo?.getProfile(input.merchant_id);
        const rules=await this.merchantRepo?.getExistingRules?.(input.merchant_id);
        const experience=buildExperienceFromSession(committed.session,{merchantName:merchant?.name,theme:merchant?.theme,
          couponBoxEnabled:rules?.couponBoxEnabled,serviceFee:this.experienceConfig.platformFeeBrl});
        return {success:true,new_total:experience.totals.total,expires_at:committed.offer.expiresAt,experience,
          ...(committed.session.cart.commercialNotices?{commercialNotices:committed.session.cart.commercialNotices}:{})};
      }catch{
        throw new ConflictException({code:"checkout_review_required",message:"A oferta foi aplicada. Atualize o pedido antes de pagar."});
      }
    }
    await this.sessions.assertCouponBindingCommandAllowed?.(input.merchant_id, input.session_id);
    const session = structuredClone(storedSession);
    const storedOffer = await this.offers.getOffer(input.merchant_id, input.offer_id);
    if (!storedOffer || !storedOffer.approved) return { success: false, reason: "offer_not_found_or_not_approved" };
    const offer = structuredClone(storedOffer);
    // Tenant boundary guard: reject cross-merchant offer reuse.
    // This enforces the invariant that offers are scoped to (merchantId, sessionId) tuples.
    if (!TenantBoundaryGuard.matches(offer.merchantId, input.merchant_id)) {
      return { success: false, reason: "offer_not_found_or_not_approved" };
    }
    // Invariant: an offer is scoped to the session it was authorized for.
    // Reject cross-session reuse even within the same merchant.
    if (offer.sessionId !== input.session_id) return { success: false, reason: "offer_not_found_or_not_approved" };
    if (Date.parse(offer.expiresAt) <= Date.now()) return { success: false, reason: "offer_expired" };

    let authorizedRules: MerchantRules | undefined;
    let notices: CommercialNotice[] | undefined;
    if (session.cart.discountBudget !== undefined) {
      const refused = (reason: string, code: CommercialNotice["code"] = "benefit_conditions_not_met"): ApplyOfferResponse => ({
        success: false, reason, commercialNotices: [commercialNotice(code)],
      });
      if (!Number.isFinite(Date.parse(offer.expiresAt))) return refused("offer_expired");
      try {
        if (!this.merchantRepo) return refused("discount_policy_unavailable");
        const raw = await readExistingMerchantRules(this.merchantRepo, input.merchant_id);
        if (!raw) return refused("discount_policy_unavailable");
        const parsed = contextualPolicy.safeParse(raw);
        if (!parsed.success || (parsed.data.merchantId !== undefined && parsed.data.merchantId !== input.merchant_id)) {
          return refused("discount_policy_unavailable");
        }
        authorizedRules = structuredClone(raw);
      } catch {
        return refused("discount_policy_unavailable");
      }
      const previous = moneyCents(session.cart.currentDiscount ?? 0);
      if (previous === null) return refused("discount_review_required");
      let requested: number | null;
      if (offer.type === "discount_fixed") requested = moneyCents(offer.value);
      else if (offer.type === "discount_percent") {
        if (!Number.isFinite(offer.value) || offer.value < 0 || offer.value > 100) return refused("offer_amount_invalid");
        requested = moneyCents(roundMoney(session.cart.total * offer.value / 100));
      } else if (offer.type === "shipping_free" || offer.type === "shipping_discount_fixed") {
        // This validates existing merchandise state, not shipping authorization.
        // Shipping keeps the previously authorized quote/subsidy policy.
        requested = previous;
      } else return refused("offer_amount_invalid");
      if (requested === null) return refused("offer_amount_invalid");
      const target = Math.max(previous, requested);
      const decision = evaluateCombinedDiscount(session.cart, authorizedRules, target);
      if (decision.kind === "requires_review") return refused("discount_review_required");
      if (decision.kind !== "authorized") return refused(decision.reason,
        decision.reason === "discount_disabled_by_merchant" ? "discount_unavailable" : "benefit_conditions_not_met");
      if (decision.cartDiscountCents !== target) return decision.limitReached
        ? refused("discount_limit_reached", "discount_limit_reached") : refused("discount_requires_requote");
      if (decision.totalDiscountCents > 0 && decision.remainingDiscountCents === 0) notices = [commercialNotice("discount_limit_reached")];
    }

    const applied = await this.commerce.apply(offer);
    if (!applied.success) {
      return {
        ...applied,
        expires_at: offer.expiresAt
      };
    }

    await this.acceptCheckoutOffer.execute(input);

    const updatedSession = applyOfferToSession(session, offer);
    if (session.cart.discountBudget !== undefined) {
      delete updatedSession.cart.commercialNotices;
      if (notices) updatedSession.cart.commercialNotices = notices;
    }
    await this.sessions.saveSession(updatedSession);

    const followUp = buildAgentFollowUp(offer);
    const sessionWithTurn = await this.sessions.appendChatTurn(input.merchant_id, input.session_id, followUp);

    const merchant = await this.merchantRepo?.getProfile(input.merchant_id);
    const merchantRules = authorizedRules ?? await this.merchantRepo?.getRules(input.merchant_id);
    const experience = buildExperienceFromSession(sessionWithTurn, {
      merchantName: merchant?.name,
      theme: merchant?.theme,
      couponBoxEnabled: merchantRules?.couponBoxEnabled,
      serviceFee: this.experienceConfig.platformFeeBrl
    });

    // new_total is the full computed total (subtotal + shipping - discount), not
    // subtotal minus discount — that would omit shipping.
    return {
      ...applied,
      new_total: experience.totals.total,
      expires_at: offer.expiresAt,
      ...(notices ? { commercialNotices: notices } : {}),
      experience,
      agent_turn: followUp
    };
  }
}

function applyOfferToSession(session: CheckoutSession, offer: AuthorizedOffer): CheckoutSession {
  const cart = { ...session.cart };
  const shipping = session.shipping ? { ...session.shipping } : undefined;
  let commercialNudge: import("@zyon/shared-types").CheckoutCommercialNudge | undefined;
  if (offer.type === "discount_percent") {
    const previous = cart.currentDiscount ?? 0;
    const newDiscount = roundMoney(cart.total * (offer.value / 100));
    cart.currentDiscount = Math.max(previous, newDiscount);
    commercialNudge = {
      kind: "advanced_rule",
      title: "Oferta aplicada",
      message: `${offer.value}% de desconto foi aplicado ao seu carrinho.`,
      badge: `-${offer.value}%`,
      ruleId: offer.id,
      discountPercent: offer.value,
    };
  } else if (offer.type === "shipping_free" && shipping) {
    shipping.customerPrice = 0;
    commercialNudge = {
      kind: "advanced_rule",
      title: "Frete grátis aplicado",
      message: "A regra comercial liberou frete grátis para este pedido.",
      badge: "Frete grátis",
      ruleId: offer.id,
    };
  } else if (offer.type === "shipping_discount_fixed" && shipping) {
    shipping.customerPrice = Math.max(0, roundMoney((shipping.customerPrice ?? 0) - offer.value));
    commercialNudge = {
      kind: "advanced_rule",
      title: "Oferta de frete aplicada",
      message: `A regra comercial reduziu o frete em R$ ${offer.value.toFixed(2)}.`,
      badge: "Frete especial",
      ruleId: offer.id,
    };
  } else if (offer.type === "discount_fixed") {
    const previous = cart.currentDiscount ?? 0;
    cart.currentDiscount = Math.max(previous, roundMoney(offer.value));
    commercialNudge = {
      kind: "advanced_rule",
      title: "Oferta aplicada",
      message: `R$ ${offer.value.toFixed(2)} de desconto foi aplicado ao seu carrinho.`,
      badge: "Oferta aprovada",
      ruleId: offer.id,
    };
  }
  if (commercialNudge) cart.commercialNudge = commercialNudge;
  return {
    ...session,
    cart,
    shipping,
    updatedAt: new Date().toISOString()
  };
}

function buildAgentFollowUp(offer: AuthorizedOffer): ChatTurn {
  const label =
    offer.type === "discount_percent"
      ? `${offer.value}% de desconto`
      : offer.type === "discount_fixed"
        ? `R$${offer.value.toFixed(2)} de desconto`
        : offer.type === "shipping_free"
          ? "frete grátis"
          : `R$${offer.value.toFixed(2)} de redução no frete`;
  return {
    role: "agent",
    text: `Pronto! Apliquei ${label}. Vamos para o pagamento — prefere PIX ou cartão de crédito?`,
    occurredAt: new Date().toISOString(),
    authorizedOfferId: offer.id
  };
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { evaluateDiscountOffer } from "@zyon/rules-engine";
import { evaluateShippingOffer } from "@zyon/shipping-engine";
import type { ChatStage, CheckoutSession, MerchantRules } from "@zyon/shared-types";
import { CHECKOUT_REPOSITORY, type CheckoutRepository } from "../../domain/ports/checkout-repository.port.js";
import { createAuthorizedOffer } from "../use-cases/offer-factory.js";
import { SafeAuthorizedOffer } from "../../domain/types/safe-authorized-offer.js";
import { EvaluateNegotiationUseCase } from "../../../negotiation/application/evaluate-negotiation.use-case.js";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { AdvancedRuleEvaluator } from "../../domain/services/advanced-rule-evaluator.service.js";
import {
  IntentModulatedCapService,
  type IntentSnapshot
} from "../../../intent-memory/application/services/intent-modulated-cap.service.js";

interface NegotiationPolicyRange {
  minOfferDiscountPercent?: number;
  maxDiscountPercent?: number;
}

function clipToNegotiationPolicy(
  percent: number,
  range: NegotiationPolicyRange | null | undefined
): { effective: number; clipped: boolean; direction: "min" | "max" | "none" } {
  if (!range) return { effective: percent, clipped: false, direction: "none" };
  const min = typeof range.minOfferDiscountPercent === "number" ? range.minOfferDiscountPercent : null;
  const max = typeof range.maxDiscountPercent === "number" ? range.maxDiscountPercent : null;
  let effective = percent;
  let direction: "min" | "max" | "none" = "none";
  if (min !== null && effective < min) {
    effective = min;
    direction = "min";
  }
  if (max !== null && effective > max) {
    effective = max;
    direction = direction === "min" ? "min" : "max";
  }
  return { effective, clipped: effective !== percent, direction };
}

@Injectable()
export class CheckoutOfferService {
  private readonly logger = new Logger(CheckoutOfferService.name);
  private readonly advancedRuleEvaluator = new AdvancedRuleEvaluator();

  constructor(
    @Inject(CHECKOUT_REPOSITORY) private readonly repository: CheckoutRepository,
    @Optional() private readonly evaluateNegotiation?: EvaluateNegotiationUseCase,
    @Optional() @Inject(PRISMA_CLIENT) private readonly prisma?: any,
    @Optional() private readonly intentModulatedCap?: IntentModulatedCapService
  ) { }

  /**
   * Normalize a loosely-typed buyer intent (from BuyerContextService, attached
   * to the session) into an IntentSnapshot. Returns undefined when no usable
   * intent is present so the caller falls back to the standard cap (ADI-F1-06).
   */
  private resolveIntentSnapshot(sessionObj: CheckoutSession): IntentSnapshot | undefined {
    const raw = (sessionObj as any).buyerIntent;
    if (!raw || typeof raw.primary_intent !== "string" || raw.primary_intent.length === 0) {
      return undefined;
    }
    return {
      primary_intent: raw.primary_intent,
      urgency: raw.urgency ?? "medium",
      budget_tier: raw.budget_tier ?? "mid",
      pain_points: Array.isArray(raw.pain_points) ? raw.pain_points : []
    };
  }

  /**
   * Authorize an offer using ONLY the rules-engine or shipping-engine.
   * Returns SafeAuthorizedOffer — a type-system barrier that guarantees
   * this offer was authorized by a deterministic engine, NEVER by the LLM.
   *
   * INVARIANT: LLM never authorizes offers. Conversation port writes copy only.
   */
  async authorizeOffer(
    userMessage: string,
    sessionObj: CheckoutSession,
    rules: MerchantRules,
    stage: ChatStage,
    _missingFields: string[]
  ): Promise<SafeAuthorizedOffer> {
    const isDataCollection = stage === "data_collection";
    const isIncompleteShipping = stage === "shipping";

    // MARKETPLACE GUARD: cross-store items NEVER receive discounts, free shipping, or coupons.
    // Host merchant cannot subsidize another seller's product margin.
    const hasCrossStoreItems = Boolean((sessionObj as any).crossStoreItems?.length > 0);
    const hasOnlyCrossStoreItems = hasCrossStoreItems && (!sessionObj.cart.items || sessionObj.cart.items.length === 0);
    if (hasOnlyCrossStoreItems) {
      this.logger.log("offer.marketplace_guard: cart has only cross-store items, no discounts allowed", {
        merchantId: sessionObj.merchantId,
        sessionId: sessionObj.sessionId,
      });
      const saved = await this.repository.saveOffer(
        createAuthorizedOffer({
          merchantId: sessionObj.merchantId,
          sessionId: sessionObj.sessionId,
          rules,
          evaluation: {
            approved: false,
            type: "none",
            value: 0,
            reason: "marketplace_items_no_discount",
            marginAfterOffer: 0
          }
        })
      );
      return SafeAuthorizedOffer.fromRulesEngine(saved);
    }

    if (isDataCollection || isIncompleteShipping) {
      const saved = await this.repository.saveOffer(
        createAuthorizedOffer({
          merchantId: sessionObj.merchantId,
          sessionId: sessionObj.sessionId,
          rules,
          evaluation: {
            approved: false,
            type: "none",
            value: 0,
            reason: "complete_customer_before_offers",
            marginAfterOffer: 0
          }
        })
      );
      return SafeAuthorizedOffer.fromRulesEngine(saved);
    }

    // INVARIANT: discount cap comes from `rules.maxDiscountPercent` only.
    // The rules-engine is the sole authority for approving discounts.
    // Conversation-derived signals (objection count, chat history) MUST NOT
    // shape the cap — that would let LLM-influenced state leak into offer math.
    // Objection handling belongs to `conversation-engine` (copy only).
    //
    // F1-T03: Intent-modulated cap (ADI-F1-05, F1-06, INV-07).
    // ONLY for cohort=="treatment" AND when a buyer intent snapshot is available.
    // Holdout / no-intent / service-not-wired → current behavior (maxDiscountPercent).
    // The modulated value is still a *cap*: the rules-engine remains the sole
    // authority — this never raises the cap above rules.maxDiscountPercent.
    const cohort = (sessionObj as any).cohort;
    const buyerIntent = this.resolveIntentSnapshot(sessionObj);
    let discountCapPercent = rules.maxDiscountPercent;
    if (this.intentModulatedCap && cohort === "treatment" && buyerIntent) {
      const modulated = this.intentModulatedCap.resolveDiscountCap(buyerIntent, rules, 0);
      if (modulated !== discountCapPercent) {
        this.logger.log("offer.intent_modulated_cap", {
          merchantId: sessionObj.merchantId,
          sessionId: sessionObj.sessionId,
          primaryIntent: buyerIntent.primary_intent,
          maxDiscountPercent: rules.maxDiscountPercent,
          modulatedCap: modulated
        });
      }
      discountCapPercent = modulated;
    }

    // Load negotiation policy (if any) to clip discount to merchant min/max bounds.
    let negotiationRange: NegotiationPolicyRange | null = null;
    if (this.prisma?.merchantNegotiationPolicy) {
      try {
        const np = await this.prisma.merchantNegotiationPolicy.findUnique({
          where: { merchantId: sessionObj.merchantId }
        });
        const raw = (np?.policy ?? np) as { global?: NegotiationPolicyRange } | NegotiationPolicyRange | null;
        negotiationRange = (raw && "global" in (raw as object)
          ? (raw as { global?: NegotiationPolicyRange }).global
          : (raw as NegotiationPolicyRange)) ?? null;
      } catch (err) {
        this.logger.warn("negotiation.policy.load.failed", { error: err instanceof Error ? err.message : String(err) });
      }
    }

    // Deal Engine: at payment stage, attempt negotiation if merchant has policy
    if (stage === "payment" && this.evaluateNegotiation && this.prisma) {
      try {
        const negotiationPolicy = await this.prisma.merchantNegotiationPolicy?.findUnique?.({
          where: { merchantId: sessionObj.merchantId }
        });
        if (negotiationPolicy?.enabled) {
          const result = this.evaluateNegotiation.execute({
            merchantId: sessionObj.merchantId,
            globalUserId: sessionObj.globalUserId,
            cart: {
              total: sessionObj.cart.total ?? sessionObj.cart.items.reduce((s, i) => s + i.price * i.quantity, 0),
              items: sessionObj.cart.items.map(i => ({ sku: i.sku, price: i.price, quantity: i.quantity }))
            },
            merchantPolicy: {
              enabled: negotiationPolicy.enabled,
              global: negotiationPolicy.global ?? { minOfferDiscountPercent: 3, maxDiscountPercent: discountCapPercent },
              categories: negotiationPolicy.categories ?? [],
              items: negotiationPolicy.items ?? [],
              maxRounds: negotiationPolicy.maxRounds ?? 3,
              maxAiCostCents: negotiationPolicy.maxAiCostCents,
              estimatedCostPerAiCallCents: negotiationPolicy.estimatedCostPerAiCallCents ?? 2
            },
            buyerPreferences: {
              enabled: true,
              targetDiscountPercent: discountCapPercent,
              minimumAcceptableDiscountPercent: 1,
              maxRounds: 3,
              autoAccept: true
            }
          });
          if (result.agreement) {
            const clip = clipToNegotiationPolicy(result.selectedDiscountPercent, negotiationRange);
            if (clip.clipped) {
              this.logger.log("negotiation.discount.clipped", {
                merchantId: sessionObj.merchantId,
                sessionId: sessionObj.sessionId,
                raw: result.selectedDiscountPercent,
                effective: clip.effective,
                direction: clip.direction
              });
            }
            const offer = createAuthorizedOffer({
              merchantId: sessionObj.merchantId,
              sessionId: sessionObj.sessionId,
              rules,
              evaluation: {
                approved: true,
                type: "discount_percent",
                value: clip.effective,
                reason: clip.clipped
                  ? `negotiation_agreement_${result.selectedScope}_clipped_${clip.direction}`
                  : `negotiation_agreement_${result.selectedScope}`,
                marginAfterOffer: 0
              }
            });
            const saved = await this.repository.saveOffer(offer);
            return SafeAuthorizedOffer.fromRulesEngine(saved);
          }
          // No agreement — fall through to standard progressive discount
        }
      } catch (err) {
        this.logger.warn("negotiation.evaluate.failed", { error: err instanceof Error ? err.message : String(err) });
        // Non-critical — fall through to standard offer logic
      }
    }

    const wantsShipping = /(frete|envio|shipping)/.test(userMessage.toLowerCase());

    // ANTI-STACKING GUARD: If coupon already applied, do NOT stack progressive discount.
    // Coupon OR progressive — never both. Merchant margin protected.
    const hasCouponApplied = Boolean(
      (sessionObj as any).couponCode || (sessionObj.cart.currentDiscount && sessionObj.cart.currentDiscount > 0)
    );
    if (hasCouponApplied && !wantsShipping) {
      this.logger.log("offer.anti_stacking: coupon already applied, skipping progressive discount", {
        merchantId: sessionObj.merchantId,
        sessionId: sessionObj.sessionId,
        currentDiscount: sessionObj.cart.currentDiscount,
      });
      const saved = await this.repository.saveOffer(
        createAuthorizedOffer({
          merchantId: sessionObj.merchantId,
          sessionId: sessionObj.sessionId,
          rules,
          evaluation: {
            approved: false,
            type: "none",
            value: 0,
            reason: "coupon_already_applied_no_stacking",
            marginAfterOffer: 0
          }
        })
      );
      return SafeAuthorizedOffer.fromRulesEngine(saved);
    }

    // F0-T06: Advanced rule evaluation (deterministic, rules-engine authority)
    // Check for matching advanced rules before standard progressive discount.
    // If rule matches with value action (offer_discount, offer_free_shipping, offer_coupon),
    // route through rules-engine/shipping-engine directly.
    const advancedRules = (rules as any).advancedRules ?? [];
    if (advancedRules.length > 0 && !wantsShipping) {
      const ruleContext = {
        cartTotal: sessionObj.cart.total ?? 0,
        shippingCost: sessionObj.shipping?.customerPrice ?? 0,
        cartItemCount: sessionObj.cart.items.length,
        skusInCart: sessionObj.cart.items.map(i => i.sku),
        categoriesInCart: sessionObj.cart.items.map(i => (i as any).category || ""),
        couponApplied: hasCouponApplied,
        buyerType: (sessionObj as any).buyerType || "returning",
        paymentMethod: (sessionObj as any).paymentMethod,
        triggerFired: (sessionObj as any).triggerFired
      };

      const ruleMatch = this.advancedRuleEvaluator.evaluate(advancedRules, ruleContext);

      if (ruleMatch.matched && ruleMatch.action) {
        const actionType = ruleMatch.action.type;
        const isValueAction = ["offer_discount", "offer_free_shipping", "offer_coupon"].includes(actionType);

        if (isValueAction && actionType === "offer_discount") {
          // Route discount through rules-engine with maxDiscountReais cap
          const requestedPercent = (ruleMatch.action.params.percent as number) || discountCapPercent;
          const maxReaisCap = (ruleMatch.action.params.maxDiscountReais as number) || undefined;

          this.logger.log("offer.advanced_rule_discount_match", {
            merchantId: sessionObj.merchantId,
            sessionId: sessionObj.sessionId,
            ruleId: ruleMatch.rule?.id,
            requestedPercent,
            maxReaisCap
          });

          const evaluation = evaluateDiscountOffer(
            sessionObj.cart,
            rules,
            requestedPercent,
            maxReaisCap
          );

          // Clip to negotiation policy if applicable
          let effectiveEvaluation = evaluation;
          if (effectiveEvaluation.approved && effectiveEvaluation.type === "discount_percent") {
            const clip = clipToNegotiationPolicy(effectiveEvaluation.value, negotiationRange);
            if (clip.clipped) {
              this.logger.log("discount.clipped.to.negotiation.policy", {
                merchantId: sessionObj.merchantId,
                sessionId: sessionObj.sessionId,
                raw: effectiveEvaluation.value,
                effective: clip.effective,
                direction: clip.direction
              });
              effectiveEvaluation = {
                ...effectiveEvaluation,
                value: clip.effective,
                reason: `${effectiveEvaluation.reason}_clipped_${clip.direction}`
              };
            }
          }

          const offer = createAuthorizedOffer({
            merchantId: sessionObj.merchantId,
            sessionId: sessionObj.sessionId,
            rules,
            evaluation: effectiveEvaluation
          });
          const saved = await this.repository.saveOffer(offer);
          return SafeAuthorizedOffer.fromRulesEngine(saved);
        } else if (isValueAction && actionType === "offer_free_shipping") {
          // Route free shipping through shipping-engine
          const evaluation = evaluateShippingOffer({
            cart: sessionObj.cart,
            shipping: sessionObj.shipping,
            rules,
            abandonmentScore: Math.max(sessionObj.abandonmentScore, 0.7)
          });

          this.logger.log("offer.advanced_rule_shipping_match", {
            merchantId: sessionObj.merchantId,
            sessionId: sessionObj.sessionId,
            ruleId: ruleMatch.rule?.id,
            approved: evaluation.approved
          });

          const offer = createAuthorizedOffer({
            merchantId: sessionObj.merchantId,
            sessionId: sessionObj.sessionId,
            rules,
            evaluation
          });
          const saved = await this.repository.saveOffer(offer);
          return SafeAuthorizedOffer.fromShippingEngine(saved);
        }
        // For offer_coupon or other value-actions, fall through to standard flow
        // (coupon logic handled elsewhere)
      }
    }

    const evaluation = wantsShipping
      ? evaluateShippingOffer({
        cart: sessionObj.cart,
        shipping: sessionObj.shipping,
        rules,
        abandonmentScore: Math.max(sessionObj.abandonmentScore, 0.7)
      })
      : evaluateDiscountOffer(sessionObj.cart, rules, discountCapPercent);

    // Clip evaluated discount to merchant negotiation policy min/max bounds.
    let effectiveEvaluation = evaluation;
    if (!wantsShipping && effectiveEvaluation.approved && effectiveEvaluation.type === "discount_percent") {
      const clip = clipToNegotiationPolicy(effectiveEvaluation.value, negotiationRange);
      if (clip.clipped) {
        this.logger.log("discount.clipped.to.negotiation.policy", {
          merchantId: sessionObj.merchantId,
          sessionId: sessionObj.sessionId,
          raw: effectiveEvaluation.value,
          effective: clip.effective,
          direction: clip.direction
        });
        effectiveEvaluation = {
          ...effectiveEvaluation,
          value: clip.effective,
          reason: `${effectiveEvaluation.reason}_clipped_${clip.direction}`
        };
      }
    }

    const offer = createAuthorizedOffer({
      merchantId: sessionObj.merchantId,
      sessionId: sessionObj.sessionId,
      rules,
      evaluation: effectiveEvaluation
    });
    const saved = await this.repository.saveOffer(offer);
    // Type-system barrier: wrap in SafeAuthorizedOffer to enforce that only engines authorize.
    return wantsShipping
      ? SafeAuthorizedOffer.fromShippingEngine(saved)
      : SafeAuthorizedOffer.fromRulesEngine(saved);
  }
}

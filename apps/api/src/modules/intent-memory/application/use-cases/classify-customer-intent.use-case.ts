import { Inject, Injectable, Logger } from "@nestjs/common";
import type { CustomerIntentRecord, CheckoutSession } from "@zyon/shared-types";
import { INTENT_MEMORY_REPOSITORY, type IntentMemoryRepositoryPort } from "../../domain/ports/intent-memory-repository.port.js";
import { BUYER_INTENT_CONSENT_REPOSITORY, type BuyerIntentConsentRepositoryPort } from "../../domain/ports/intent-memory-repository.port.js";
import { BuyerIntentMemoryConsentEntity } from "../../domain/entities/buyer-intent-memory-consent.entity.js";

/**
 * Classifies buyer intent from session events + conversation.
 * Pure rule-based classification — no LLM needed (deterministic).
 */
@Injectable()
export class ClassifyCustomerIntentUseCase {
  private readonly logger = new Logger(ClassifyCustomerIntentUseCase.name);

  constructor(
    @Inject(INTENT_MEMORY_REPOSITORY) private readonly repository: IntentMemoryRepositoryPort,
  ) {}

  async execute(input: {
    merchantId: string;
    globalUserId: string;
    sessionEvents: string[];
    cart: { total: number; items: Array<{ name: string; sku: string; price: number }> };
  }): Promise<CustomerIntentRecord> {
    const { merchantId, globalUserId, sessionEvents, cart } = input;

    const primaryIntent = this.classifyPrimaryIntent(sessionEvents, cart.total);
    const urgency = this.classifyUrgency(sessionEvents);
    const budgetTier = this.classifyBudget(cart.total);
    const painPoints = this.extractPainPoints(sessionEvents);

    const record: CustomerIntentRecord = {
      id: `int_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      merchant_id: merchantId,
      global_user_id: globalUserId,
      primary_intent: primaryIntent,
      urgency,
      budget_tier: budgetTier,
      category_focus: cart.items.map(i => i.sku).slice(0, 5),
      pain_points: painPoints,
      conversion_likelihood_percent: this.estimateConversion(sessionEvents),
      behavioral_signals: {
        session_duration_seconds: 0,
        items_viewed: sessionEvents.length,
        comparisons_made: 0,
        objections_raised: sessionEvents.filter(e => e.includes("objection")).length,
        checkout_stage_reached: sessionEvents.includes("payment_method_selected") ? 3 : 1,
      },
      generated_at: new Date().toISOString(),
    };

    await this.repository.save(record);
    this.logger.log(`intent classified`, { merchantId, globalUserId, primaryIntent, urgency });
    return record;
  }

  private classifyPrimaryIntent(events: string[], cartTotal: number): string {
    // Price signals win first: asking for a coupon or objecting to shipping cost
    // is a stronger intent signal than anything else.
    if (events.includes("coupon_field_clicked") || events.includes("shipping_objection_detected")) {
      return "price_sensitive";
    }
    // Selecting a shipping option without any price friction reads as a buyer
    // who cares about delivery over price → speed_focused.
    if (events.includes("shipping_option_selected")) {
      return "speed_focused";
    }
    if (events.includes("checkout_started") && events.includes("order_completed")) {
      return "ready_to_buy";
    }
    // NOTE: event name must match CheckoutEventName exactly ("idle_30_seconds",
    // not "idle_30s") — the old value never matched and browsing was unreachable.
    if (events.includes("exit_intent_detected") || events.includes("idle_30_seconds")) {
      return "browsing";
    }
    return "exploring";
  }

  private classifyUrgency(events: string[]): "low" | "medium" | "high" {
    if (events.includes("checkout_started") && events.includes("payment_method_selected")) {
      return "high";
    }
    if (events.includes("checkout_started")) {
      return "medium";
    }
    return "low";
  }

  private classifyBudget(cartTotal: number): "budget" | "mid" | "premium" {
    if (cartTotal >= 500) return "premium";
    if (cartTotal >= 100) return "mid";
    return "budget";
  }

  private extractPainPoints(events: string[]): string[] {
    const points: string[] = [];
    if (events.includes("shipping_objection_detected")) points.push("shipping_cost");
    if (events.includes("coupon_field_clicked")) points.push("price");
    if (events.includes("payment_failed")) points.push("payment_friction");
    if (events.includes("trust_objection_detected")) points.push("trust");
    if (events.includes("exit_intent_detected")) points.push("hesitation");
    return points;
  }

  private estimateConversion(events: string[]): number {
    let score = 30;
    if (events.includes("checkout_started")) score += 20;
    if (events.includes("payment_method_selected")) score += 25;
    if (events.includes("exit_intent_detected")) score -= 15;
    if (events.includes("payment_failed")) score -= 20;
    return Math.max(0, Math.min(100, score));
  }
}

/**
 * Records intent ONLY if buyer has active consent (LGPD compliance).
 */
@Injectable()
export class RecordIntentIfConsentedUseCase {
  private readonly logger = new Logger(RecordIntentIfConsentedUseCase.name);

  constructor(
    @Inject(BUYER_INTENT_CONSENT_REPOSITORY) private readonly consentRepo: BuyerIntentConsentRepositoryPort,
    private readonly classifyIntent: ClassifyCustomerIntentUseCase,
  ) {}

  async execute(input: {
    merchantId: string;
    globalUserId: string;
    sessionEvents: string[];
    cart: { total: number; items: Array<{ name: string; sku: string; price: number }> };
  }): Promise<{ recorded: boolean }> {
    // Check consent
    const consent = await this.consentRepo.getConsent(input.merchantId, input.globalUserId);
    if (!consent) {
      return { recorded: false };
    }

    const entity = BuyerIntentMemoryConsentEntity.rehydrate(consent);
    if (!entity.isActive()) {
      return { recorded: false };
    }

    // Classify and save (async-safe — errors don't break caller)
    await this.classifyIntent.execute(input);
    return { recorded: true };
  }
}

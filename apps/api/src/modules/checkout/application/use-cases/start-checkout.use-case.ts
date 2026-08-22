import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import type {
  CheckoutSession,
  StartCheckoutRequest,
  StartCheckoutResponse,
  SuggestedProduct
} from "@zyon/shared-types";
import { MERCHANT_REPOSITORY, type MerchantRepository } from "../../../merchant/domain/ports/merchant-repository.port.js";
import { CheckoutSessionEntity } from "../../domain/entities/checkout-session.entity.js";
import { createCheckoutEventEnvelope } from "../../domain/events/checkout-domain-event.js";
import { AGENT_CONTEXT_PORT, type AgentContextPort } from "../../domain/ports/agent-context.port.js";
import { CHECKOUT_SESSION_REPOSITORY, type CheckoutSessionRepository } from "../../domain/ports/checkout-session.repository.port.js";
import { BUYER_IDENTITY_REPOSITORY, type BuyerIdentityRepository } from "../../../buyer-purchase-history/domain/ports/buyer-identity.repository.port.js";
import { OUTBOX_REPOSITORY, type OutboxRepository } from "../../../../shared/messaging/ports/outbox.repository.port.js";
import { CHECKOUT_SETTINGS_PORT, type CheckoutSettingsPort } from "../../domain/ports/checkout-settings.port.js";
import { buildExperienceFromSession } from "../services/checkout-experience.service.js";
import { CHECKOUT_EXPERIENCE_CONFIG, type CheckoutExperienceConfig } from "../../domain/checkout-experience.config.js";
import { MetricsService } from "../../../../shared/observability/metrics.service.js";
import { CheckoutCustomerService } from "../services/checkout-customer.service.js";
import {
  CHECKOUT_CROSS_SELL_RECOMMENDER,
  type CheckoutCrossSellRecommenderPort
} from "../../domain/ports/cross-sell-recommender.port.js";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import {
  INTENT_MEMORY_REPOSITORY,
  BUYER_INTENT_CONSENT_REPOSITORY,
  type IntentMemoryRepositoryPort,
  type BuyerIntentConsentRepositoryPort
} from "../../../intent-memory/domain/ports/intent-memory-repository.port.js";
import { BuyerIntentMemoryConsentEntity } from "../../../intent-memory/domain/entities/buyer-intent-memory-consent.entity.js";
import { HoldoutGroupService } from "../../../revenue-lift/domain/services/holdout-group.service.js";

@Injectable()
export class StartCheckoutUseCase {
  private readonly logger = new Logger(StartCheckoutUseCase.name);

  constructor(
    @Inject(CHECKOUT_SESSION_REPOSITORY) private readonly sessions: CheckoutSessionRepository,
    @Inject(BUYER_IDENTITY_REPOSITORY) private readonly identity: BuyerIdentityRepository,
    @Inject(OUTBOX_REPOSITORY) private readonly outbox: OutboxRepository,
    @Optional() @Inject(CHECKOUT_SETTINGS_PORT) private readonly checkoutSettings?: CheckoutSettingsPort,
    @Optional() @Inject(MERCHANT_REPOSITORY) private readonly merchantRepository?: MerchantRepository,
    @Optional() @Inject(AGENT_CONTEXT_PORT) private readonly agentContext?: AgentContextPort,
    @Optional() private readonly metrics?: MetricsService,
    @Optional() private readonly customerService?: CheckoutCustomerService,
    @Inject(CHECKOUT_EXPERIENCE_CONFIG) private readonly experienceConfig: CheckoutExperienceConfig = { platformFeeBrl: 1.99 },
    @Optional() @Inject(CHECKOUT_CROSS_SELL_RECOMMENDER) private readonly crossSell?: CheckoutCrossSellRecommenderPort,
    @Optional() @Inject(PRISMA_CLIENT) private readonly prisma?: any,
    @Optional() private readonly holdoutGroupService?: HoldoutGroupService,
    @Optional() @Inject(INTENT_MEMORY_REPOSITORY) private readonly intentMemory?: IntentMemoryRepositoryPort,
    @Optional() @Inject(BUYER_INTENT_CONSENT_REPOSITORY) private readonly intentConsent?: BuyerIntentConsentRepositoryPort
  ) { }

  async execute(input: StartCheckoutRequest): Promise<StartCheckoutResponse> {
    const settings = await this.checkoutSettings?.getContext(input.merchant_id);
    const merchant = await this.merchantRepository?.getProfile(input.merchant_id);
    const merchantRules = await this.merchantRepository?.getRules(input.merchant_id);
    const sessionId = input.session_id ?? `chk_${crypto.randomUUID()}`;
    const globalUserId = await this.identity.resolveGlobalUserId(input.merchant_id, input.customer);
    const agent = await this.agentContext?.get({
      merchantId: input.merchant_id,
      globalUserId
    });

    // Load intent memory if buyer has active consent (LGPD compliance)
    let buyerIntent = undefined;
    if (this.intentConsent && this.intentMemory && globalUserId) {
      try {
        const consent = await this.intentConsent.getConsent(input.merchant_id, globalUserId);
        if (consent) {
          const entity = BuyerIntentMemoryConsentEntity.rehydrate(consent);
          if (entity.isActive()) {
            const record = await this.intentMemory.getLatest(input.merchant_id, globalUserId);
            if (record) {
              buyerIntent = {
                primary_intent: record.primary_intent,
                urgency: record.urgency,
                budget_tier: record.budget_tier,
                pain_points: record.pain_points
              };
            }
          }
        }
      } catch (err) {
        this.logger.warn(`intent-memory load failed (non-blocking)`, {
          merchantId: input.merchant_id,
          error: err instanceof Error ? err.message : String(err)
        });
      }
    }

    this.metrics?.checkoutStarted.inc({ merchant_id: input.merchant_id });
    const existingSession = await this.sessions.getSession(input.merchant_id, sessionId);

    let session: CheckoutSession;
    if (existingSession) {
      session = CheckoutSessionEntity.rehydrate(existingSession).snapshot();
    } else {
      session = CheckoutSessionEntity.create({
        merchantId: input.merchant_id,
        sessionId,
        globalUserId,
        conversationId: `conv_${crypto.randomUUID()}`,
        cart: input.cart,
        customer: input.customer,
        shipping: input.shipping
      }).snapshot();
      await this.sessions.saveSession(session);
      await this.sessions.recordEvent(input.merchant_id, sessionId, "checkout_started");
    }

    if (this.customerService && session.customer?.email?.trim()) {
      session = await this.customerService.hydrateReturningBuyerFromEmailHint(session);
    }

    // Revenue Lift: assign holdout cohort deterministically.
    // Default to "treatment" if HoldoutGroupService is not available (graceful degradation).
    const cohort = this.holdoutGroupService
      ? this.holdoutGroupService.assignCohort(session.globalUserId, session.merchantId)
      : "treatment" as const;
    (session as any).cohort = cohort;

    // Persist cohort assignment for new sessions
    if (!existingSession) {
      await this.sessions.saveSession(session);
    } else {
      // For existing sessions, also re-save to ensure cohort is persisted
      await this.sessions.saveSession(session);
    }

    await this.outbox.appendOutbox(
      createCheckoutEventEnvelope({
        eventType: "checkout.session.started",
        merchantId: input.merchant_id,
        payload: {
          session_id: session.sessionId,
          conversation_id: session.conversationId,
          global_user_id: session.globalUserId,
          cart_total: session.cart.total,
          currency: session.cart.currency,
          has_customer_hint: Boolean(input.customer),
          has_shipping_quote: Boolean(input.shipping)
        },
        causationId: session.sessionId
      })
    );

    const suggestedProducts = await this.resolveSuggestedProducts(input.merchant_id, session);

    // Load advanced rules from checkout settings (mirrors send-chat-message logic)
    let advancedRules: string[] | undefined;
    try {
      if (this.prisma) {
        const setting = await this.prisma.checkoutSetting.findUnique({
          where: { merchantId: input.merchant_id },
          select: { advancedRules: true, interventionPolicy: true },
        });

        const rules: string[] = [];

        // Advanced rules → natural language (built first so we can derive their triggers).
        // Priority chain: advanced rules > progressive discount.
        // If an advanced rule already covers a trigger (e.g. trigger_fired=coupon_field_clicked),
        // then the corresponding progressive NL rule for that same trigger is suppressed.
        const advancedNlRules: string[] = [];
        const advancedTriggers = new Set<string>();
        if (setting?.advancedRules) {
          const rules2 = setting.advancedRules as Array<{ enabled: boolean; priority: number; conditions: Array<{ field: string; operator: string; value: string | number | boolean }>; action: { type: string; params: Record<string, string | number> } }>;
          const fieldLabels: Record<string, string> = { cart_total: "carrinho", shipping_cost: "frete", product_in_cart: "produto", category_in_cart: "categoria", coupon_applied: "cupom", buyer_type: "comprador", payment_method: "pagamento", trigger_fired: "trigger", cart_item_count: "itens" };
          const actionLabels = (a: { type: string; params: Record<string, string | number> }) => {
            const map: Record<string, string> = { offer_discount: `ofereça ${a.params.percent || "?"}% de desconto`, offer_free_shipping: "ofereça frete grátis", suggest_product: `sugira ${a.params.productName || "produto"}`, show_message: `diga: "${a.params.message || ""}"`, offer_installments: `ofereça ${a.params.maxInstallments || "?"}x`, do_nothing: "não intervenha", offer_coupon: `ofereça o cupom ${a.params.code || ""}` };
            return map[a.type] || "aja conforme melhor";
          };
          for (const r of rules2.filter(r => r.enabled).sort((a, b) => a.priority - b.priority)) {
            const conds = r.conditions.map(c => `${fieldLabels[c.field] || c.field} ${c.operator} ${c.value}`).join(" E ");
            advancedNlRules.push(`SE ${conds} ENTÃO ${actionLabels(r.action)}`);
            for (const c of r.conditions) {
              if (c.field === "trigger_fired") {
                advancedTriggers.add(String(c.value));
              }
            }
          }
        }

        // Progressive discount stages → natural language rules,
        // filtered out when an advanced rule already covers the trigger.
        const progressiveByTrigger: Record<string, string> = {
          coupon_field_clicked: "SE comprador pede cupom ENTÃO ofereça até {p}% de desconto",
          exit_intent_detected: "SE comprador ameaça sair ENTÃO ofereça até {p}% de desconto para ficar",
          idle_30_seconds: "SE comprador ameaça sair ENTÃO ofereça até {p}% de desconto para ficar",
          checkout_abandoned: "SE carrinho abandonado ENTÃO ofereça até {p}% para recuperar",
          payment_method_selected: "SE comprador hesita no pagamento ENTÃO ofereça até {p}% para fechar agora",
          payment_failed: "SE pagamento falhou ENTÃO sugira outro método de pagamento (PIX se era cartão, cartão se era PIX, ou boleto como alternativa). Ofereça até {p}% de desconto adicional se trocar para PIX. Diga algo como: 'Parece que houve um problema com esse pagamento. Que tal tentar via PIX? É instantâneo e posso te dar {p}% de desconto extra.'"
        };
        const policy = setting?.interventionPolicy as { progressiveDiscount?: { enabled: boolean; stages?: { initial_coupon?: number; exit_intent?: number; abandoned_cart?: number; payment_nudge?: number } } } | null;
        if (policy?.progressiveDiscount?.enabled && policy.progressiveDiscount.stages) {
          const s = policy.progressiveDiscount.stages;
          for (const [trigger, template] of Object.entries(progressiveByTrigger)) {
            let pct = 0;
            if (trigger === "coupon_field_clicked") pct = s.initial_coupon ?? 0;
            else if (trigger === "exit_intent_detected" || trigger === "idle_30_seconds") pct = s.exit_intent ?? 0;
            else if (trigger === "checkout_abandoned") pct = s.abandoned_cart ?? 0;
            else if (trigger === "payment_method_selected" || trigger === "payment_failed") pct = s.payment_nudge ?? 0;
            if (!pct) continue;
            if (advancedTriggers.has(trigger)) continue;
            rules.push(template.replace("{p}", String(pct)));
          }
        }

        rules.push(...advancedNlRules);

        if (rules.length > 0) advancedRules = rules;
      }
    } catch { /* non-critical */ }

    return {
      conversation_id: session.conversationId,
      session_id: session.sessionId,
      global_user_id: session.globalUserId,
      agent_enabled: settings?.checkout_settings.mode !== "manual_only",
      initial_mode: settings?.checkout_settings.mode === "proactive" ? "open" : "silent",
      tracking_token: `trk_${crypto.randomUUID()}`,
      experience: buildExperienceFromSession(session, {
        merchantName: merchant?.name,
        theme: merchant?.theme,
        agent,
        couponBoxEnabled: merchantRules?.couponBoxEnabled,
        rules: merchantRules,
        serviceFee: this.experienceConfig.platformFeeBrl,
        suggestedProducts,
        stripeConnectAccountId: merchant?.stripeConnectAccountId,
        cryptoPaymentsEnabled: !!(merchantRules as any)?.cryptoPayments?.enabled,
        cryptoPayments: (merchantRules as any)?.cryptoPayments ?? null,
        merchantRulesForWidget: merchantRules ? {
          maxDiscountPercent: merchantRules.maxDiscountPercent,
          allowFreeShipping: merchantRules.allowFreeShipping,
          allowShippingDiscount: merchantRules.allowShippingDiscount,
          freeShippingMinCartValue: merchantRules.freeShippingMinCartValue,
          maxShippingSubsidy: merchantRules.maxShippingSubsidy,
          maxPartialShippingDiscount: merchantRules.maxPartialShippingDiscount,
          offerExpirationMinutes: merchantRules.offerExpirationMinutes,
          blockedRegions: merchantRules.blockedRegions,
          brandVoice: merchantRules.brandVoice,
          originZip: merchantRules.originZip,
        } : undefined,
        advancedRules,
        visual: merchant?.theme ? {
          mode: (merchant.theme as any).mode,
          density: (merchant.theme as any).density,
          backgroundImageUrl: (merchant.theme as any).backgroundImageUrl,
          borderRadius: (merchant.theme as any).borderRadius,
          fontFamily: (merchant.theme as any).fontFamily,
          fontDisplay: (merchant.theme as any).fontDisplay,
        } : undefined,
      }),
      turns: session.chatHistory
    };
  }

  private async resolveSuggestedProducts(merchantId: string, session: CheckoutSession): Promise<SuggestedProduct[]> {
    if (!this.crossSell || session.cart.items.length === 0) return [];
    try {
      return await this.crossSell.suggest({
        merchant_id: merchantId,
        session_id: session.sessionId,
        cart: session.cart
      });
    } catch (error) {
      this.logger.warn({
        event: "checkout.cross_sell.initial_suggest_failed",
        merchantId,
        sessionId: session.sessionId,
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }
}

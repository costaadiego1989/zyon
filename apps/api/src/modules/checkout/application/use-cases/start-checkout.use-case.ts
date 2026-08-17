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
    @Optional() @Inject(PRISMA_CLIENT) private readonly prisma?: any
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

        // Progressive discount stages → natural language rules
        const policy = setting?.interventionPolicy as { progressiveDiscount?: { enabled: boolean; stages?: { initial_coupon?: number; exit_intent?: number; abandoned_cart?: number; payment_nudge?: number } } } | null;
        if (policy?.progressiveDiscount?.enabled && policy.progressiveDiscount.stages) {
          const s = policy.progressiveDiscount.stages;
          if (s.initial_coupon) rules.push(`SE comprador pede cupom ENTÃO ofereça até ${s.initial_coupon}% de desconto`);
          if (s.exit_intent) rules.push(`SE comprador ameaça sair ENTÃO ofereça até ${s.exit_intent}% de desconto para ficar`);
          if (s.abandoned_cart) rules.push(`SE carrinho abandonado ENTÃO ofereça até ${s.abandoned_cart}% para recuperar`);
          if (s.payment_nudge) rules.push(`SE comprador hesita no pagamento ENTÃO ofereça até ${s.payment_nudge}% para fechar agora`);
        }

        // Advanced rules → natural language
        if (setting?.advancedRules) {
          const rules2 = setting.advancedRules as Array<{ enabled: boolean; priority: number; conditions: Array<{ field: string; operator: string; value: string | number | boolean }>; action: { type: string; params: Record<string, string | number> } }>;
          const fieldLabels: Record<string, string> = { cart_total: "carrinho", shipping_cost: "frete", product_in_cart: "produto", category_in_cart: "categoria", coupon_applied: "cupom", buyer_type: "comprador", payment_method: "pagamento", trigger_fired: "trigger", cart_item_count: "itens" };
          const actionLabels = (a: { type: string; params: Record<string, string | number> }) => {
            const map: Record<string, string> = { offer_discount: `ofereça ${a.params.percent || "?"}% de desconto`, offer_free_shipping: "ofereça frete grátis", suggest_product: `sugira ${a.params.productName || "produto"}`, show_message: `diga: "${a.params.message || ""}"`, offer_installments: `ofereça ${a.params.maxInstallments || "?"}x`, do_nothing: "não intervenha", offer_coupon: `ofereça o cupom ${a.params.code || ""}` };
            return map[a.type] || "aja conforme melhor";
          };
          const advRules = rules2.filter(r => r.enabled).sort((a, b) => a.priority - b.priority).map(r => {
            const conds = r.conditions.map(c => `${fieldLabels[c.field] || c.field} ${c.operator} ${c.value}`).join(" E ");
            return `SE ${conds} ENTÃO ${actionLabels(r.action)}`;
          });
          rules.push(...advRules);
        }

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

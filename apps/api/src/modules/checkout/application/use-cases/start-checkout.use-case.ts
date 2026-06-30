import { Inject, Injectable, Optional } from "@nestjs/common";
import type {
  CheckoutSession,
  StartCheckoutRequest,
  StartCheckoutResponse
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
import { MetricsService } from "../../../../shared/observability/metrics.service.js";
import { CheckoutCustomerService } from "../services/checkout-customer.service.js";

@Injectable()
export class StartCheckoutUseCase {
  constructor(
    @Inject(CHECKOUT_SESSION_REPOSITORY) private readonly sessions: CheckoutSessionRepository,
    @Inject(BUYER_IDENTITY_REPOSITORY) private readonly identity: BuyerIdentityRepository,
    @Inject(OUTBOX_REPOSITORY) private readonly outbox: OutboxRepository,
    @Optional() @Inject(CHECKOUT_SETTINGS_PORT) private readonly checkoutSettings?: CheckoutSettingsPort,
    @Optional() @Inject(MERCHANT_REPOSITORY) private readonly merchantRepository?: MerchantRepository,
    @Optional() @Inject(AGENT_CONTEXT_PORT) private readonly agentContext?: AgentContextPort,
    @Optional() private readonly metrics?: MetricsService,
    @Optional() private readonly customerService?: CheckoutCustomerService
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
        rules: merchantRules
      }),
      turns: session.chatHistory
    };
  }
}

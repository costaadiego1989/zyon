import { Inject, Injectable, Optional } from "@nestjs/common";
import type {
  StartCheckoutRequest,
  StartCheckoutResponse
} from "@aacp/shared-types";
import { MERCHANT_REPOSITORY, type MerchantRepository } from "../../../merchant/domain/ports/merchant-repository.port.js";
import { CheckoutSessionEntity } from "../../domain/entities/checkout-session.entity.js";
import { createCheckoutEventEnvelope } from "../../domain/events/checkout-domain-event.js";
import { AGENT_CONTEXT_PORT, type AgentContextPort } from "../../domain/ports/agent-context.port.js";
import {
  CHECKOUT_REPOSITORY,
  type CheckoutRepository
} from "../../domain/ports/checkout-repository.port.js";
import { CHECKOUT_SETTINGS_PORT, type CheckoutSettingsPort } from "../../domain/ports/checkout-settings.port.js";
import { withCheckoutTransaction } from "./checkout-transaction.js";
import { buildExperienceFromSession } from "../services/checkout-experience.service.js";

@Injectable()
export class StartCheckoutUseCase {
  constructor(
    @Inject(CHECKOUT_REPOSITORY) private readonly repository: CheckoutRepository,
    @Optional() @Inject(CHECKOUT_SETTINGS_PORT) private readonly checkoutSettings?: CheckoutSettingsPort,
    @Optional() @Inject(MERCHANT_REPOSITORY) private readonly merchantRepository?: MerchantRepository,
    @Optional() @Inject(AGENT_CONTEXT_PORT) private readonly agentContext?: AgentContextPort
  ) {}

  async execute(input: StartCheckoutRequest): Promise<StartCheckoutResponse> {
    return withCheckoutTransaction(this.repository, async (repository) => {
      const settings = await this.checkoutSettings?.getContext(input.merchant_id);
      const merchant = await this.merchantRepository?.getProfile(input.merchant_id);
      const sessionId = input.session_id ?? `chk_${crypto.randomUUID()}`;
      const globalUserId = await repository.resolveGlobalUserId(input.merchant_id, input.customer);
      const agent = await this.agentContext?.get({
        merchantId: input.merchant_id,
        globalUserId
      });
      const session = CheckoutSessionEntity.create({
        merchantId: input.merchant_id,
        sessionId,
        globalUserId,
        conversationId: `conv_${crypto.randomUUID()}`,
        cart: input.cart,
        customer: input.customer,
        shipping: input.shipping
      }).snapshot();

      await repository.saveSession(session);
      await repository.recordEvent(input.merchant_id, sessionId, "checkout_started");
      await repository.appendOutbox(
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

      const merchantRules = await repository.getRules(input.merchant_id);

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
          couponBoxEnabled: merchantRules.couponBoxEnabled
        })
      };
    });
  }
}

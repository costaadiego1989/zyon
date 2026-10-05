import { Inject, Injectable, ServiceUnavailableException } from "@nestjs/common";
import type { CheckoutEditSection } from "@zyon/shared-types";
import { CHECKOUT_SESSION_REPOSITORY, type CheckoutSessionRepository } from "../../checkout/domain/ports/checkout-session.repository.port.js";
import { CancelCheckoutPaymentUseCase } from "../../payment/application/cancel-checkout-payment.use-case.js";
import { buildExperienceFromSession } from "../../checkout/application/services/checkout-experience.service.js";
import { CHECKOUT_EXPERIENCE_CONFIG, type CheckoutExperienceConfig } from "../../checkout/domain/checkout-experience.config.js";

@Injectable()
export class ReopenEmbedCheckoutUseCase {
  constructor(
    @Inject(CHECKOUT_SESSION_REPOSITORY) private readonly sessions: CheckoutSessionRepository,
    private readonly cancelPayment: CancelCheckoutPaymentUseCase,
    @Inject(CHECKOUT_EXPERIENCE_CONFIG) private readonly config: CheckoutExperienceConfig,
  ) {}

  async execute(merchantId: string, sessionId: string, section: CheckoutEditSection) {
    if (!this.sessions.reopenForBuyerEdit || !this.sessions.assertBuyerEditAllowed) throw new ServiceUnavailableException("checkout_edit_unavailable");
    await this.sessions.assertBuyerEditAllowed(merchantId, sessionId);
    await this.cancelPayment.execute(merchantId, sessionId);
    const session = await this.sessions.reopenForBuyerEdit(merchantId, sessionId, section);
    return { experience: buildExperienceFromSession(session, { serviceFee: this.config.platformFeeBrl }), revision: session.persistenceVersion };
  }
}

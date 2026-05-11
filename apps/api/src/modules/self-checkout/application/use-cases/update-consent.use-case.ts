import { Injectable, Inject, NotFoundException } from "@nestjs/common";
import { BUYER_USER_REPOSITORY, type BuyerUserRepository } from "../../domain/ports/buyer-user-repository.port.js";
import { OUTBOX_REPOSITORY, type OutboxRepository } from "../../../../shared/messaging/ports/outbox.repository.port.js";
import { createSelfCheckoutEventEnvelope } from "../../domain/events/self-checkout-domain-event.js";

@Injectable()
export class UpdateConsentUseCase {
  constructor(
    @Inject(BUYER_USER_REPOSITORY) private readonly users: BuyerUserRepository,
    @Inject(OUTBOX_REPOSITORY) private readonly outbox: OutboxRepository
  ) {}

  async execute(input: { buyer_user_id: string; consent_version: string; marketing_opt_in: boolean }) {
    const user = await this.users.findById(input.buyer_user_id);
    if (!user) throw new NotFoundException("BUYER_NOT_FOUND");

    const updated = user.updateConsent(input.consent_version, input.marketing_opt_in);
    await this.users.save(updated);

    await this.outbox.appendOutbox(
      createSelfCheckoutEventEnvelope({
        eventType: "buyer.consent.updated",
        merchantId: "platform",
        payload: { global_user_id: user.id, consent_version: input.consent_version, marketing_opt_in: input.marketing_opt_in },
      })
    );

    return { ok: true };
  }
}

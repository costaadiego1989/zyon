import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { CheckoutSession } from "@zyon/shared-types";
import { CHECKOUT_SESSION_REPOSITORY, type CheckoutSessionRepository } from "../../domain/ports/checkout-session.repository.port.js";

@Injectable()
export class GetCheckoutSessionUseCase {
  constructor(@Inject(CHECKOUT_SESSION_REPOSITORY) private readonly sessions: CheckoutSessionRepository) {}

  async execute(merchantId: string, sessionId: string): Promise<CheckoutSession> {
    const session = await this.sessions.getSession(merchantId, sessionId);
    if (!session) throw new NotFoundException("checkout_session_not_found");
    return session;
  }
}

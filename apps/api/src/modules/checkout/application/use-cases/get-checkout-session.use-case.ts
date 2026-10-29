import { Inject, Injectable, NotFoundException, Optional, Logger} from "@nestjs/common";
import { ServiceSlotHoldsService } from "../../../../shared/bookings/service-slot-holds.service.js";
import type { CheckoutSession } from "@zyon/shared-types";
import { CHECKOUT_SESSION_REPOSITORY, type CheckoutSessionRepository } from "../../domain/ports/checkout-session.repository.port.js";
import { CorrelationIdStorage } from "../../../../shared/logger/correlation-id.storage.js";

@Injectable()
export class GetCheckoutSessionUseCase {
  private readonly logger = new Logger(GetCheckoutSessionUseCase.name);

  constructor(@Inject(CHECKOUT_SESSION_REPOSITORY) private readonly sessions: CheckoutSessionRepository,
    @Optional() private readonly serviceSlots?: ServiceSlotHoldsService) {}

  async execute(merchantId: string, sessionId: string): Promise<CheckoutSession> {
    const session = await this.sessions.getSession(merchantId, sessionId);
    if (!session) throw new NotFoundException("checkout_session_not_found");
    return { ...session, serviceSlotHold: await this.serviceSlots?.get(session) };
  }
}

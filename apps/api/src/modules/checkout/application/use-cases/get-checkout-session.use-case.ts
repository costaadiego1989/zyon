import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { CheckoutSession } from "@aacp/shared-types";
import {
  CHECKOUT_REPOSITORY,
  type CheckoutRepository
} from "../../domain/ports/checkout-repository.port.js";

@Injectable()
export class GetCheckoutSessionUseCase {
  constructor(@Inject(CHECKOUT_REPOSITORY) private readonly repository: CheckoutRepository) {}

  async execute(merchantId: string, sessionId: string): Promise<CheckoutSession> {
    const session = await this.repository.getSession(merchantId, sessionId);
    if (!session) throw new NotFoundException("checkout_session_not_found");
    return session;
  }
}

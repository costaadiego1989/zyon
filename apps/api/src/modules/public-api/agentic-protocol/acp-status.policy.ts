import { Inject, Injectable } from "@nestjs/common";
import type { CheckoutEventName, CheckoutSession } from "@zyon/shared-types";
import {
  CHECKOUT_SESSION_REPOSITORY,
  type CheckoutSessionRepository,
} from "../../checkout/domain/ports/checkout-session.repository.port.js";

export type AcpDerivedStatus = "pending" | "awaiting_payment" | "completed" | "canceled";

/**
 * Derives the internal AACP checkout lifecycle status from a session and its
 * event history. Pure orchestration rule — no side effects.
 *
 *   - order_completed event   -> completed
 *   - checkout_abandoned event -> canceled
 *   - items + shipping + total -> awaiting_payment
 *   - otherwise                -> pending
 */
@Injectable()
export class AcpStatusPolicy {
  constructor(
    @Inject(CHECKOUT_SESSION_REPOSITORY)
    private readonly sessions: CheckoutSessionRepository,
  ) {}

  async derive(session: CheckoutSession): Promise<AcpDerivedStatus> {
    const events = await this.sessions.getSessionEvents(
      session.merchantId,
      session.sessionId,
    );
    return AcpStatusPolicy.deriveFrom(session, events);
  }

  static deriveFrom(
    session: CheckoutSession,
    events: ReadonlyArray<CheckoutEventName>,
  ): AcpDerivedStatus {
    if (events.includes("order_completed")) return "completed";
    if (events.includes("checkout_abandoned")) return "canceled";

    const hasItems = (session.cart?.items?.length ?? 0) > 0;
    const hasShipping = !!session.shipping;
    const total = session.cart?.total ?? 0;
    if (hasItems && hasShipping && total > 0) return "awaiting_payment";
    return "pending";
  }
}

import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { CheckoutSession, ShippingQuote } from "@zyon/shared-types";
import {
  CHECKOUT_SESSION_REPOSITORY,
  type CheckoutSessionRepository,
} from "../../checkout/domain/ports/checkout-session.repository.port.js";

/**
 * Resolves a fulfillment option id to its {@link ShippingQuote} and persists
 * it as the session's selected shipping.
 *
 * The ACP fulfillment_option_id format encodes the option index as the
 * trailing segment (e.g. "Correios-0" -> index 0). Out-of-range or
 * non-numeric ids map to {@link NotFoundException}; an empty shippingOptions
 * array maps to {@link BadRequestException}.
 */
@Injectable()
export class AcpFulfillmentSelector {
  constructor(
    @Inject(CHECKOUT_SESSION_REPOSITORY)
    private readonly sessions: CheckoutSessionRepository,
  ) {}

  async selectAndApply(session: CheckoutSession, fulfillmentOptionId: string): Promise<void> {
    const options = session.shippingOptions ?? [];
    if (options.length === 0) {
      throw new BadRequestException("acp_no_shipping_options");
    }

    const idx = Number(fulfillmentOptionId.split("-").pop());
    const selected =
      Number.isFinite(idx) && idx >= 0 && idx < options.length ? options[idx] : undefined;
    if (!selected) {
      throw new NotFoundException("acp_fulfillment_option_not_found");
    }

    const nextShipping: ShippingQuote = { ...selected };

    await this.sessions.saveSession({
      ...session,
      shipping: nextShipping,
      updatedAt: new Date().toISOString(),
    });
  }
}

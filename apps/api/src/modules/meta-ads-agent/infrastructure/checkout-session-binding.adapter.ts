import type { CheckoutSessionRepository } from "../../checkout/domain/ports/checkout-session.repository.port.js";
import type { AttributionSessionBindingPort } from "../domain/types.js";
export class CheckoutSessionBindingAdapter implements AttributionSessionBindingPort {
  constructor(private readonly sessions: Pick<CheckoutSessionRepository, "getSession">) {}
  async parent(merchantId: string, checkoutSessionId: string): Promise<string | null> {
    const session = await this.sessions.getSession(merchantId, checkoutSessionId);
    if (!session || session.merchantId !== merchantId || session.sessionId !== checkoutSessionId || session.cart.source !== "storefront") return null;
    const reference = (session.cart as { cart_ref?: unknown }).cart_ref;
    return typeof reference === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(reference) ? reference : null;
  }
}

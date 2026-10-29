import type { CheckoutCommercialMutation, CheckoutSessionRepository } from "../../domain/ports/checkout-session.repository.port.js";

export function commitCheckoutMutation(repository: CheckoutSessionRepository, input: CheckoutCommercialMutation) {
  if (!repository.commitCommercialMutation) throw new Error("CHECKOUT_COMMERCIAL_TRANSACTION_UNAVAILABLE");
  return repository.commitCommercialMutation(input);
}

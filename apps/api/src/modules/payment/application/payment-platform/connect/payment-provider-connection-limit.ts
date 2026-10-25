import { ConflictException } from "@nestjs/common";
import type { PaymentConnectionProvider } from "../../../domain/payment-platform.types.js";
import type { PaymentPlatformRepository } from "../../../domain/ports/payment-platform-repository.port.js";

/** A merchant can offer redundancy without presenting duplicate checkout rails. */
export const MAX_PAYMENT_PROVIDER_CONNECTIONS = 2;

/**
 * Fails before provider-side onboarding is started. Repository persistence
 * repeats this invariant atomically, so an old OAuth callback cannot create a
 * third provider after the merchant changes their connections in the UI.
 */
export async function assertPaymentProviderConnectionCapacity(
  repository: PaymentPlatformRepository,
  merchantId: string,
  provider: PaymentConnectionProvider,
): Promise<void> {
  const existing = await repository.getConnection(merchantId, provider);
  if (existing) return;

  const connections = await repository.listConnections(merchantId);
  if (connections.length >= MAX_PAYMENT_PROVIDER_CONNECTIONS) {
    throw new ConflictException("payment_provider_connection_limit_reached");
  }
}

import type { ProviderShippingEnvelope, ProviderShippingPending, ProviderShippingResult } from "../contracts/widget-checkout-provider-shipping.schemas.js";
import type { ReadonlyCheckoutShippingRequest } from "../../../shipping/domain/ports/readonly-checkout-shipping-supplier.port.js";

export type ProviderShippingScope = { merchantId: string; sessionId: string };
/** Each operation owns one REAL transaction, canonical prepareAccepted/fences,
 * DB clock, revision/event and row-version CAS. begin refuses existing pending /
 * unknown and returns only AFTER known commit. Never fake tx or trust hashes
 * from a body. No implementation/public wiring exists in this slice. */
export interface WidgetCheckoutProviderShippingRepository {
  begin(scope: ProviderShippingScope, command: { expectedVersion: number }): Promise<{
    pending: ProviderShippingPending; dispatch: ReadonlyCheckoutShippingRequest;
  }>;
  complete(scope: ProviderShippingScope, requestId: string, result: ProviderShippingResult): Promise<ProviderShippingEnvelope>;
  markUnknown(scope: ProviderShippingScope, requestId: string): Promise<ProviderShippingEnvelope>;
}

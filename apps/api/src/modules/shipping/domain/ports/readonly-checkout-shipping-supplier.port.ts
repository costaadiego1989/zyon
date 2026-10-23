import type { ProviderShippingResult } from "../../../cross-sell/domain/contracts/widget-checkout-provider-shipping.schemas.js";

/** SERVER canonical request returned after a known pending-generation commit.
 * No controller/body can supply this object. Supplier must perform only quote /
 * geocode reads, never session writes, labels, subsidies or platform fallback. */
export type ReadonlyCheckoutShippingRequest = {
  requestId: string; merchantId: string; expiresAt: string; metadataHash: string;
  originZip: string; destinationZip: string;
} & ({ mode: "radius"; config: unknown } | { mode: "carrier"; canonicalCarrierInput: unknown });

export interface ReadonlyCheckoutShippingSupplier {
  quote(request: ReadonlyCheckoutShippingRequest): Promise<ProviderShippingResult>;
}

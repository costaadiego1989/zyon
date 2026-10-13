import type { CreateProviderPaymentInput } from "./payment-provider.port.js";
import type { MarketplaceCaptureEvidence } from "../../../marketplace/domain/ports/marketplace-capture-provider.port.js";
import type { MarketplacePayoutRequest, MarketplacePayoutSubmission, MarketplacePayoutObservation } from "../../../marketplace/domain/ports/marketplace-payout-provider.port.js";

export const RETAINED_MERCHANT_PAYMENT_PROVIDER = Symbol("RETAINED_MERCHANT_PAYMENT_PROVIDER");
export interface RetainedMerchantPaymentProvider {
  preflight(input: CreateProviderPaymentInput): Promise<void>;
  readCapture(input: CreateProviderPaymentInput, providerPaymentId: string): Promise<MarketplaceCaptureEvidence>;
  submit(input: MarketplacePayoutRequest): Promise<MarketplacePayoutSubmission>;
  reconcile(input: MarketplacePayoutRequest, providerTransferId?: string): Promise<MarketplacePayoutObservation>;
}

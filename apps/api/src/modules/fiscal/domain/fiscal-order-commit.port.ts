import type { CheckoutSession, CompletedOrder } from "@zyon/shared-types";

export interface FiscalOrderCommitInput { order: CompletedOrder; session: CheckoutSession; paymentIntentId?: string }
export interface FiscalOrderPolicy {
  version: 1;
  sellers: { merchantId: string; connectionId: string; erpConnectionId?: string; stockOwner: string; emailOwner: string; whatsappOwner: string; skus: string[] }[];
}
/** Called by the commercial repository using its actual open transaction. */
export interface FiscalOrderCommitPort { record(input: FiscalOrderCommitInput): Promise<FiscalOrderPolicy> }

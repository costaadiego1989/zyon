import type { CustomerHints } from "@aacp/shared-types";

export class CheckoutIdentityService {
  static identityKey(merchantId: string, customer?: CustomerHints): string | undefined {
    const normalizedMerchantId = merchantId.trim();
    const hint = customer?.externalCustomerId ?? customer?.email ?? customer?.phone;
    const normalizedHint = hint?.trim().toLowerCase();
    if (!normalizedMerchantId || !normalizedHint) return undefined;
    return `${normalizedMerchantId}:${normalizedHint}`;
  }
}

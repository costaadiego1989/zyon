import type { AuthorizedOffer, MerchantRules } from "@zyon/shared-types";

export function createAuthorizedOffer(input: {
  merchantId: string;
  sessionId: string;
  rules: MerchantRules;
  evaluation: {
    approved: boolean;
    type: AuthorizedOffer["type"];
    value: number;
    reason: string;
    marginAfterOffer: number;
  };
}): AuthorizedOffer {
  const expiresAt = new Date(Date.now() + input.rules.offerExpirationMinutes * 60_000).toISOString();
  return {
    id: `off_${crypto.randomUUID()}`,
    merchantId: input.merchantId,
    sessionId: input.sessionId,
    type: input.evaluation.type,
    value: input.evaluation.value,
    approved: input.evaluation.approved,
    reason: input.evaluation.reason,
    marginAfterOffer: input.evaluation.marginAfterOffer,
    expiresAt,
    // Use CSPRNG — code must not be derivable from session id.
    discountCode: input.evaluation.approved ? `AI-${crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}` : undefined
  };
}

import type { AuthorizedOffer, MerchantRules } from "@aacp/shared-types";

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
    discountCode: input.evaluation.approved ? `AI-${input.sessionId.slice(0, 6).toUpperCase()}` : undefined
  };
}

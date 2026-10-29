import type { BuyerUserEntity } from "../entities/buyer-user.entity.js";

export const CURRENT_CONSENT_VERSION = "v1";

export interface ConsentCheckResult {
  allowed: boolean;
  reason?: "CONSENT_REQUIRED" | "OUTDATED_CONSENT";
}

export function checkConsent(buyer: BuyerUserEntity): ConsentCheckResult {
  if (!buyer.consent_version) {
    return { allowed: false, reason: "CONSENT_REQUIRED" };
  }
  if (buyer.consent_version !== CURRENT_CONSENT_VERSION) {
    return { allowed: false, reason: "OUTDATED_CONSENT" };
  }
  return { allowed: true };
}

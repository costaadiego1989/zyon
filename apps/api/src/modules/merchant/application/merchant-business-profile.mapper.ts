import type { MerchantBusinessProfile } from "../domain/merchant.types.js";
import { resolveServiceBusinessPolicy, type ServiceBusinessPolicyInput } from "../domain/service-business-policy.js";

/** Deliberate whitelist: no raw merchant/policy record or provider credential. */
export function mapMerchantBusinessProfile(input: ServiceBusinessPolicyInput): MerchantBusinessProfile {
  const resolved = resolveServiceBusinessPolicy(input);
  return {
    businessMode: resolved.businessMode,
    businessModeSelectionState: resolved.selectionState,
    servicePolicyStatus: resolved.policyStatus,
    policyVersion: resolved.policyVersion,
    servicePolicy: resolved.policy ? { ...resolved.policy, admissionsEnabled: input.policy?.admissionsEnabled === true } : null,
    bookingBlockReason: resolved.bookingBlockReason,
    capabilities: resolved.capabilities,
  };
}

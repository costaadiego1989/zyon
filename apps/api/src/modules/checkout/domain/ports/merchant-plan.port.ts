export const MERCHANT_PLAN_PORT = Symbol("MERCHANT_PLAN_PORT");

/**
 * Resolves merchant billing plan features into checkout experience flags.
 * Encapsulates billing plan gating logic, moving it out of use-cases.
 */
export interface MerchantPlanPort {
  /**
   * Resolve experience flags based on merchant's effective billing plan.
   * @param merchantId - Merchant to resolve billing plan for
   * @returns Experience flags; defaults to { showBranding: true, voiceEnabled: false } on error
   */
  resolveExperienceFlags(
    merchantId: string
  ): Promise<{ showBranding: boolean; voiceEnabled: boolean }>;
}

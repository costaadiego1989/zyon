import { useApi } from "../useApi.js";

/**
 * Domain-scoped hook for merchant profile and configuration operations.
 *
 * Use this hook when your page manages merchant settings, themes, store information, domains, team members, or store category.
 * It exposes commonly-used merchant configuration methods without the full API surface.
 *
 * For merchant operations not listed here, fall back to `useApi()` and access `api.methodName()`.
 *
 * @example
 * const merchant = useMerchantApi();
 * const profile = await merchant.merchantProfile();
 * const theme = await merchant.getMerchantTheme();
 * await merchant.putMerchantTheme(newTheme);
 */
export function useMerchantApi() {
  const api = useApi();
  return {
    merchantProfile: api.merchantProfile,
    getMerchantRules: api.getMerchantRules,
    putMerchantRules: api.putMerchantRules,
    getMerchantTheme: api.getMerchantTheme,
    putMerchantTheme: api.putMerchantTheme,
    uploadLogo: api.uploadLogo,
    putStoreCategory: api.putStoreCategory,
    getStoreSettings: api.getStoreSettings,
    putStoreSettings: api.putStoreSettings,
    putStoreName: api.putStoreName,
    generatePolicy: api.generatePolicy,
    getSeoSettings: api.getSeoSettings,
    putSeoSettings: api.putSeoSettings,
    generateSeoSuggestions: api.generateSeoSuggestions,
    getCrossSellConfig: api.getCrossSellConfig,
    putCrossSellConfig: api.putCrossSellConfig,
    listDomains: api.listDomains,
    addDomain: api.addDomain,
    verifyDomain: api.verifyDomain,
    removeDomain: api.removeDomain,
    listTeam: api.listTeam,
    inviteTeamMember: api.inviteTeamMember,
    updateTeamMemberRole: api.updateTeamMemberRole,
    removeTeamMember: api.removeTeamMember,
  };
}

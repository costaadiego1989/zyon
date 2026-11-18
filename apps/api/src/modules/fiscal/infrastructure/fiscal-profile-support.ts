import type { FiscalProfileSupportPort } from "../domain/fiscal-profile.port.js";
import { FISCAL_BASE_RECIPIENT_REQUIREMENTS } from "../domain/fiscal-recipient.js";
export const FISCAL_PROFILE_CONTRACTS = {
  focus: "focus-nfe-v2-2026-11",
  bling: "bling-v3-2026-11",
  omie: "omie-app-v1-2026-11",
  tiny: "olist-v3-2026-11",
} as const;
/** Reviewed goods profiles only. Tax values and account IDs still require protected merchant confirmation. */
export const fiscalProfileSupport: FiscalProfileSupportPort = {
  describe(provider) {
    const sourceContractVersion = FISCAL_PROFILE_CONTRACTS[provider];
    return { sourceContractVersion, operations: ["sale"], currencies: ["BRL"], issuerRegimes: ["simples_nacional", "lucro_presumido", "lucro_real"], productTypes: ["physical"], minimumRecipientRequirements: FISCAL_BASE_RECIPIENT_REQUIREMENTS };
  },
  find(provider, version) {
    return FISCAL_PROFILE_CONTRACTS[provider] === version
      ? {
          operations: ["sale"],
          currencies: ["BRL"],
          issuerRegimes: ["simples_nacional", "lucro_presumido", "lucro_real"],
          productTypes: ["physical"],
          minimumRecipientRequirements: FISCAL_BASE_RECIPIENT_REQUIREMENTS,
        }
      : null;
  },
};

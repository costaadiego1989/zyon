import type { MerchantRules, MerchantTheme } from "@aacp/shared-types";

export interface MerchantProfile {
  id: string;
  name: string;
  theme?: MerchantTheme;
  stripeConnectAccountId?: string;
}

export { type MerchantRules, type MerchantTheme };

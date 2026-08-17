import type { MerchantRules, MerchantTheme } from "@zyon/shared-types";

export interface MerchantStoreSettings {
  social?: {
    instagram?: string;
    facebook?: string;
    linkedin?: string;
    youtube?: string;
    googleMaps?: string;
  };
  company?: {
    cnpj?: string;
    razaoSocial?: string;
    inscricaoEstadual?: string;
    email?: string;
    phone?: string;
    address?: {
      street?: string;
      number?: string;
      complement?: string;
      neighborhood?: string;
      city?: string;
      state?: string;
      zip?: string;
    };
  };
  businessHours?: Array<{
    day: string;
    startTime: string;
    endTime: string;
    closed: boolean;
  }>;
  policies?: {
    privacy?: string;
    returns?: string;
    terms?: string;
    shipping?: string;
  };
  styles?: {
    logoUrl?: string;
    faviconUrl?: string;
    accentColor?: string;
    secondaryColor?: string;
    fontDisplay?: string;
    fontFamily?: string;
  };
}

export interface MerchantProfile {
  id: string;
  name: string;
  theme?: MerchantTheme;
  storeCategory?: string;
  plan?: string;
  storeSettings?: MerchantStoreSettings;
  stripeConnectAccountId?: string;
}

export { type MerchantRules, type MerchantTheme };

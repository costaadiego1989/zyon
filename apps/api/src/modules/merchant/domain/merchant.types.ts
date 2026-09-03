import type { MerchantRules, MerchantTheme, SeoSettings, GtmSettings } from "@zyon/shared-types";

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
  seo?: SeoSettings;
  gtm?: GtmSettings;
  slug?: string;
  /** Intent Memory (behavioral intent tracking) merchant-level config. */
  intentMemory?: {
    intent_tracking_enabled?: boolean;
  };
  /**
   * Post-sale campaign toggles + timings. Persisted by the dashboard
   * (Pós-Venda → Configurações) and read by the scheduling use-cases so a
   * disabled campaign is actually skipped server-side.
   */
  postSaleCampaigns?: PostSaleCampaignSettings;
}

export interface PostSaleCampaignSettings {
  followUpEnabled?: boolean;
  reviewEnabled?: boolean;
  reviewDelayDays?: number;
  npsEnabled?: boolean;
  npsDelayDays?: number;
  crossSellEnabled?: boolean;
  crossSellDelayDays?: number;
  winBackEnabled?: boolean;
  winBackThresholdDays?: number;
  loyaltyEnabled?: boolean;
  loyaltyMilestones?: string;
  reorderEnabled?: boolean;
}

export interface MerchantProfile {
  id: string;
  name: string;
  slug?: string;
  theme?: MerchantTheme;
  storeCategory?: string;
  plan?: string;
  storeSettings?: MerchantStoreSettings;
  stripeConnectAccountId?: string;
}

export { type MerchantRules, type MerchantTheme };

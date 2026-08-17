import type { Cart, CustomerHints, ShippingQuote } from "@zyon/shared-types";

export interface ProductSelectionLine {
  sku: string;
  quantity: number;
}

export interface WidgetConfig {
  mode: "legacy" | "embed";
  embedSessionToken?: string;
  merchantId: string;
  apiBaseUrl: string;
  productApiBaseUrl?: string;
  productSelection?: ProductSelectionLine[];
  cart: Cart;
  customer?: CustomerHints;
  shipping?: ShippingQuote;
  uiPresentation: "floating" | "conversational";
  emptyCartRedirectUrl?: string;
  storeUrl?: string;
  cartRef?: string;
  cartId?: string;
  successRedirectUrl?: string;
  successRedirectLabel?: string;
  brand?: {
    name?: string;
    logoUrl?: string;
    accentColor?: string;
  };
  policies?: {
    privacyUrl?: string;
  };
  agent?: {
    name?: string;
    greeting?: string;
    tone?: string;
    language?: string;
  };
  copy?: {
    headline?: string;
    subheadline?: string;
    trust_badges?: string[];
    quick_replies?: string[];
  };
  /** Allow demo/mock fallbacks when API is unreachable. Defaults to false in production. */
  allowDemoFallbacks?: boolean;
}

export type GlobalAuthMode = "login" | "register";

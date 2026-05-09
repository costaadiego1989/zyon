import type { Cart, CustomerHints, ShippingQuote } from "@aacp/shared-types";

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
}

export type GlobalAuthMode = "login" | "register";

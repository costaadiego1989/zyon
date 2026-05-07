import type { Cart, CustomerHints, ShippingQuote } from "@aacp/shared-types";

export interface WidgetConfig {
  mode: "legacy" | "embed";
  embedSessionToken?: string;
  merchantId: string;
  apiBaseUrl: string;
  cart: Cart;
  customer?: CustomerHints;
  shipping?: ShippingQuote;
  uiPresentation: "floating" | "conversational";
}

export type GlobalAuthMode = "login" | "register";

import type { CustomerHints } from "@zyon/shared-types";

/** Internal application context; never accepted from a checkout request body. */
export interface TrustedCheckoutBuyer {
  globalUserId: string;
  customer: CustomerHints & { email: string; email_verified: true };
}

/** Resolved by the durable Meta inbox, never by a public checkout request.
 * Phone authentication does not claim that the contact email was verified. */
export interface TrustedWhatsAppCheckoutBuyer {
  merchantId: string;
  conversationId: string;
  globalUserId: string;
  customer: CustomerHints & { phone: string; phone_verified: true; email_verified: false };
  preferences?: { shipping: "cheapest" | "fastest"; payment: "pix" | "card" };
}

export type AuthenticatedCheckoutBuyer = TrustedCheckoutBuyer | TrustedWhatsAppCheckoutBuyer;

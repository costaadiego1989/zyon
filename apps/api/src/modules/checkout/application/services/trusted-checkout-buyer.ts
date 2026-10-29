import type { CustomerHints } from "@zyon/shared-types";

/** Internal application context; never accepted from a checkout request body. */
export interface TrustedCheckoutBuyer {
  globalUserId: string;
  customer: CustomerHints & { email: string; email_verified: true };
}

import type { CheckoutSession } from "@zyon/shared-types";
import type { FiscalRecipient } from "./fiscal-recipient.js";

export const FISCAL_RECIPIENT_STORE = Symbol("FISCAL_RECIPIENT_STORE");
export type FiscalPersonalPatch = { cpf?: string; fullName?: string };
export interface FiscalRecipientStore {
  getSession(merchantId: string, sessionId: string): Promise<CheckoutSession | undefined>;
  saveRecipient(input: { merchantId: string; sessionId: string; buyerId: string; recipient: FiscalRecipient;
    mode?: "buyer" | "other"; personal?: FiscalPersonalPatch; expectedCustomer?: unknown }): Promise<void>;
}

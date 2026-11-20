import type { FiscalDelivery, FiscalDocument } from "@prisma/client";
import type { FiscalIssuanceContext } from "./fiscal-issuance.port.js";
export type FiscalChannel = "email" | "whatsapp";
export type FiscalDeliveryOutcome = { state: "accepted"; messageId: string } | { state: "delivery_unknown" | "failed" | "blocked"; reasonCode: string };
export interface FiscalDeliveryContext { delivery: FiscalDelivery; document: FiscalDocument; issuance: FiscalIssuanceContext }
export type FiscalDeliveryPlan = { ready: false; reasonCode: string } | { ready: true; provider: "resend" | "meta" | "twilio"; accountId: string; connectionId?: string; callbackCredentialCipher?: string; send(): Promise<FiscalDeliveryOutcome> };
export interface FiscalDeliverySenderPort { prepare(context: FiscalDeliveryContext): Promise<FiscalDeliveryPlan> }
/** Only provider-authenticated receivers may construct this command. */
export interface FiscalDeliveryReceipt { provider: "resend" | "meta" | "twilio"; accountId: string; messageId: string; state: "accepted" | "delivered" | "failed"; destination?: string }

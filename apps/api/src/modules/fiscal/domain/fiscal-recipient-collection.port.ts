import type { ChatMessageResponse, CheckoutSession } from "@zyon/shared-types";
import type { FiscalRecipient, FiscalRecipientField } from "./fiscal-recipient.js";
import type { FiscalPersonalPatch } from "./fiscal-recipient-update.port.js";
export const FISCAL_RECIPIENT_COLLECTION = Symbol("FISCAL_RECIPIENT_COLLECTION");
export interface FiscalRecipientCollectionInput {
  merchantId: string; sessionId: string; userMessage: string; buyerId?: string; sessionBound?: boolean; messageId?: string;
}
export interface FiscalRecipientCollectionPort { handle(input: FiscalRecipientCollectionInput): Promise<ChatMessageResponse | undefined> }
export interface FiscalRecipientCollectionState {
  version: 1; draft: FiscalRecipient; awaiting: FiscalRecipientField | "address_confirmation" | "confirmation";
  finished: boolean; seen: Record<string, { message: string; labels: string[] }>;
  lastFallback?: { textHash: string; key: string };
}
export interface FiscalRecipientCollectionStore {
  read(merchantId: string, sessionId: string): Promise<{ session: CheckoutSession; version: number; state: FiscalRecipientCollectionState | null } | null>;
  save(input: { merchantId: string; sessionId: string; buyerId: string; version: number;
    state: FiscalRecipientCollectionState; recipient?: FiscalRecipient; personal?: FiscalPersonalPatch; mode?: "buyer" | "other" }): Promise<void>;
}

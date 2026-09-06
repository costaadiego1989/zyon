import type { IncomingMessageInput } from "../../application/use-cases/handle-incoming-message.use-case.js";
import type { StatusUpdateInput } from "../../application/use-cases/handle-status-update.use-case.js";

export const WHATSAPP_WEBHOOK_INBOX = Symbol("WhatsAppWebhookInbox");
export const INBOX_MAX_ATTEMPTS = 10;
export const INBOX_LEASE_MS = 120_000;

export interface WhatsAppInboxEvent {
  dedupKey: string;
  eventId: string;
  kind: "message" | "status";
  merchantId: string;
  configId: string;
  deviceId: string;
  streamKey: string;
  payload: (IncomingMessageInput & { ignored?: boolean }) | StatusUpdateInput;
  payloadHash: string;
}

export interface WhatsAppInboxClaim extends WhatsAppInboxEvent {
  id: string;
  leaseToken: string;
  attempts: number;
}

export interface WhatsAppWebhookInbox {
  /** Commits the entire batch or throws; a duplicate never overwrites its payload. */
  accept(events: WhatsAppInboxEvent[]): Promise<void>;
  claimNext(): Promise<WhatsAppInboxClaim | null>;
  renew(claim: WhatsAppInboxClaim): Promise<boolean>;
  complete(claim: WhatsAppInboxClaim): Promise<boolean>;
  fail(claim: WhatsAppInboxClaim, errorCode: string): Promise<boolean>;
}

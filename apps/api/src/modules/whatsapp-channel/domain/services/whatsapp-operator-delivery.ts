import { canonicalJson } from "../../../../shared/http/canonical-json.js";
import type { WhatsAppSupportDelivery, WhatsAppSupportDeliveryStatus } from "@zyon/shared-types";
import type { WhatsAppSendResult } from "../ports/whatsapp-sender.port.js";
const record = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const id = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 1024 && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
export interface OperatorDispatchProof {
  readonly eventId: string; readonly merchantId: string; readonly messageId: string; readonly ticketId: string;
  readonly bindingId: string; readonly epoch: number; readonly correlationId: string; readonly leaseToken: string; readonly payloadDigest: string;
}
export function parseOperatorDispatch(input: unknown): Readonly<OperatorDispatchProof> | undefined {
  const event = record(input), payload = record(event?.payload);
  if (!event || !payload || event.eventType !== "whatsapp.support.message.requested" || event.schemaVersion !== 1
    || !id(event.eventId) || !id(event.merchantId) || !id(event.deliveryLeaseToken)
    || !id(payload.messageId) || !id(payload.ticketId) || !id(payload.bindingId)
    || Object.keys(payload).length !== 4 || !["messageId", "ticketId", "bindingId", "epoch"].every(key => Object.hasOwn(payload, key))
    || typeof payload.epoch !== "number" || !Number.isSafeInteger(payload.epoch) || payload.epoch < 1 || payload.epoch > 2147483647
    || event.correlationId !== "support_message:" + payload.messageId || event.causationId !== payload.messageId) return;
  return Object.freeze({ eventId: event.eventId, merchantId: event.merchantId, messageId: payload.messageId,
    ticketId: payload.ticketId, bindingId: payload.bindingId, epoch: payload.epoch,
    correlationId: event.correlationId, leaseToken: event.deliveryLeaseToken, payloadDigest: canonicalJson(payload) });
}
export interface OperatorOutboxRow {
  eventId: string; eventType: string; merchantId: string; schemaVersion: number; correlationId: string; causationId: string;
  producer: string; payload: unknown; status: string; leaseToken: string | null; leaseExpiresAt: Date | null;
}
export function ownsOperatorDispatch(proof: OperatorDispatchProof, row: OperatorOutboxRow | null, now: Date): boolean {
  return !!row && row.eventId === proof.eventId && row.eventType === "whatsapp.support.message.requested" && row.schemaVersion === 1
    && row.merchantId === proof.merchantId && row.producer === "support" && row.correlationId === proof.correlationId && row.causationId === proof.messageId
    && row.status === "processing" && row.leaseToken === proof.leaseToken && row.leaseExpiresAt instanceof Date
    && Number.isFinite(now.getTime()) && row.leaseExpiresAt.getTime() > now.getTime() && canonicalJson(row.payload) === proof.payloadDigest;
}
export type OperatorDeliveryCandidate = Omit<WhatsAppSupportDelivery, "revision">;
export function classifyOperatorSubmission(start: "not_started" | "started" | "unknown", result: WhatsAppSendResult): OperatorDeliveryCandidate {
  if (start === "not_started") return { status: "failed", providerMessageId: null, errorCode: "submission_not_started" };
  if (start === "started" && (result.status === "sent" || result.status === "queued") && id(result.messageId))
    return { status: "accepted", providerMessageId: result.messageId };
  if (start === "started" && result.status === "failed") return { status: "failed", providerMessageId: null, errorCode: "provider_rejected" };
  return { status: "unknown", providerMessageId: null, errorCode: "submission_unknown" };
}
export function mergeOperatorDelivery(current: WhatsAppSupportDelivery, incoming: OperatorDeliveryCandidate): { changed: boolean; state: WhatsAppSupportDelivery } {
  if (current.providerMessageId !== null && incoming.providerMessageId !== null && current.providerMessageId !== incoming.providerMessageId)
    throw new Error("operator_delivery_provider_conflict");
  let status: WhatsAppSupportDeliveryStatus = current.status;
  if (current.status !== "read") {
    if (incoming.status === "read") status = "read";
    else if (current.status !== "delivered") {
      if (incoming.status === "delivered") status = "delivered";
      else if (incoming.status === "failed") status = "failed";
      else if (incoming.status === "accepted" && (current.status === "queued" || current.status === "unknown")) status = "accepted";
      else if (incoming.status === "unknown" && current.status === "queued") status = "unknown";
    }
  }
  const providerMessageId = current.providerMessageId ?? incoming.providerMessageId;
  const errorCode = status === "failed" || status === "unknown" ? incoming.status === status ? incoming.errorCode : current.errorCode : undefined;
  const state: WhatsAppSupportDelivery = { status, revision: current.revision, providerMessageId, ...(errorCode ? { errorCode } : {}) };
  if (current.status === status && current.providerMessageId === providerMessageId && current.errorCode === errorCode) return { changed: false, state: { ...current } };
  if (!Number.isSafeInteger(current.revision + 1)) throw new Error("operator_delivery_revision_exhausted");
  return { changed: true, state: { ...state, revision: current.revision + 1 } };
}

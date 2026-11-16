import { createHash } from "node:crypto";
import type { Prisma, SupportTicket, SupportTicketMessage, WhatsAppDelivery } from "@prisma/client";
import type { SupportMessageMetadata, WhatsAppSupportDelivery } from "@zyon/shared-types";
import { canonicalJson } from "../../../../shared/http/canonical-json.js";
import { appendSupportEvent } from "../../../support/application/support-persistence.js";
import { whatsappE164 } from "../../domain/services/whatsapp-phone.js";
import type { WhatsAppOperatorAuthority } from "../../domain/services/whatsapp-operator-authorization.js";
import { mergeOperatorDelivery, type OperatorDeliveryCandidate, type OperatorDispatchProof } from "../../domain/services/whatsapp-operator-delivery.js";

const id = (value: unknown): value is string => typeof value === "string" && !!value.trim() && value.length <= 1024 && !/[\u0000-\u001f\u007f]/.test(value);
const object = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
export interface StoredOperatorAuthority extends WhatsAppOperatorAuthority {
  deviceId: string; provider: "META_CLOUD" | "TWILIO" | "BUBBLEWHATS"; recipient: string; accountId: string;
}
/** A queued server command owns these references. Never fill missing fields
 * from today's binding, recipient, account, operator or dispatch lease. */
export function readStoredOperatorAuthority(row: WhatsAppDelivery, proof: OperatorDispatchProof): Readonly<StoredOperatorAuthority> | undefined {
  const response = object(row.response), value = object(response?.authority);
  if (!response || !value || row.id !== proof.correlationId || row.merchantId !== proof.merchantId
    || response.purpose !== "support_message" || response.schemaVersion !== 1 || response.outboxEventId !== proof.eventId || response.messageId !== proof.messageId
    || response.ticketId !== proof.ticketId || value.merchantId !== proof.merchantId || value.bindingId !== proof.bindingId
    || value.ticketId !== proof.ticketId || value.epoch !== proof.epoch || value.configId !== row.configId || value.deviceId !== row.deviceId
    || !id(value.configId) || !id(value.whatsappSessionId) || !id(value.deviceId) || !id(value.operatorId) || !id(value.accountId)
    || typeof value.recipient !== "string" || whatsappE164(value.recipient) !== value.recipient
    || value.provider !== "META_CLOUD" && value.provider !== "TWILIO" && value.provider !== "BUBBLEWHATS") return;
  return Object.freeze({ merchantId: proof.merchantId, configId: value.configId, whatsappSessionId: value.whatsappSessionId,
    bindingId: proof.bindingId, ticketId: proof.ticketId, epoch: proof.epoch, operatorId: value.operatorId,
    deviceId: value.deviceId, provider: value.provider, recipient: value.recipient, accountId: value.accountId });
}
export function readOperatorDeliveryProjection(value: unknown): WhatsAppSupportDelivery | undefined {
  const row = object(value); if (!row || typeof row.revision !== "number" || !Number.isSafeInteger(row.revision) || row.revision < 0
    || row.providerMessageId !== null && !id(row.providerMessageId)
    || row.errorCode !== undefined && (typeof row.errorCode !== "string" || !/^[a-z][a-z0-9_]{0,80}$/.test(row.errorCode))) return;
  const status = row.status;
  if (status !== "queued" && status !== "accepted" && status !== "delivered" && status !== "read" && status !== "failed" && status !== "unknown") return;
  if ((status === "accepted" || status === "delivered" || status === "read") && row.providerMessageId === null
    || status === "queued" && row.providerMessageId !== null) return;
  return { status, revision: row.revision, providerMessageId: row.providerMessageId, ...(row.errorCode ? { errorCode: row.errorCode } : {}) };
}
export interface StoredOperatorCommand {
  proof: Readonly<OperatorDispatchProof>; authority: Readonly<StoredOperatorAuthority>; row: WhatsAppDelivery;
  response: Prisma.JsonObject; message: SupportTicketMessage; ticket: SupportTicket; projection: WhatsAppSupportDelivery; clientMessageId: string;
}
/** Caller holds the original support resource lock. This function then owns
 * the delivery row. Historical result writes need no new live-case authority. */
export async function loadOperatorMessageWithin(tx: Prisma.TransactionClient, proof: OperatorDispatchProof,
  expected: Readonly<StoredOperatorAuthority>): Promise<StoredOperatorCommand> {
  await tx.$queryRaw`SELECT id FROM whatsapp_deliveries WHERE id=${proof.correlationId} AND merchant_id=${proof.merchantId} FOR UPDATE`;
  const row = await tx.whatsAppDelivery.findFirst({ where: { id: proof.correlationId, merchantId: proof.merchantId } });
  const authority = row && readStoredOperatorAuthority(row, proof);
  if (!row || !authority || canonicalJson(authority) !== canonicalJson(expected)) throw new Error("operator_command_identity_invalid");
  const response = row.response;
  if (!response || typeof response !== "object" || Array.isArray(response)) throw new Error("operator_command_response_invalid");
  const [message, ticket] = await Promise.all([
    tx.supportTicketMessage.findFirst({ where: { id: proof.messageId, ticketId: proof.ticketId, senderType: "merchant", ticket: { merchantId: proof.merchantId } } }),
    tx.supportTicket.findFirst({ where: { id: proof.ticketId, merchantId: proof.merchantId, sessionId: authority.whatsappSessionId, source: "whatsapp" } }),
  ]);
  const metadata = object(message?.metadata), projection = readOperatorDeliveryProjection(response.delivery);
  if (!message || !ticket || !metadata || !projection || !id(message.clientMessageId) || response.clientMessageId !== message.clientMessageId
    || response.contentHash !== createHash("sha256").update(message.content).digest("hex")
    || metadata.kind !== "whatsapp_outgoing" || metadata.schemaVersion !== 1 || metadata.bindingId !== authority.bindingId
    || metadata.configId !== authority.configId || metadata.whatsappSessionId !== authority.whatsappSessionId || metadata.epoch !== authority.epoch
    || metadata.operatorId !== authority.operatorId || metadata.clientMessageId !== message.clientMessageId
    || canonicalJson(metadata.delivery) !== canonicalJson(projection) || canonicalJson(response.delivery) !== canonicalJson(projection)
    || row.providerMessageId !== projection.providerMessageId) throw new Error("operator_command_message_invalid");
  return { proof, authority, row, response, message, ticket, projection, clientMessageId: message.clientMessageId };
}
/** Only this allowlisted projection enters the public message. Original
 * outbox lease, attempts, credentials and destination stay in private row JSON. */
export async function saveOperatorDeliveryWithin(tx: Prisma.TransactionClient, command: StoredOperatorCommand,
  incoming: OperatorDeliveryCandidate, options: { privatePatch?: Prisma.InputJsonObject; internalState?: "preparing" | "started"; processingToken?: string } = {}): Promise<WhatsAppSupportDelivery> {
  if (options.internalState && command.projection.status !== "queued") throw new Error("operator_prepare_already_terminal");
  const { changed, state } = mergeOperatorDelivery(command.projection, incoming);
  const delivery = { status: state.status, revision: state.revision, providerMessageId: state.providerMessageId, ...(state.errorCode ? { errorCode: state.errorCode } : {}) };
  await tx.whatsAppDelivery.update({ where: { id: command.row.id, merchantId: command.proof.merchantId }, data: {
    state: options.internalState ?? state.status, providerMessageId: state.providerMessageId,
    ...(options.processingToken ? { processingToken: options.processingToken } : {}),
    response: { ...command.response, ...options.privatePatch, delivery },
  } });
  if (changed) {
    const metadata = { kind: "whatsapp_outgoing", schemaVersion: 1, bindingId: command.authority.bindingId, configId: command.authority.configId,
      whatsappSessionId: command.authority.whatsappSessionId, epoch: command.authority.epoch, operatorId: command.authority.operatorId,
      clientMessageId: command.clientMessageId, delivery } satisfies Extract<SupportMessageMetadata, { kind: "whatsapp_outgoing" }>;
    await tx.supportTicketMessage.update({ where: { id: command.message.id, ticketId: command.ticket.id }, data: { metadata } });
    await appendSupportEvent(tx, command.proof.merchantId, command.ticket.id, "delivery", command.message.id);
  }
  return state;
}

import { createHash } from "node:crypto";
import type { Prisma, SupportTicket, SupportTicketMessage, WhatsAppDelivery } from "@prisma/client";
import type { WhatsAppSupportDelivery } from "@zyon/shared-types";
import { canonicalJson } from "../../../../shared/http/canonical-json.js";
import { appendSupportEvent } from "../../../support/application/support-persistence.js";
import { WHATSAPP_RESUME_TEXT, type WhatsAppResumeAuthority, type WhatsAppResumeDispatch } from "../../domain/services/whatsapp-resume-command.js";
import { mergeOperatorDelivery, type OperatorDeliveryCandidate } from "../../domain/services/whatsapp-operator-delivery.js";
import { whatsappE164 } from "../../domain/services/whatsapp-phone.js";
import { readOperatorDeliveryProjection } from "./whatsapp-support-message-state.js";

const record = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown> : undefined;
const id = (value: unknown): value is string => typeof value === "string" && value.trim() === value && value.length > 0 && value.length <= 1024
  && !/[\u0000-\u001f\u007f]/.test(value);

/** Independent human_resume proof. Never complete a missing original field
 * from a current config/account, or accept the55support_message purpose. */
export function readStoredResumeAuthority(row: WhatsAppDelivery, proof: WhatsAppResumeDispatch): Readonly<WhatsAppResumeAuthority> | undefined {
  const saved = record(row.response), a = record(saved?.authority), delivery = readOperatorDeliveryProjection(saved?.delivery);
  if (!saved || !a || !delivery || row.id !== proof.deliveryId || row.merchantId !== proof.merchantId
    || saved.purpose !== "human_resume" || saved.schemaVersion !== 1 || saved.outboxEventId !== proof.eventId
    || saved.messageId !== proof.messageId || saved.ticketId !== proof.ticketId
    || a.merchantId !== proof.merchantId || a.configId !== row.configId || a.deviceId !== row.deviceId
    || a.bindingId !== proof.bindingId || a.ticketId !== proof.ticketId || a.previousEpoch !== proof.previousEpoch || a.epoch !== proof.epoch
    || !id(a.configId) || !id(a.deviceId) || !id(a.whatsappSessionId) || !id(a.operatorId)
    || a.provider !== "META_CLOUD" && a.provider !== "TWILIO" && a.provider !== "BUBBLEWHATS"
    || a.identityStatus !== "available" && a.identityStatus !== "unavailable") return;
  if (a.identityStatus === "available") {
    if (!id(a.accountId) || typeof a.recipient !== "string" || whatsappE164(a.recipient) !== a.recipient) return;
  } else if (a.accountId !== null && !id(a.accountId)
    || a.recipient !== null && (typeof a.recipient !== "string" || whatsappE164(a.recipient) !== a.recipient)
    || row.state !== "failed" || row.processingToken !== "not_started" || saved.submission !== undefined
    || delivery.status !== "failed" || delivery.revision !== 0 || delivery.providerMessageId !== null
    || delivery.errorCode !== "channel_identity_unavailable") return;
  return Object.freeze({ merchantId: proof.merchantId, configId: a.configId, whatsappSessionId: a.whatsappSessionId,
    deviceId: a.deviceId, provider: a.provider, bindingId: proof.bindingId, ticketId: proof.ticketId,
    operatorId: a.operatorId, previousEpoch: proof.previousEpoch, epoch: proof.epoch, identityStatus: a.identityStatus,
    accountId: typeof a.accountId === "string" ? a.accountId : null, recipient: typeof a.recipient === "string" ? a.recipient : null });
}
export interface StoredResumeCommand {
  proof: Readonly<WhatsAppResumeDispatch>; authority: Readonly<WhatsAppResumeAuthority>;
  row: WhatsAppDelivery; response: Prisma.JsonObject; ticket: SupportTicket; message: SupportTicketMessage; projection: WhatsAppSupportDelivery;
}
/** Caller retains session/support locks for current effects, or support lock
 * for exact historical completion. Delivery row follows that lock order. */
export async function loadResumeMessageWithin(tx: Prisma.TransactionClient, proof: WhatsAppResumeDispatch,
  expected: Readonly<WhatsAppResumeAuthority>): Promise<StoredResumeCommand> {
  await tx.$queryRaw`SELECT id FROM whatsapp_deliveries WHERE id=${proof.deliveryId} AND merchant_id=${proof.merchantId} FOR UPDATE`;
  const row = await tx.whatsAppDelivery.findFirst({ where: { id: proof.deliveryId, merchantId: proof.merchantId } });
  const authority = row && readStoredResumeAuthority(row, proof);
  if (!row || !authority || canonicalJson(authority) !== canonicalJson(expected)) throw Error("resume_command_identity_invalid");
  const response = row.response as Prisma.JsonObject, projection = readOperatorDeliveryProjection(response.delivery);
  const [message, ticket] = await Promise.all([
    tx.supportTicketMessage.findFirst({ where: { id: proof.messageId, ticketId: proof.ticketId, senderType: "system" } }),
    tx.supportTicket.findFirst({ where: { id: proof.ticketId, merchantId: proof.merchantId, sessionId: authority.whatsappSessionId, source: "whatsapp" } }),
  ]);
  const metadata = record(message?.metadata);
  if (!message || !ticket || !metadata || !projection || response.status !== "closed" && response.status !== "resolved"
    || response.contentHash !== createHash("sha256").update(WHATSAPP_RESUME_TEXT).digest("hex") || message.content !== WHATSAPP_RESUME_TEXT
    || metadata.kind !== "whatsapp_resume" || metadata.schemaVersion !== 1 || metadata.bindingId !== authority.bindingId
    || metadata.configId !== authority.configId || metadata.whatsappSessionId !== authority.whatsappSessionId
    || metadata.previousEpoch !== authority.previousEpoch || metadata.epoch !== authority.epoch || metadata.operatorId !== authority.operatorId
    || canonicalJson(metadata.delivery) !== canonicalJson(projection) || canonicalJson(response.delivery) !== canonicalJson(projection)
    || row.providerMessageId !== projection.providerMessageId) throw Error("resume_command_message_invalid");
  return { proof, authority, row, response, message, ticket, projection };
}
/** Only a public delivery projection goes to message/gateway payloads. The
 * original identity, credential digest, lease and attempts stay in row JSON. */
export async function saveResumeDeliveryWithin(tx: Prisma.TransactionClient, command: StoredResumeCommand,
  incoming: OperatorDeliveryCandidate, options: { privatePatch?: Prisma.InputJsonObject; internalState?: "preparing" | "started"; processingToken?: string } = {}) {
  if (command.authority.identityStatus !== "available") throw Error("resume_identity_unavailable_no_start");
  if (options.internalState && command.projection.status !== "queued")
    throw Error("resume_prepare_already_terminal");
  const { changed, state } = mergeOperatorDelivery(command.projection, incoming);
  const delivery = { status: state.status, revision: state.revision, providerMessageId: state.providerMessageId, ...(state.errorCode ? { errorCode: state.errorCode } : {}) };
  await tx.whatsAppDelivery.update({ where: { id: command.row.id, merchantId: command.proof.merchantId }, data: {
    state: options.internalState ?? state.status, providerMessageId: state.providerMessageId,
    ...(options.processingToken ? { processingToken: options.processingToken } : {}), response: { ...command.response, ...options.privatePatch, delivery },
  } });
  if (changed) {
    await tx.supportTicketMessage.update({ where: { id: command.message.id, ticketId: command.ticket.id }, data: { metadata: {
      kind: "whatsapp_resume", schemaVersion: 1, bindingId: command.authority.bindingId, configId: command.authority.configId,
      whatsappSessionId: command.authority.whatsappSessionId, previousEpoch: command.authority.previousEpoch, epoch: command.authority.epoch,
      operatorId: command.authority.operatorId, delivery,
    } } });
    await appendSupportEvent(tx, command.proof.merchantId, command.ticket.id, "delivery", command.message.id);
  }
  return state;
}

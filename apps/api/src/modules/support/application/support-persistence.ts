import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { appendOutboxInTransaction } from "../../../shared/messaging/infrastructure/append-outbox-in-transaction.js";

export async function lockSupportResource(tx: Prisma.TransactionClient, key: string) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))::text`;
}
export async function appendSupportEvent(tx: Prisma.TransactionClient, merchantId: string, ticketId: string, event: string, messageId?: string) {
  const id = randomUUID();
  await appendOutboxInTransaction(tx, {
    event_id: id, event_type: "support.case.changed", schema_version: 1,
    merchant_id: merchantId, occurred_at: new Date().toISOString(),
    correlation_id: ticketId, causation_id: messageId ?? ticketId, producer: "support",
    payload: { ticketId, event, messageId: messageId ?? null },
  });
}
export async function persistSupportMessage(tx: Prisma.TransactionClient, input: {
  ticketId: string; merchantId: string; senderType: string; content: string;
  metadata?: Prisma.InputJsonValue; clientMessageId?: string;
}) {
  const previous = await tx.supportTicketMessage.findFirst({ where: { ticketId: input.ticketId }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
  const createdAt = new Date(Math.max(Date.now(), previous ? previous.createdAt.getTime() + 1 : 0));
  const message = await tx.supportTicketMessage.create({ data: {
    ticketId: input.ticketId, senderType: input.senderType, content: input.content,
    metadata: input.metadata, clientMessageId: input.clientMessageId, createdAt,
  } });
  await tx.supportTicket.update({ where: { id: input.ticketId }, data: { updatedAt: message.createdAt } });
  await appendSupportEvent(tx, input.merchantId, input.ticketId, "message", message.id);
  return message;
}
export function supportMessageDto(message: { id: string; ticketId: string; senderType: string; content: string; metadata?: unknown; createdAt: Date }) {
  return { ...message, createdAt: message.createdAt.toISOString() };
}

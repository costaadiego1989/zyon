import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { PrismaWhatsAppHandoffRepository } from "../../whatsapp-channel/infrastructure/repositories/prisma-whatsapp-handoff.repository.js";
import type { HandoffScope } from "../../whatsapp-channel/domain/services/whatsapp-handoff-state.js";
import { whatsappE164 } from "../../whatsapp-channel/domain/services/whatsapp-phone.js";
import { SupportTicketEntity } from "../domain/entities/support-ticket.entity.js";
import { appendSupportEvent, lockSupportResource, persistSupportMessage } from "./support-persistence.js";

export const WHATSAPP_HANDOFF_ACK = "🤝 *Atendimento humano solicitado*\n\nSeu pedido foi registrado. A equipe responderá por aqui assim que estiver disponível. Seu carrinho está preservado.";

/** Server-only input, built after authentication and (for voice) the existing
 * typed media-envelope validation. No public endpoint accepts this shape. */
export interface WhatsAppSupportIntake {
  scope: HandoffScope;
  inboxId: string;
  leaseToken: string;
  message: string;
  origin: "text" | "button" | "voice";
  appointmentId?: string;
  policyVersion?: number;
}

export async function persistWhatsAppSupportIntake(bindings: PrismaWhatsAppHandoffRepository, input: WhatsAppSupportIntake) {
  if (typeof input.message !== "string" || !input.message.trim() || input.message.length > 4000
    || !input.inboxId || !input.leaseToken || !["text", "button", "voice"].includes(input.origin)) throw new BadRequestException("whatsapp_handoff_input_invalid");
  return bindings.withLocked(input.scope, async (tx, current) => {
    const [clock] = await tx.$queryRaw<Array<{ now: Date }>>(Prisma.sql`SELECT clock_timestamp() AS now`);
    const session = await tx.whatsAppSession.findFirst({ where: { id: input.scope.whatsappSessionId, merchantId: input.scope.merchantId } });
    const inbox = await tx.whatsAppWebhookInbox.findFirst({ where: { id: input.inboxId, merchantId: input.scope.merchantId,
      configId: input.scope.configId, kind: "message", status: "processing", leaseToken: input.leaseToken,
      leaseExpiresAt: { gt: clock.now } } });
    const payload = inbox?.payload;
    if (!session || !inbox || !payload || typeof payload !== "object" || Array.isArray(payload)
      || payload.ignored === true || payload.merchantId !== input.scope.merchantId || payload.deviceId !== session.deviceId
      || inbox.deviceId !== session.deviceId || typeof payload.fromNumber !== "string"
      || whatsappE164(payload.fromNumber) !== whatsappE164(session.buyerPhone)) throw new NotFoundException("whatsapp_handoff_inbox_not_found");
    const identity = await tx.buyerIdentity.findUnique({ where: { merchantId_identityKey: {
      merchantId: input.scope.merchantId, identityKey: "phone:" + session.buyerPhone,
    } } });
    if (!identity) throw new NotFoundException("whatsapp_handoff_buyer_not_found");
    const checkout = session.checkoutSessionId ? await tx.checkoutSession.findFirst({ where: {
      merchantId: input.scope.merchantId, sessionId: session.checkoutSessionId,
    } }) : null;
    const customer = checkout?.customer;
    const buyerId = customer && typeof customer === "object" && !Array.isArray(customer) && customer.phone_verified === true
      && typeof customer.phone === "string" && whatsappE164(customer.phone) === whatsappE164(session.buyerPhone)
      ? checkout!.globalUserId : identity.globalUserId;
    if (!input.appointmentId && input.policyVersion !== undefined) throw new BadRequestException("whatsapp_handoff_appointment_required");
    const appointment = input.appointmentId ? await tx.serviceAppointment.findFirst({ where: {
      id: input.appointmentId, merchantId: input.scope.merchantId, buyerGlobalUserId: buyerId,
    } }) : null;
    if (input.appointmentId && (!appointment || input.policyVersion !== appointment.policyVersion)) throw new NotFoundException("whatsapp_handoff_appointment_not_found");
    let ticket = current.mode !== "ai" && current.ticketId ? await tx.supportTicket.findFirst({ where: {
      id: current.ticketId, merchantId: input.scope.merchantId, sessionId: session.id, source: "whatsapp",
      status: { in: ["open", "in_progress"] }, mergedIntoId: null,
    } }) : null;
    if (current.mode !== "ai" && !ticket) throw new ConflictException("whatsapp_handoff_ticket_unavailable");
    const created = !ticket;
    if (!ticket) {
      const candidate = SupportTicketEntity.create({ merchantId: input.scope.merchantId, sessionId: session.id,
        buyerMessage: input.message, source: "whatsapp" }).snapshot();
      ticket = await tx.supportTicket.create({ data: { ...candidate, buyerId,
        createdAt: new Date(candidate.createdAt), updatedAt: new Date(candidate.updatedAt) } });
      await appendSupportEvent(tx, input.scope.merchantId, ticket.id, "created");
    }
    await lockSupportResource(tx, `support:${ticket.id}`);
    const transition = await bindings.beginWithin(tx, input.scope, current, ticket.id, current.epoch);
    const clientMessageId = "wa_" + createHash("sha256").update(input.inboxId).digest("hex");
    let message = await tx.supportTicketMessage.findFirst({ where: { ticketId: ticket.id, senderType: "buyer", clientMessageId } });
    if (!message) message = await persistSupportMessage(tx, { merchantId: input.scope.merchantId, ticketId: ticket.id,
      senderType: "buyer", clientMessageId, content: input.message.trim(), metadata: {
        kind: "whatsapp_intake", schemaVersion: 1, configId: input.scope.configId, whatsappSessionId: session.id,
        inboxId: input.inboxId, origin: input.origin, epoch: transition.state.epoch,
        ...(appointment ? { appointmentId: appointment.id, policyVersion: appointment.policyVersion } : {}),
      } });
    return { created, ticketId: ticket.id, messageId: message.id, binding: transition.state,
      ticket: { id: ticket.id, merchantId: ticket.merchantId, sessionId: session.id, buyerMessage: ticket.buyerMessage,
        source: "whatsapp" as const, status: ticket.status === "in_progress" ? "in_progress" as const : "open" as const,
        createdAt: ticket.createdAt.toISOString(), updatedAt: ticket.updatedAt.toISOString() },
      reply: WHATSAPP_HANDOFF_ACK };
  });
}

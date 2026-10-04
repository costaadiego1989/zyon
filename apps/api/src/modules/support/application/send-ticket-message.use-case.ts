import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import type { SupportMessageMetadata } from "@zyon/shared-types";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";
import { lockSupportResource, persistSupportMessage } from "./support-persistence.js";

export interface TicketMessageDto {
  id: string; ticketId: string; senderType: "buyer" | "merchant" | "system";
  content: string; metadata?: SupportMessageMetadata | null; createdAt: string;
}
@Injectable()
export class SendTicketMessageUseCase {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}
  async execute(input: { ticketId: string; merchantId: string; senderType: "buyer" | "merchant" | "system";
    content: string; metadata?: SupportMessageMetadata; clientMessageId?: string; }): Promise<TicketMessageDto> {
    if (typeof input.content !== "string" || !input.content.trim() || input.content.length > 4000) throw new BadRequestException("invalid_message");
    if (input.clientMessageId !== undefined && !/^[A-Za-z0-9_-]{8,100}$/.test(input.clientMessageId)) throw new BadRequestException("invalid_message_id");
    const message = await this.prisma.$transaction(async tx => {
      await lockSupportResource(tx, `support:${input.ticketId}`);
      const ticket = await tx.supportTicket.findFirst({ where: { id: input.ticketId, merchantId: input.merchantId } });
      if (!ticket) throw new NotFoundException("ticket_not_found");
      if (input.clientMessageId) {
        const previous = await tx.supportTicketMessage.findFirst({ where: { ticketId: input.ticketId, senderType: input.senderType, clientMessageId: input.clientMessageId } });
        if (previous) return previous;
      }
      if (["closed", "resolved"].includes(ticket.status)) throw new ConflictException("ticket_resolved");
      if (ticket.status === "open" && input.senderType === "merchant") {
        await tx.supportTicket.update({ where: { id: ticket.id }, data: { status: "in_progress" } });
        await persistSupportMessage(tx, { ticketId: ticket.id, merchantId: ticket.merchantId, senderType: "system", content: "A loja iniciou seu atendimento.", metadata: { kind: "case_update", event: "started" } });
      }
      return persistSupportMessage(tx, { ...input, content: input.content.trim(), metadata: input.metadata as any });
    });
    return { id: message.id, ticketId: message.ticketId, senderType: message.senderType as TicketMessageDto["senderType"], content: message.content, metadata: message.metadata as SupportMessageMetadata | null, createdAt: message.createdAt.toISOString() };
  }
}

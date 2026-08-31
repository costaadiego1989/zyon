import { Inject, Injectable, NotFoundException, Logger } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import type { SupportMessageMetadata } from "@zyon/shared-types";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";

export interface TicketMessageDto {
  id: string;
  ticketId: string;
  senderType: "buyer" | "merchant";
  content: string;
  metadata?: SupportMessageMetadata | null;
  createdAt: string;
}

@Injectable()
export class SendTicketMessageUseCase {
  private readonly logger = new Logger(SendTicketMessageUseCase.name);

  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async execute(input: {
    ticketId: string;
    merchantId: string;
    senderType: "buyer" | "merchant";
    content: string;
    metadata?: SupportMessageMetadata;
  }): Promise<TicketMessageDto> {
    const ticket = await this.prisma.supportTicket.findFirst({
      where: { id: input.ticketId, merchantId: input.merchantId },
    });
    if (!ticket) throw new NotFoundException("ticket_not_found");

    const message = await this.prisma.supportTicketMessage.create({
      data: {
        ticketId: input.ticketId,
        senderType: input.senderType,
        content: input.content,
        metadata: input.metadata ? (input.metadata as any) : undefined,
      },
    });

    // Mark ticket as in_progress if still open
    if (ticket.status === "open" && input.senderType === "merchant") {
      await this.prisma.supportTicket.update({
        where: { id: input.ticketId },
        data: { status: "in_progress" },
      });
    }

    return {
      id: message.id,
      ticketId: message.ticketId,
      senderType: message.senderType as "buyer" | "merchant",
      content: message.content,
      metadata: message.metadata as SupportMessageMetadata | null | undefined,
      createdAt: message.createdAt.toISOString(),
    };
  }
}

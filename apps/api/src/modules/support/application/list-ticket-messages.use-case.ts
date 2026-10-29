import { Inject, Injectable, NotFoundException, Logger } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import type { SupportMessageMetadata } from "@zyon/shared-types";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";
import type { TicketMessageDto } from "./send-ticket-message.use-case.js";

@Injectable()
export class ListTicketMessagesUseCase {
  private readonly logger = new Logger(ListTicketMessagesUseCase.name);

  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async execute(input: {
    ticketId: string;
    merchantId: string;
    limit?: number;
    cursor?: string;
  }): Promise<{ data: TicketMessageDto[]; nextCursor: string | null }> {
    const ticket = await this.prisma.supportTicket.findFirst({
      where: { id: input.ticketId, merchantId: input.merchantId },
    });
    if (!ticket) throw new NotFoundException("ticket_not_found");

    const limit = Math.min(input.limit ?? 50, 100);
    const messages = await this.prisma.supportTicketMessage.findMany({
      where: {
        ticketId: input.ticketId,
        ...(input.cursor ? { createdAt: { gt: new Date(input.cursor) } } : {}),
      },
      orderBy: { createdAt: "asc" },
      take: limit + 1,
    });

    const data = messages.slice(0, limit).map((m) => ({
      id: m.id,
      ticketId: m.ticketId,
      senderType: m.senderType as "buyer" | "merchant",
      content: m.content,
      metadata: m.metadata as SupportMessageMetadata | null | undefined,
      createdAt: m.createdAt.toISOString(),
    }));

    const nextCursor = messages.length > limit ? data.at(-1)?.createdAt ?? null : null;

    return { data, nextCursor };
  }
}

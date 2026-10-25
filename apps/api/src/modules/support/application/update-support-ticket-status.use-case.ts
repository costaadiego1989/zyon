import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import type { SupportTicket } from "@zyon/shared-types";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";
import { isSupportTicketStatus } from "../domain/entities/support-ticket.entity.js";
import { SUPPORT_TICKET_REPOSITORY, type SupportTicketRepository } from "../domain/ports/support-ticket-repository.port.js";
import { lockSupportResource, persistSupportMessage } from "./support-persistence.js";

@Injectable()
export class UpdateSupportTicketStatusUseCase {
  constructor(@Inject(SUPPORT_TICKET_REPOSITORY) private readonly repository: SupportTicketRepository,
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}
  async execute(merchantId: string, ticketId: string, status: string, operatorId?: string): Promise<SupportTicket> {
    if (!isSupportTicketStatus(status)) throw new BadRequestException("support_ticket_invalid_status");
    await this.prisma.$transaction(async tx => {
      await lockSupportResource(tx, `support:${ticketId}`);
      const ticket = await tx.supportTicket.findFirst({ where: { id: ticketId, merchantId } });
      if (!ticket) throw new NotFoundException("support_ticket_not_found");
      if (ticket.status === status) return;
      if (["closed", "resolved"].includes(status) && ticket.returnId) {
        const ret = await tx.return.findFirst({ where: { id: ticket.returnId, merchantId } });
        if (ret && !["REFUND_COMPLETED", "EXCHANGE_COMPLETED", "REJECTED", "CANCELLED"].includes(ret.status)) throw new ConflictException("resolve_return_before_closing_ticket");
      }
      if (["closed", "resolved"].includes(ticket.status)) throw new ConflictException("ticket_resolved");
      await tx.supportTicket.update({ where: { id: ticketId }, data: { status, assignedTo: status === "in_progress" ? operatorId : undefined, resolvedAt: ["closed", "resolved"].includes(status) ? new Date() : null } });
      await persistSupportMessage(tx, { ticketId, merchantId, senderType: "system",
        content: status === "in_progress" ? "A loja iniciou seu atendimento. Você pode responder nesta conversa." : status === "open" ? "Seu atendimento está aguardando a loja." : "Atendimento concluído. O histórico continua disponível.",
        metadata: { kind: "case_update", event: status } });
    });
    return (await this.repository.get(merchantId, ticketId))!;
  }
}

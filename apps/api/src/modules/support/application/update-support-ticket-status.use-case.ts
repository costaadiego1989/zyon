import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { SupportTicket, SupportTicketStatus } from "@aacp/shared-types";
import { isSupportTicketStatus } from "../domain/entities/support-ticket.entity.js";
import {
  SUPPORT_TICKET_REPOSITORY,
  type SupportTicketRepository
} from "../domain/ports/support-ticket-repository.port.js";

@Injectable()
export class UpdateSupportTicketStatusUseCase {
  constructor(
    @Inject(SUPPORT_TICKET_REPOSITORY)
    private readonly repository: SupportTicketRepository
  ) {}

  async execute(merchantId: string, ticketId: string, status: string): Promise<SupportTicket> {
    if (!isSupportTicketStatus(status)) {
      throw new BadRequestException("support_ticket_invalid_status");
    }
    const updated = await this.repository.updateStatus(
      merchantId,
      ticketId,
      status as SupportTicketStatus
    );
    if (!updated) throw new NotFoundException("support_ticket_not_found");
    return updated;
  }
}

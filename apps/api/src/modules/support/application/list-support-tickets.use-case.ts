import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import type { SupportTicket, SupportTicketStatus } from "@aacp/shared-types";
import { isSupportTicketStatus } from "../domain/entities/support-ticket.entity.js";
import {
  SUPPORT_TICKET_REPOSITORY,
  type SupportTicketRepository
} from "../domain/ports/support-ticket-repository.port.js";

@Injectable()
export class ListSupportTicketsUseCase {
  constructor(
    @Inject(SUPPORT_TICKET_REPOSITORY)
    private readonly repository: SupportTicketRepository
  ) {}

  async execute(merchantId: string, status?: string): Promise<SupportTicket[]> {
    if (status && !isSupportTicketStatus(status)) {
      throw new BadRequestException("support_ticket_invalid_status");
    }
    return this.repository.list(merchantId, status as SupportTicketStatus | undefined);
  }
}

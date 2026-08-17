import { BadRequestException, Inject, Injectable, NotFoundException , Logger} from "@nestjs/common";
import type { SupportTicket, SupportTicketStatus } from "@zyon/shared-types";
import { isSupportTicketStatus } from "../domain/entities/support-ticket.entity.js";
import {
  SUPPORT_TICKET_REPOSITORY,
  type SupportTicketRepository
} from "../domain/ports/support-ticket-repository.port.js";
import { CorrelationIdStorage } from "../../../shared/logger/correlation-id.storage.js";

@Injectable()
export class UpdateSupportTicketStatusUseCase {
  private readonly logger = new Logger(UpdateSupportTicketStatusUseCase.name);

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

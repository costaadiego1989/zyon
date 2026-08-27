import { BadRequestException, Inject, Injectable, NotFoundException, Logger, Optional } from "@nestjs/common";
import type { SupportTicket, SupportTicketStatus } from "@zyon/shared-types";
import { isSupportTicketStatus } from "../domain/entities/support-ticket.entity.js";
import {
  SUPPORT_TICKET_REPOSITORY,
  type SupportTicketRepository
} from "../domain/ports/support-ticket-repository.port.js";
import { SupportGateway } from "../infrastructure/gateways/support.gateway.js";

@Injectable()
export class UpdateSupportTicketStatusUseCase {
  private readonly logger = new Logger(UpdateSupportTicketStatusUseCase.name);

  constructor(
    @Inject(SUPPORT_TICKET_REPOSITORY)
    private readonly repository: SupportTicketRepository,
    @Optional() private readonly gateway?: SupportGateway,
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

    // Notify buyer's widget that the ticket was resolved/closed so it resets to initial state
    if (status === "resolved" || status === "closed") {
      try {
        this.gateway?.server?.to(`ticket:${ticketId}`)?.emit("ticket_closed", { ticketId, status });
      } catch { /* non-blocking */ }
    }

    return updated;
  }
}

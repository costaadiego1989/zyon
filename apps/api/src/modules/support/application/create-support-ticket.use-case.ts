import { Inject, Injectable } from "@nestjs/common";
import type { SupportTicket } from "@zyon/shared-types";
import { SupportTicketEntity } from "../domain/entities/support-ticket.entity.js";
import {
  SUPPORT_TICKET_REPOSITORY,
  type SupportTicketRepository,
} from "../domain/ports/support-ticket-repository.port.js";
import { SupportTicketEventPublisher } from "./support-ticket-event.publisher.js";

/**
 * SUPP-M4 refactored: Uses SupportTicketEventPublisher to deduplicate webhook publish.
 */
@Injectable()
export class CreateSupportTicketUseCase {
  constructor(
    @Inject(SUPPORT_TICKET_REPOSITORY)
    private readonly repository: SupportTicketRepository,
    private readonly publisher: SupportTicketEventPublisher,
  ) {}

  async execute(input: {
    merchantId: string;
    sessionId?: string;
    message: string;
  }): Promise<SupportTicket> {
    const ticket = await this.repository.save(
      SupportTicketEntity.create({
        merchantId: input.merchantId,
        sessionId: input.sessionId,
        buyerMessage: input.message,
        source: "dashboard",
      }).snapshot(),
    );
    this.publisher.publishCreated(ticket);
    return ticket;
  }
}

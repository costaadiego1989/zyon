/**
 * SUPP-H3: Handoff logic — ticket creation + message formatting.
 */
import { Inject, Injectable } from "@nestjs/common";
import type { SupportTicket } from "@zyon/shared-types";
import { SupportTicketEntity } from "../domain/entities/support-ticket.entity.js";
import {
  SUPPORT_TICKET_REPOSITORY,
  type SupportTicketRepository,
} from "../domain/ports/support-ticket-repository.port.js";
import { SupportTicketEventPublisher } from "./support-ticket-event.publisher.js";

export interface HandoffInput {
  merchantId: string;
  sessionId?: string;
  buyerMessage: string;
}

export interface HandoffResult {
  ticketId: string;
  reply: string;
}

@Injectable()
export class SupportHandoffService {
  constructor(
    @Inject(SUPPORT_TICKET_REPOSITORY) private readonly tickets: SupportTicketRepository,
    private readonly publisher: SupportTicketEventPublisher,
  ) {}

  async createHandoff(
    input: HandoffInput,
    contextReply?: string,
  ): Promise<HandoffResult> {
    const ticket = await this.tickets.save(
      SupportTicketEntity.create({
        merchantId: input.merchantId,
        sessionId: input.sessionId,
        buyerMessage: input.buyerMessage,
        source: "widget",
      }).snapshot(),
    );

    // Publish event fire-and-forget (ticket already persisted)
    this.publisher.publishCreated(ticket);

    return {
      ticketId: ticket.id,
      reply: formatHandoffReply(ticket, contextReply),
    };
  }
}

/**
 * SUPP-H3: Formats the handoff message sent to the buyer.
 * Uses last 6 chars of ticket ID as human-readable reference.
 */
function formatHandoffReply(ticket: SupportTicket, contextReply?: string): string {
  const ticketRef = ticket.id.slice(-6).toUpperCase();
  const prefix = contextReply?.trim() ? `${contextReply.trim()}\n\n` : "";
  return `${prefix}Também abri um chamado para a equipe da loja acompanhar de perto. Referência: ${ticketRef}.`;
}

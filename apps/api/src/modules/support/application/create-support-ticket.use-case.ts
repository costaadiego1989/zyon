import { Inject, Injectable, Optional } from "@nestjs/common";
import type { SupportTicket } from "@aacp/shared-types";
import { TenantWebhookPublisher } from "../../integrations/application/integrations.use-cases.js";
import { SupportTicketEntity } from "../domain/entities/support-ticket.entity.js";
import {
  SUPPORT_TICKET_REPOSITORY,
  type SupportTicketRepository,
} from "../domain/ports/support-ticket-repository.port.js";

@Injectable()
export class CreateSupportTicketUseCase {
  constructor(
    @Inject(SUPPORT_TICKET_REPOSITORY)
    private readonly repository: SupportTicketRepository,
    @Optional()
    private readonly webhooks?: TenantWebhookPublisher,
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
    await this.publishCreated(ticket);
    return ticket;
  }

  private async publishCreated(ticket: SupportTicket): Promise<void> {
    if (!this.webhooks) return;
    // Bug P2 fix: ticket is already persisted — webhook failure must not break
    // the caller's response. Fire-and-forget; errors are swallowed here.
    this.webhooks.publish({
      merchantId: ticket.merchantId,
      eventType: "support.ticket.created",
      occurredAt: ticket.createdAt,
      data: {
        ticket: {
          id: ticket.id,
          session_id: ticket.sessionId ?? null,
          status: ticket.status,
          source: ticket.source,
        },
      },
    }).catch(() => undefined);
  }
}

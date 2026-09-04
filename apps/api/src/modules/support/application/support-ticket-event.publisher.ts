/**
 * SUPP-M4: Extracted webhook publish logic for support tickets.
 * Deduplicates the fire-and-forget publish from both CreateSupportTicketUseCase
 * and SendSupportMessageUseCase.
 */
import { Injectable, Optional } from "@nestjs/common";
import type { SupportTicket } from "@zyon/shared-types";
import { TenantWebhookPublisher } from "../../integrations/application/integrations.use-cases.js";

@Injectable()
export class SupportTicketEventPublisher {
  constructor(
    @Optional() private readonly webhooks?: TenantWebhookPublisher,
  ) {}

  /**
   * Publishes ticket.created event. Fire-and-forget — errors are swallowed.
   * Ticket is already persisted before this is called.
   */
  publishCreated(ticket: SupportTicket): void {
    if (!this.webhooks) return;
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

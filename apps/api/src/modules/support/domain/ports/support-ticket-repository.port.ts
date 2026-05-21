import type { SupportTicket, SupportTicketStatus } from "@aacp/shared-types";

export const SUPPORT_TICKET_REPOSITORY = "SUPPORT_TICKET_REPOSITORY";

export interface SupportTicketRepository {
  save(ticket: SupportTicket): Promise<SupportTicket>;
  get(merchantId: string, ticketId: string): Promise<SupportTicket | null>;
  list(merchantId: string, status?: SupportTicketStatus): Promise<SupportTicket[]>;
  updateStatus(
    merchantId: string,
    ticketId: string,
    status: SupportTicketStatus
  ): Promise<SupportTicket | null>;
  deleteAll(merchantId: string): Promise<void>;
}

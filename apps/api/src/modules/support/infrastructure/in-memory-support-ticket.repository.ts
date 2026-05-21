import type { SupportTicket, SupportTicketStatus } from "@aacp/shared-types";
import { SupportTicketEntity } from "../domain/entities/support-ticket.entity.js";
import type { SupportTicketRepository } from "../domain/ports/support-ticket-repository.port.js";

export class InMemorySupportTicketRepository implements SupportTicketRepository {
  private readonly store = new Map<string, SupportTicket>();

  async save(ticket: SupportTicket): Promise<SupportTicket> {
    this.store.set(ticketKey(ticket.merchantId, ticket.id), { ...ticket });
    return { ...ticket };
  }

  async get(merchantId: string, ticketId: string): Promise<SupportTicket | null> {
    const ticket = this.store.get(ticketKey(merchantId, ticketId));
    return ticket ? { ...ticket } : null;
  }

  async list(merchantId: string, status?: SupportTicketStatus): Promise<SupportTicket[]> {
    return [...this.store.values()]
      .filter((ticket) => ticket.merchantId === merchantId && (!status || ticket.status === status))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((ticket) => ({ ...ticket }));
  }

  async updateStatus(
    merchantId: string,
    ticketId: string,
    status: SupportTicketStatus
  ): Promise<SupportTicket | null> {
    const existing = await this.get(merchantId, ticketId);
    if (!existing) return null;
    const updated = SupportTicketEntity.rehydrate(existing).updateStatus(status).snapshot();
    return this.save(updated);
  }

  async deleteAll(merchantId: string): Promise<void> {
    for (const key of this.store.keys()) {
      if (key.startsWith(`${merchantId}:`)) this.store.delete(key);
    }
  }
}

function ticketKey(merchantId: string, ticketId: string): string {
  return `${merchantId}:${ticketId}`;
}

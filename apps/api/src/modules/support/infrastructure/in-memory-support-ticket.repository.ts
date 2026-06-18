import type { SupportTicket, SupportTicketStatus } from "@aacp/shared-types";
import { SupportTicketEntity } from "../domain/entities/support-ticket.entity.js";
import type { SupportTicketRepository } from "../domain/ports/support-ticket-repository.port.js";
import { decodeSupportTicketCursor } from "../domain/ports/support-ticket-repository.port.js";

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

  async list(
    merchantId: string,
    status?: SupportTicketStatus,
    limit = 50,
    cursor?: string
  ): Promise<SupportTicket[]> {
    // Decode cursor for keyset pagination
    const cursorParsed = cursor ? decodeSupportTicketCursor(cursor) : null;

    const all = [...this.store.values()]
      .filter((ticket) => ticket.merchantId === merchantId && (!status || ticket.status === status))
      .sort((a, b) => {
        // DESC by createdAt, then DESC by id for stable ordering
        const diff = b.createdAt.localeCompare(a.createdAt);
        return diff !== 0 ? diff : b.id.localeCompare(a.id);
      });

    // Apply cursor: skip rows at-or-before the cursor position
    let filtered = all;
    if (cursorParsed) {
      const idx = all.findIndex(
        (t) =>
          t.createdAt < cursorParsed.createdAt ||
          (t.createdAt === cursorParsed.createdAt && t.id <= cursorParsed.id)
      );
      filtered = idx === -1 ? [] : all.slice(idx);
    }

    // Return limit+1 rows so the caller can detect has_more
    return filtered.slice(0, limit + 1).map((ticket) => ({ ...ticket }));
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

import type { SupportTicket, SupportTicketStatus } from "@aacp/shared-types";

export const SUPPORT_TICKET_REPOSITORY = "SUPPORT_TICKET_REPOSITORY";

export interface SupportTicketRepository {
  save(ticket: SupportTicket): Promise<SupportTicket>;
  get(merchantId: string, ticketId: string): Promise<SupportTicket | null>;
  /**
   * P2 fix: real keyset pagination.
   * @param limit  Max rows to return (default 50). Implementation fetches limit+1
   *               to detect whether there is a next page.
   * @param cursor Opaque cursor ("createdAt|id") from previous page response.
   */
  list(
    merchantId: string,
    status?: SupportTicketStatus,
    limit?: number,
    cursor?: string
  ): Promise<SupportTicket[]>;
  updateStatus(
    merchantId: string,
    ticketId: string,
    status: SupportTicketStatus
  ): Promise<SupportTicket | null>;
  deleteAll(merchantId: string): Promise<void>;
}

/** Encode/decode a keyset cursor for support tickets. */
export function encodeSupportTicketCursor(createdAt: string, id: string): string {
  return Buffer.from(`${createdAt}|${id}`, "utf8").toString("base64url");
}

export function decodeSupportTicketCursor(cursor: string): { createdAt: string; id: string } | null {
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    const sep = raw.lastIndexOf("|");
    if (sep === -1) return null;
    return { createdAt: raw.slice(0, sep), id: raw.slice(sep + 1) };
  } catch {
    return null;
  }
}

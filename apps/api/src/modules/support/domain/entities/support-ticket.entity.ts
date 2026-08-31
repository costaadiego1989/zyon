import { randomUUID } from "node:crypto";
import type { SupportTicket, SupportTicketStatus } from "@zyon/shared-types";

const SUPPORT_TICKET_STATUSES = new Set<SupportTicketStatus>([
  "open",
  "in_progress",
  "resolved",
  "closed"
]);

interface CreateSupportTicketInput {
  merchantId: string;
  sessionId?: string;
  buyerMessage: string;
  source?: SupportTicket["source"];
  returnId?: string;
}

export class SupportTicketEntity {
  private constructor(private readonly props: SupportTicket) {}

  static create(input: CreateSupportTicketInput): SupportTicketEntity {
    const merchantId = input.merchantId.trim();
    const buyerMessage = input.buyerMessage.trim();
    if (!merchantId) throw new Error("support_ticket_merchant_required");
    if (!buyerMessage) throw new Error("support_ticket_message_required");
    const now = new Date().toISOString();
    return new SupportTicketEntity({
      id: `sup_${randomUUID()}`,
      merchantId,
      sessionId: input.sessionId?.trim() || undefined,
      buyerMessage,
      status: "open",
      source: input.source ?? "widget",
      returnId: input.returnId?.trim() || undefined,
      createdAt: now,
      updatedAt: now
    });
  }

  static rehydrate(data: SupportTicket): SupportTicketEntity {
    if (!isSupportTicketStatus(data.status)) throw new Error("support_ticket_invalid_status");
    return new SupportTicketEntity({ ...data });
  }

  updateStatus(status: SupportTicketStatus): SupportTicketEntity {
    if (!isSupportTicketStatus(status)) throw new Error("support_ticket_invalid_status");
    const now = new Date().toISOString();
    return new SupportTicketEntity({
      ...this.props,
      status,
      updatedAt: now,
      resolvedAt: status === "resolved" || status === "closed" ? now : undefined
    });
  }

  snapshot(): SupportTicket {
    return { ...this.props };
  }
}

export function isSupportTicketStatus(value: unknown): value is SupportTicketStatus {
  return typeof value === "string" && SUPPORT_TICKET_STATUSES.has(value as SupportTicketStatus);
}

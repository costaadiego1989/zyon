import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import type { SupportTicket, SupportTicketStatus } from "@aacp/shared-types";
import { SupportTicketEntity } from "../domain/entities/support-ticket.entity.js";
import type { SupportTicketRepository } from "../domain/ports/support-ticket-repository.port.js";
import { decodeSupportTicketCursor } from "../domain/ports/support-ticket-repository.port.js";

type SupportTicketRow = {
  id: string;
  merchant_id: string;
  session_id: string | null;
  buyer_message: string;
  status: string;
  source: string;
  created_at: Date;
  updated_at: Date;
  resolved_at: Date | null;
};

export class PrismaSupportTicketRepository implements SupportTicketRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async save(ticket: SupportTicket): Promise<SupportTicket> {
    await this.prisma.$executeRaw`
      INSERT INTO "support_tickets" (
        "id",
        "merchant_id",
        "session_id",
        "buyer_message",
        "status",
        "source",
        "created_at",
        "updated_at",
        "resolved_at"
      )
      VALUES (
        ${ticket.id},
        ${ticket.merchantId},
        ${ticket.sessionId ?? null},
        ${ticket.buyerMessage},
        ${ticket.status},
        ${ticket.source},
        ${new Date(ticket.createdAt)},
        ${new Date(ticket.updatedAt)},
        ${ticket.resolvedAt ? new Date(ticket.resolvedAt) : null}
      )
      ON CONFLICT ("id") DO UPDATE SET
        "session_id" = EXCLUDED."session_id",
        "buyer_message" = EXCLUDED."buyer_message",
        "status" = EXCLUDED."status",
        "source" = EXCLUDED."source",
        "updated_at" = EXCLUDED."updated_at",
        "resolved_at" = EXCLUDED."resolved_at"
    `;
    const saved = await this.get(ticket.merchantId, ticket.id);
    if (!saved) throw new Error("support_ticket_save_failed");
    return saved;
  }

  async get(merchantId: string, ticketId: string): Promise<SupportTicket | null> {
    const rows = await this.prisma.$queryRaw<SupportTicketRow[]>`
      SELECT
        "id",
        "merchant_id",
        "session_id",
        "buyer_message",
        "status",
        "source",
        "created_at",
        "updated_at",
        "resolved_at"
      FROM "support_tickets"
      WHERE "merchant_id" = ${merchantId}
        AND "id" = ${ticketId}
      LIMIT 1
    `;
    return rows[0] ? mapTicket(rows[0]) : null;
  }

  async list(
    merchantId: string,
    status?: SupportTicketStatus,
    limit = 50,
    cursor?: string
  ): Promise<SupportTicket[]> {
    // P2 fix: real keyset pagination on (created_at DESC, id DESC).
    // Fetches limit+1 rows so the caller can detect has_more.
    const effectiveLimit = limit + 1;
    const cursorParsed = cursor ? decodeSupportTicketCursor(cursor) : null;

    const statusClause = status
      ? Prisma.sql`AND "status" = ${status}`
      : Prisma.sql``;

    const cursorClause = cursorParsed
      ? Prisma.sql`AND (
          "created_at" < ${new Date(cursorParsed.createdAt)}
          OR ("created_at" = ${new Date(cursorParsed.createdAt)} AND "id" < ${cursorParsed.id})
        )`
      : Prisma.sql``;

    const rows = await this.prisma.$queryRaw<SupportTicketRow[]>(Prisma.sql`
      SELECT
        "id",
        "merchant_id",
        "session_id",
        "buyer_message",
        "status",
        "source",
        "created_at",
        "updated_at",
        "resolved_at"
      FROM "support_tickets"
      WHERE "merchant_id" = ${merchantId}
      ${statusClause}
      ${cursorClause}
      ORDER BY "created_at" DESC, "id" DESC
      LIMIT ${effectiveLimit}
    `);
    return rows.map(mapTicket);
  }

  async updateStatus(
    merchantId: string,
    ticketId: string,
    status: SupportTicketStatus
  ): Promise<SupportTicket | null> {
    const existing = await this.get(merchantId, ticketId);
    if (!existing) return null;
    return this.save(SupportTicketEntity.rehydrate(existing).updateStatus(status).snapshot());
  }

  async deleteAll(merchantId: string): Promise<void> {
    await this.prisma.$executeRaw`
      DELETE FROM "support_tickets"
      WHERE "merchant_id" = ${merchantId}
    `;
  }
}

function mapTicket(row: SupportTicketRow): SupportTicket {
  return {
    id: row.id,
    merchantId: row.merchant_id,
    sessionId: row.session_id ?? undefined,
    buyerMessage: row.buyer_message,
    status: row.status as SupportTicketStatus,
    source: row.source as SupportTicket["source"],
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    resolvedAt: row.resolved_at?.toISOString()
  };
}

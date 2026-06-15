import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import type {
  AuditRepository,
  MerchantAuditEvent,
} from "../domain/ports/audit-repository.port.js";

export class PrismaAuditRepository implements AuditRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async record(
    event: Omit<MerchantAuditEvent, "id" | "occurredAt">,
  ): Promise<MerchantAuditEvent> {
    const row = await this.prisma.merchantAuditEvent.create({
      data: {
        merchantId: event.merchantId,
        actorType: event.actorType,
        actorId: event.actorId,
        action: event.action,
        resourceType: event.resourceType,
        resourceId: event.resourceId,
        correlationId: event.correlationId,
        metadata: event.metadata as Prisma.InputJsonValue,
      },
    });
    return toAuditEvent(row);
  }

  async list(input: {
    merchantId: string;
    limit: number;
    cursor?: { occurredAt: string; id: string };
  }): Promise<MerchantAuditEvent[]> {
    const cursorAt = input.cursor
      ? new Date(input.cursor.occurredAt)
      : undefined;
    const rows = await this.prisma.merchantAuditEvent.findMany({
      where: {
        merchantId: input.merchantId,
        ...(cursorAt && input.cursor
          ? {
              OR: [
                { occurredAt: { lt: cursorAt } },
                {
                  occurredAt: cursorAt,
                  id: { lt: input.cursor.id },
                },
              ],
            }
          : {}),
      },
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      take: input.limit,
    });
    return rows.map(toAuditEvent);
  }
}

function toAuditEvent(row: {
  id: string;
  merchantId: string;
  actorType: string;
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  correlationId: string | null;
  metadata: unknown;
  occurredAt: Date;
}): MerchantAuditEvent {
  return {
    id: row.id,
    merchantId: row.merchantId,
    actorType: row.actorType as MerchantAuditEvent["actorType"],
    actorId: row.actorId,
    action: row.action,
    resourceType: row.resourceType,
    resourceId: row.resourceId ?? undefined,
    correlationId: row.correlationId ?? undefined,
    metadata:
      row.metadata && typeof row.metadata === "object"
        ? (row.metadata as Record<string, unknown>)
        : {},
    occurredAt: row.occurredAt.toISOString(),
  };
}

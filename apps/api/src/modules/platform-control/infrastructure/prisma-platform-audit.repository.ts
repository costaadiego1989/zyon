import { Inject, Injectable } from "@nestjs/common";
import { Prisma, type PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";
import type { PlatformAuditEvent } from "../domain/platform-audit.js";
import type {
  PlatformAuditPage,
  PlatformAuditQuery,
  PlatformAuditReadAudit,
  PlatformAuditRepository,
} from "../domain/ports/platform-audit-repository.port.js";

@Injectable()
export class PrismaPlatformAuditRepository implements PlatformAuditRepository {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async list(input: PlatformAuditQuery): Promise<PlatformAuditPage> {
    const rows = await this.prisma.platformAuditEvent.findMany({
      where: auditWhere(input),
      select: {
        id: true,
        actorOperatorId: true,
        action: true,
        permission: true,
        environment: true,
        targetType: true,
        targetId: true,
        correlationId: true,
        outcome: true,
        details: true,
        createdAt: true,
        actor: { select: { email: true, role: true } },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.limit + 1,
    });
    const hasMore = rows.length > input.limit;
    const page = hasMore ? rows.slice(0, input.limit) : rows;
    const last = page.at(-1);
    return {
      items: page.map(toPlatformAuditEvent),
      ...(hasMore && last ? { nextCursor: { occurredAt: last.createdAt, id: last.id } } : {}),
    };
  }

  async recordRead(input: PlatformAuditReadAudit): Promise<void> {
    await this.prisma.platformAuditEvent.create({
      data: {
        actorOperatorId: input.actorOperatorId,
        action: "platform.audit.read",
        permission: "platform:audit:read",
        environment: input.environment,
        targetType: "platform_audit_events",
        correlationId: input.correlationId,
        outcome: "succeeded",
        details: {
          source: "platform_audit_events",
          returnedItems: input.returnedItems,
          limit: input.limit,
          actionFilterApplied: input.actionFilterApplied,
          actorFilterApplied: input.actorFilterApplied,
          dateRangeApplied: input.dateRangeApplied,
          cursorApplied: input.cursorApplied,
        },
      },
    });
  }
}

function auditWhere(input: PlatformAuditQuery): Prisma.PlatformAuditEventWhereInput {
  return {
    ...(input.action ? { action: input.action } : {}),
    ...(input.actorOperatorId ? { actorOperatorId: input.actorOperatorId } : {}),
    ...(input.from && input.to ? { createdAt: { gte: input.from, lt: input.to } } : {}),
    ...(input.cursor ? {
      OR: [
        { createdAt: { lt: input.cursor.occurredAt } },
        { createdAt: input.cursor.occurredAt, id: { lt: input.cursor.id } },
      ],
    } : {}),
  };
}

type PlatformAuditRow = Prisma.PlatformAuditEventGetPayload<{
  select: {
    id: true;
    actorOperatorId: true;
    action: true;
    permission: true;
    environment: true;
    targetType: true;
    targetId: true;
    correlationId: true;
    outcome: true;
    details: true;
    createdAt: true;
    actor: { select: { email: true; role: true } };
  };
}>;

function toPlatformAuditEvent(row: PlatformAuditRow): PlatformAuditEvent {
  return {
    id: row.id,
    ...(row.actorOperatorId ? { actorOperatorId: row.actorOperatorId } : {}),
    action: row.action,
    permission: row.permission,
    environment: row.environment,
    targetType: row.targetType,
    ...(row.targetId ? { targetId: row.targetId } : {}),
    correlationId: row.correlationId,
    outcome: row.outcome,
    ...(row.details ? { details: row.details } : {}),
    occurredAt: row.createdAt,
    ...(row.actor ? { actor: row.actor } : {}),
  };
}

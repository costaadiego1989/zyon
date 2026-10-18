import { Inject, Injectable } from "@nestjs/common";
import { Prisma, type PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";
import {
  decidePlatformOperatorAccessChange,
  type PlatformOperatorAccessCommand,
} from "../../platform-control/domain/platform-operator-access.js";
import {
  isPlatformOperatorRole,
  PLATFORM_OPERATOR_ROLES,
  type PlatformOperatorRole,
} from "../../platform-control/domain/platform-operator.js";
import type {
  PlatformOperatorDirectoryEntry,
  PlatformOperatorDirectoryPage,
  PlatformOperatorDirectoryQuery,
  PlatformOperatorDirectoryReadAudit,
  PlatformOperatorDirectoryRepository,
} from "../domain/ports/platform-operator-directory-repository.port.js";

@Injectable()
export class PrismaPlatformOperatorDirectoryRepository implements PlatformOperatorDirectoryRepository {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async list(input: PlatformOperatorDirectoryQuery): Promise<PlatformOperatorDirectoryPage> {
    const where = operatorWhere(input);
    if (input.cursor) await this.assertMatchingCursor(input.cursor, where);

    const [rows, active, disabled] = await Promise.all([
      this.prisma.platformOperator.findMany({
        where,
        select: {
          id: true,
          email: true,
          role: true,
          disabledAt: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
        take: input.limit + 1,
      }),
      this.prisma.platformOperator.count({ where: { role: { in: [...PLATFORM_OPERATOR_ROLES] }, disabledAt: null } }),
      this.prisma.platformOperator.count({ where: { role: { in: [...PLATFORM_OPERATOR_ROLES] }, disabledAt: { not: null } } }),
    ]);

    const hasMore = rows.length > input.limit;
    const page = hasMore ? rows.slice(0, input.limit) : rows;
    return {
      items: page.map(toEntry),
      summary: {
        total: active + disabled,
        active,
        disabled,
      },
      ...(hasMore ? { nextCursor: page[page.length - 1]?.id } : {}),
    };
  }

  async recordRead(input: PlatformOperatorDirectoryReadAudit): Promise<void> {
    await this.prisma.platformAuditEvent.create({
      data: {
        actorOperatorId: input.actorOperatorId,
        action: "platform.operator_directory.read",
        permission: "platform:operators:read",
        environment: input.environment,
        targetType: "platform_operator_directory",
        correlationId: input.correlationId,
        outcome: "succeeded",
        details: {
          returnedItems: input.returnedItems,
          totalRecords: input.totalOperators,
          limit: input.limit,
          searchApplied: input.searchApplied,
          roleFilterApplied: input.roleFilterApplied,
          statusFilterApplied: input.statusFilterApplied,
        },
      },
    });
  }

  async executeAccessCommand(input: PlatformOperatorAccessCommand): Promise<PlatformOperatorDirectoryEntry> {
    return this.prisma.$transaction(async tx => {
      const ids = [...new Set([input.actorOperatorId, input.targetOperatorId])].sort();
      await tx.$queryRaw(Prisma.sql`
        SELECT id FROM platform_operators WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE
      `);
      const operators = await tx.platformOperator.findMany({ where: { id: { in: ids } } });
      const actor = operators.find(operator => operator.id === input.actorOperatorId);
      const target = operators.find(operator => operator.id === input.targetOperatorId);
      if (!target) throw new Error("platform_operator_not_found");
      if (!actor || !isPlatformOperatorRole(actor.role)) throw new Error("platform_operator_actor_no_longer_admin");
      if (!isPlatformOperatorRole(target.role)) throw new Error("platform_operator_not_found");

      const activePlatformAdminCount = await tx.platformOperator.count({
        where: { role: "platform_admin", disabledAt: null },
      });
      const now = new Date();
      const decision = decidePlatformOperatorAccessChange({
        actor: toAccessSnapshot(actor),
        target: toAccessSnapshot(target),
        command: input,
        activePlatformAdminCount,
        now,
      });
      const updated = await tx.platformOperator.update({
        where: { id: target.id },
        data: {
          authVersion: { increment: 1 },
          ...(decision.changes.role ? { role: decision.changes.role } : {}),
          ...(decision.changes.disabledAt !== undefined ? { disabledAt: decision.changes.disabledAt } : {}),
        },
        select: {
          id: true,
          email: true,
          role: true,
          disabledAt: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      await tx.platformAuthSession.updateMany({
        where: { operatorId: target.id, revokedAt: null },
        data: { revokedAt: now },
      });
      await tx.platformAuditEvent.create({
        data: {
          actorOperatorId: input.actorOperatorId,
          action: decision.action,
          permission: "platform:operators:write",
          environment: input.environment,
          targetType: "platform_operator",
          targetId: target.id,
          correlationId: input.correlationId,
          outcome: "succeeded",
          details: decision.details,
        },
      });
      return toEntry(updated);
    });
  }

  private async assertMatchingCursor(cursor: string, where: Prisma.PlatformOperatorWhereInput): Promise<void> {
    const match = await this.prisma.platformOperator.findFirst({
      where: { AND: [where, { id: cursor }] },
      select: { id: true },
    });
    if (!match) throw new Error("platform_operators_invalid_cursor");
  }
}

function operatorWhere(input: PlatformOperatorDirectoryQuery): Prisma.PlatformOperatorWhereInput {
  const clauses: Prisma.PlatformOperatorWhereInput[] = [{
    role: input.role ?? { in: [...PLATFORM_OPERATOR_ROLES] },
  }];
  if (input.status === "active") clauses.push({ disabledAt: null });
  if (input.status === "disabled") clauses.push({ disabledAt: { not: null } });
  if (input.query) clauses.push({ email: { contains: input.query, mode: "insensitive" } });
  return { AND: clauses };
}

function toAccessSnapshot(row: { id: string; role: string; disabledAt: Date | null }) {
  return {
    id: row.id,
    role: row.role as PlatformOperatorRole,
    ...(row.disabledAt ? { disabledAt: row.disabledAt } : {}),
  };
}

function toEntry(row: {
  id: string;
  email: string;
  role: string;
  disabledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): PlatformOperatorDirectoryEntry {
  return {
    id: row.id,
    email: row.email,
    role: row.role as PlatformOperatorRole,
    ...(row.disabledAt ? { disabledAt: row.disabledAt } : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

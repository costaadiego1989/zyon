import { Injectable } from "@nestjs/common";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { PlatformOperator, PlatformPrincipal } from "../domain/platform-operator.js";
import type {
  PlatformOperatorRepository,
  PlatformSessionRecord,
} from "../domain/ports/platform-operator-repository.port.js";

@Injectable()
export class PrismaPlatformOperatorRepository implements PlatformOperatorRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByEmail(email: string): Promise<PlatformOperator | undefined> {
    const row = await this.prisma.platformOperator.findUnique({ where: { email } });
    if (!row) return undefined;
    return operatorFromRow(row);
  }

  async createSession(input: PlatformSessionRecord): Promise<boolean> {
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM platform_operators WHERE id = ${input.operatorId} FOR UPDATE`);
      const operator = await tx.platformOperator.findUnique({ where: { id: input.operatorId } });
      if (!operator || operator.disabledAt || operator.authVersion !== input.authVersion || !samePrincipal(operator, input)) return false;
      await tx.platformAuthSession.create({ data: sessionData(input) });
      return true;
    });
  }

  async findActiveSession(id: string, now: Date): Promise<PlatformSessionRecord | undefined> {
    const row = await this.prisma.platformAuthSession.findUnique({ where: { id }, include: { operator: true } });
    if (!row || row.consumedAt || row.revokedAt || row.refreshExpiresAt <= now || row.operator.disabledAt ||
      row.authVersion !== row.operator.authVersion) return undefined;
    return sessionFromRow(row);
  }

  async rotateSession(id: string, replacement: PlatformSessionRecord, now: Date): Promise<boolean> {
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM platform_operators WHERE id = ${replacement.operatorId} FOR UPDATE`);
      const operator = await tx.platformOperator.findUnique({ where: { id: replacement.operatorId } });
      if (!operator || operator.disabledAt || operator.authVersion !== replacement.authVersion || !samePrincipal(operator, replacement)) return false;
      const claimed = await tx.platformAuthSession.updateMany({
        where: {
          id,
          operatorId: replacement.operatorId,
          consumedAt: null,
          revokedAt: null,
          authVersion: operator.authVersion,
          refreshExpiresAt: { gt: now },
        },
        data: { consumedAt: now },
      });
      if (claimed.count !== 1) return false;
      await tx.platformAuthSession.create({ data: sessionData(replacement) });
      return true;
    });
  }

  async revokeSessionFamily(id: string, now: Date): Promise<void> {
    await this.prisma.$transaction(async tx => {
      const session = await tx.platformAuthSession.findUnique({ where: { id }, select: { familyId: true, operatorId: true } });
      if (!session) return;
      await tx.platformAuthSession.updateMany({
        where: { familyId: session.familyId, operatorId: session.operatorId, revokedAt: null },
        data: { revokedAt: now },
      });
    });
  }
}

function operatorFromRow(row: {
  id: string;
  email: string;
  passwordHash: string | null;
  role: string;
  authVersion: number;
  disabledAt: Date | null;
}): PlatformOperator {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.passwordHash ?? undefined,
    role: row.role as PlatformOperator["role"],
    authVersion: row.authVersion,
    disabledAt: row.disabledAt ?? undefined,
  };
}

function sessionFromRow(row: {
  id: string;
  familyId: string;
  operatorId: string;
  authVersion: number;
  refreshExpiresAt: Date;
  operator: { email: string; role: string };
}): PlatformSessionRecord {
  return {
    id: row.id,
    familyId: row.familyId,
    operatorId: row.operatorId,
    email: row.operator.email,
    role: row.operator.role as PlatformPrincipal["role"],
    authVersion: row.authVersion,
    refreshExpiresAt: row.refreshExpiresAt,
  };
}

function sessionData(input: PlatformSessionRecord) {
  return {
    id: input.id,
    familyId: input.familyId,
    operatorId: input.operatorId,
    authVersion: input.authVersion,
    refreshExpiresAt: input.refreshExpiresAt,
  };
}

function samePrincipal(
  operator: { email: string; role: string },
  principal: PlatformPrincipal,
): boolean {
  return operator.email === principal.email && operator.role === principal.role;
}

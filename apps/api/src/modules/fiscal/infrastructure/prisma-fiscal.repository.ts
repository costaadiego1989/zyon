import { Prisma, type PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type { FiscalActor, FiscalClaimPatch, FiscalEventInput, FiscalIntentInput, FiscalListQuery,
  FiscalRepositoryPort, FiscalTenant } from "../domain/fiscal-repository.port.js";

export class PrismaFiscalRepository implements FiscalRepositoryPort {
  constructor(private readonly db: PrismaClient | Prisma.TransactionClient) {}

  async transaction<T>(work: (repository: PrismaFiscalRepository) => Promise<T>): Promise<T> {
    if (!("$transaction" in this.db)) return work(this);
    return this.db.$transaction(tx => work(new PrismaFiscalRepository(tx)));
  }

  async createIntent(input: FiscalIntentInput, actor: FiscalActor) {
    return this.transaction(async repo => {
      const created = await repo.db.fiscalIntent.createMany({ data: input, skipDuplicates: true });
      const intent = await repo.db.fiscalIntent.findFirstOrThrow({ where: { merchantId: input.merchantId,
        environment: input.environment, orderId: input.orderId, operation: input.operation } });
      if (created.count) await repo.db.fiscalEvent.create({ data: { merchantId: input.merchantId, environment: input.environment,
        intentId: intent.id, ...actor, action: "created", nextState: input.state } });
      return intent;
    });
  }

  findIntent(scope: FiscalTenant, id: string) {
    return this.db.fiscalIntent.findFirst({ where: { ...scope, id } });
  }

  async claim(scope: FiscalTenant, now: Date, leaseMs: number, intentId?: string) {
    if (!Number.isSafeInteger(leaseMs) || leaseMs < 1 || leaseMs > 600000) throw new Error("fiscal_lease_invalid");
    return this.transaction(async repo => {
      const rows = await repo.db.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT id FROM fiscal_intents
        WHERE merchant_id = ${scope.merchantId} AND environment = ${scope.environment}::"FiscalEnvironment"
          AND (${intentId ?? null}::text IS NULL OR id = ${intentId ?? null})
          AND state IN ('queued', 'processing', 'reconciliation_required') AND next_attempt_at <= ${now}
          AND (lease_until IS NULL OR lease_until <= ${now})
        ORDER BY next_attempt_at, created_at, id FOR UPDATE SKIP LOCKED LIMIT 1`);
      if (!rows[0]) return null;
      const intent = await repo.db.fiscalIntent.findFirstOrThrow({ where: { ...scope, id: rows[0].id } });
      return repo.db.fiscalIntent.update({ where: { id: intent.id }, data: {
        leaseToken: randomUUID(), leasePurpose: "issuance", leaseUntil: new Date(now.getTime() + leaseMs), version: { increment: 1 }, attempts: { increment: 1 },
        state: intent.writeStartedAt ? "reconciliation_required" : intent.state,
      } });
    });
  }

  /** Terminal fiscal status stays unchanged while original documents/stock are recovered. */
  async claimRecovery(scope: FiscalTenant, now: Date, leaseMs: number, intentId?: string) {
    if (!Number.isSafeInteger(leaseMs) || leaseMs < 1 || leaseMs > 600000) throw new Error("fiscal_lease_invalid");
    return this.transaction(async repo => {
      const rows = await repo.db.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT id FROM fiscal_intents WHERE merchant_id = ${scope.merchantId} AND environment = ${scope.environment}::"FiscalEnvironment"
          AND (${intentId ?? null}::text IS NULL OR id = ${intentId ?? null})
          AND state IN ('authorized','cancelled') AND next_attempt_at <= ${now} AND (lease_until IS NULL OR lease_until <= ${now})
        ORDER BY next_attempt_at, created_at, id FOR UPDATE SKIP LOCKED LIMIT 1`);
      if (!rows[0]) return null;
      return repo.db.fiscalIntent.update({ where: { id: rows[0].id }, data: { leaseToken: randomUUID(), leasePurpose: "query", leaseUntil: new Date(now.getTime() + leaseMs), attempts: { increment: 1 } } });
    });
  }

  async updateClaim(scope: FiscalTenant, id: string, token: string, version: number, now: Date, patch: FiscalClaimPatch, event: FiscalEventInput) {
    return this.transaction(async repo => {
      const updated = await repo.db.fiscalIntent.updateMany({ where: { ...scope, id, leaseToken: token, version, leaseUntil: { gt: now } },
        data: { ...patch, version: { increment: 1 } } });
      if (!updated.count) return false;
      await repo.db.fiscalEvent.create({ data: { ...scope, intentId: id, ...event } });
      return true;
    });
  }

  async history(scope: FiscalTenant, id: string) {
    const events = await this.db.fiscalEvent.findMany({ where: { ...scope, intentId: id }, orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
      include: { intent: { select: { orderId: true, connection: { select: { provider: true } } } } } });
    return events.map(({ intent, ...event }) => ({ ...event, orderId: intent.orderId, provider: intent.connection.provider }));
  }

  async list(scope: FiscalTenant, query: FiscalListQuery) {
    const page = query.page ?? 1, pageSize = query.pageSize ?? 25;
    if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100
      || (query.search?.length ?? 0) > 120) throw new Error("fiscal_list_invalid");
    const where: Prisma.FiscalIntentWhereInput = { ...scope, ...(query.state ? { state: query.state } : {}),
      ...(query.search?.trim() ? { OR: [{ orderId: { contains: query.search.trim(), mode: "insensitive" } },
        { stableReference: { contains: query.search.trim(), mode: "insensitive" } },
        { snapshot: { recipient: { path: ["name"], string_contains: query.search.trim(), mode: "insensitive" } } }] } : {}) };
    return this.transaction(async repo => {
      const total = await repo.db.fiscalIntent.count({ where });
      const grouped = await repo.db.fiscalIntent.groupBy({ by: ["state"], where, _count: { _all: true } });
      const rows = await repo.db.fiscalIntent.findMany({ where, skip: (page - 1) * pageSize, take: pageSize,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true, orderId: true, state: true,
          connection: { select: { provider: true } }, snapshot: { select: { recipient: true } },
          document: { select: { deliveries: { select: { channel: true, state: true } } } } } });
      return { items: rows.map(row => ({ id: row.id, orderId: row.orderId, state: row.state, provider: row.connection.provider,
        recipientName: String((row.snapshot.recipient as Record<string, unknown>).name ?? ""), deliveries: row.document?.deliveries ?? [] })),
      total, counts: Object.fromEntries(grouped.map(row => [row.state, row._count._all])), page, pageSize };
    });
  }
}

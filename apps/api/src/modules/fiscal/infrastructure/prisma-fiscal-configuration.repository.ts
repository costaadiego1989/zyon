import { Prisma, type PrismaClient } from "@prisma/client";
import type { FiscalActor, FiscalTenant } from "../domain/fiscal-repository.port.js";
import type { FiscalConfigurationStore, FiscalConnectionCreate } from "../domain/fiscal-configuration.port.js";
import type { FiscalReadinessCheck } from "../domain/fiscal-provider.js";

export class PrismaFiscalConfigurationRepository implements FiscalConfigurationStore {
  constructor(private readonly db: PrismaClient) {}
  private async audit(tx: Prisma.TransactionClient, merchantId: string, id: string, provider: string, environment: string, actor: FiscalActor, action: string, result: string) {
    await tx.merchantAuditEvent.create({ data: { merchantId, actorType: actor.actorKind, actorId: actor.actorId!, action,
      resourceType: "fiscal_connection", resourceId: id, metadata: { provider, environment, result } } });
  }
  create(input: FiscalConnectionCreate, actor: FiscalActor) {
    return this.db.$transaction(async tx => {
      if (input.provider === "bling") {
        const erp = input.erpConnectionId && await tx.erpConnection.findFirst({ where: { id: input.erpConnectionId, merchantId: input.merchantId, provider: "bling" } });
        if (!erp) throw new Error("fiscal_erp_connection_required");
      }
      const value = await tx.fiscalConnection.create({ data: input });
      await this.audit(tx, value.merchantId, value.id, value.provider, value.environment, actor, "fiscal.connect", "pending");
      return value;
    });
  }
  latest(scope: FiscalTenant) { return this.db.fiscalConnection.findFirst({ where: scope, orderBy: [{ createdAt: "desc" }, { id: "desc" }] }); }
  reconnect(scope: FiscalTenant, id: string, credentialCipher: string | undefined, actor: FiscalActor) {
    return this.db.$transaction(async tx => {
      const value = await tx.fiscalConnection.findFirst({ where: { ...scope, id } }); if (!value) throw new Error("fiscal_connection_not_found");
      const restored = await tx.fiscalConnection.update({ where: { id }, data: { disconnectedAt: null, readiness: [], ...(credentialCipher ? { credentialCipher } : {}) } });
      await this.audit(tx, value.merchantId, id, value.provider, value.environment, actor, "fiscal.reconnect", "inspection_required"); return restored;
    });
  }
  find(scope: FiscalTenant, id: string) { return this.db.fiscalConnection.findFirst({ where: { ...scope, id } }); }
  active(scope: FiscalTenant) { return this.db.fiscalConnection.findFirst({ where: { ...scope, isActive: true, disconnectedAt: null } }); }
  async recordReadiness(scope: FiscalTenant, id: string, checks: readonly FiscalReadinessCheck[]) {
    const result = await this.db.fiscalConnection.updateMany({ where: { ...scope, id, disconnectedAt: null }, data: { readiness: checks as unknown as Prisma.InputJsonValue } });
    if (!result.count) throw new Error("fiscal_connection_not_found");
    return this.db.fiscalConnection.findFirstOrThrow({ where: { ...scope, id } });
  }
  activate(scope: FiscalTenant, id: string, checks: readonly FiscalReadinessCheck[], actor: FiscalActor) {
    return this.db.$transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM fiscal_connections WHERE id = ${id} AND merchant_id = ${scope.merchantId} AND environment = ${scope.environment}::"FiscalEnvironment" FOR UPDATE`);
      const value = await tx.fiscalConnection.findFirstOrThrow({ where: { ...scope, id, disconnectedAt: null } });
      if (value.isActive) return value;
      const active = await tx.fiscalConnection.update({ where: { id: value.id }, data: { isActive: true, activatedAt: value.activatedAt ?? new Date(), readiness: checks as unknown as Prisma.InputJsonValue } });
      await this.audit(tx, value.merchantId, id, value.provider, value.environment, actor, "fiscal.activate", "active");
      return active;
    });
  }
  disconnect(scope: FiscalTenant, id: string, actor: FiscalActor) {
    return this.db.$transaction(async tx => {
      const value = await tx.fiscalConnection.findFirstOrThrow({ where: { ...scope, id } });
      if (value.disconnectedAt) return value;
      const updated = await tx.fiscalConnection.update({ where: { id: value.id }, data: { isActive: false, disconnectedAt: new Date() } });
      await this.audit(tx, value.merchantId, id, value.provider, value.environment, actor, "fiscal.disconnect", "disconnected");
      return updated;
    });
  }
}

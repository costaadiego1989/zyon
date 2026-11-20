import { Prisma, type PrismaClient } from "@prisma/client";
import type { FiscalActor, FiscalTenant } from "../domain/fiscal-repository.port.js";
import type { FiscalProfileDraft, FiscalProfileStore } from "../domain/fiscal-profile.port.js";
import type { FiscalProvider } from "../domain/fiscal-provider.js";

export class PrismaFiscalProfileRepository implements FiscalProfileStore {
  constructor(private readonly db: PrismaClient | Prisma.TransactionClient) {}
  private transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return "$transaction" in this.db ? this.db.$transaction(work) : work(this.db);
  }
  createVersion(input: FiscalProfileDraft, actor: FiscalActor) {
    return this.transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM merchants WHERE id = ${input.merchantId} FOR UPDATE`);
      const previous = await tx.fiscalProfileVersion.findFirst({ where: { merchantId: input.merchantId, environment: input.environment,
        provider: input.provider, operation: input.operation }, orderBy: { version: "desc" } });
      const profile = await tx.fiscalProfileVersion.create({ data: { ...input, version: (previous?.version ?? 0) + 1,
        itemRules: input.itemRules as Prisma.InputJsonValue, recipientRequirements: input.recipientRequirements as Prisma.InputJsonValue } });
      await tx.merchantAuditEvent.create({ data: { merchantId: input.merchantId, actorType: actor.actorKind, actorId: actor.actorId!,
        action: "fiscal.profile_draft", resourceType: "fiscal_profile", resourceId: profile.id,
        metadata: { provider: input.provider, environment: input.environment, version: profile.version, result: "unconfirmed" } } });
      return profile;
    });
  }
  find(scope: FiscalTenant, id: string) { return this.db.fiscalProfileVersion.findFirst({ where: { ...scope, id } }); }
  latest(scope: FiscalTenant, provider: FiscalProvider, operation: string) {
    return this.db.fiscalProfileVersion.findFirst({ where: { ...scope, provider, operation }, orderBy: { version: "desc" } });
  }
  latestConfirmed(scope: FiscalTenant, provider: FiscalProvider, operation: string) {
    return this.db.fiscalProfileVersion.findFirst({ where: { ...scope, provider, operation, confirmedAt: { not: null }, confirmedBy: { not: null } }, orderBy: { version: "desc" } });
  }
  confirm(scope: FiscalTenant, id: string, actor: FiscalActor) {
    return this.transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM fiscal_profile_versions WHERE id = ${id} AND merchant_id = ${scope.merchantId} AND environment = ${scope.environment}::"FiscalEnvironment" FOR UPDATE`);
      const profile = await tx.fiscalProfileVersion.findFirstOrThrow({ where: { ...scope, id } });
      if (profile.confirmedAt) return profile;
      const confirmed = await tx.fiscalProfileVersion.update({ where: { id: profile.id }, data: { confirmedBy: actor.actorId, confirmedAt: new Date() } });
      await tx.merchantAuditEvent.create({ data: { merchantId: scope.merchantId, actorType: actor.actorKind, actorId: actor.actorId!,
        action: "fiscal.profile_confirm", resourceType: "fiscal_profile", resourceId: profile.id,
        metadata: { provider: profile.provider, environment: scope.environment, version: profile.version, result: "confirmed" } } });
      return confirmed;
    });
  }
}

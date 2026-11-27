import { Prisma, type PrismaClient } from "@prisma/client";
import type { FiscalSnapshotCreate, FiscalSnapshotStore } from "../domain/fiscal-sale-snapshot.port.js";
import type { FiscalTenant } from "../domain/fiscal-repository.port.js";
import type { TenantContextService } from "../../../shared/tenant/tenant-context.service.js";

export class PrismaFiscalSnapshotRepository implements FiscalSnapshotStore {
  constructor(private readonly db: PrismaClient | Prisma.TransactionClient, private readonly tenants?: TenantContextService) {}
  find(scope: FiscalTenant, orderId: string) {
    const read = async () => await this.db.fiscalSaleSnapshot.findFirst({ where: { merchantId: scope.merchantId, environment: scope.environment, orderId } });
    return this.tenants ? this.tenants.run({ merchantId: scope.merchantId, userId: "fiscal-sale", role: "system" }, read) : read();
  }
  async persist(input: readonly FiscalSnapshotCreate[]) {
    const save = async (tx: Prisma.TransactionClient) => {
      const records = [];
      for (const value of input) {
        const persist = async () => {
          await tx.fiscalSaleSnapshot.createMany({ data: { ...value, recipient: value.recipient as Prisma.InputJsonValue,
            items: value.items as unknown as Prisma.InputJsonValue }, skipDuplicates: true });
          return tx.fiscalSaleSnapshot.findFirstOrThrow({ where: { merchantId: value.merchantId, environment: value.environment, orderId: value.orderId } });
        };
        records.push(await (this.tenants ? this.tenants.run({ merchantId: value.merchantId, userId: "fiscal-sale", role: "system" }, persist) : persist()));
      }
      return records;
    };
    return "$transaction" in this.db ? this.db.$transaction(save) : save(this.db);
  }
}

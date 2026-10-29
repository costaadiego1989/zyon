import { Injectable, Inject } from "@nestjs/common";
import { Prisma, type PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";
import { newId, type ShoppingRepository, type ShoppingState, type Workspace } from "../domain/shopping-agent.js";

@Injectable()
export class PrismaShoppingRepository implements ShoppingRepository {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}
  async find(globalUserId: string, merchantId: string): Promise<Workspace | null> {
    return await this.prisma.buyerShoppingWorkspace.findUnique({ where: { globalUserId_merchantId: { globalUserId, merchantId } } }) as Workspace | null;
  }
  async create(globalUserId: string, merchantId: string, state: ShoppingState): Promise<Workspace> {
    return await this.prisma.buyerShoppingWorkspace.upsert({ where: { globalUserId_merchantId: { globalUserId, merchantId } },
      create: { id: newId(), globalUserId, merchantId, state: state as unknown as Prisma.InputJsonValue, nextCheckAt: new Date() }, update: {} }) as unknown as Workspace;
  }
  async compareAndSwap(row: Workspace, state: ShoppingState, nextCheckAt: Date): Promise<boolean> {
    const result = await this.prisma.buyerShoppingWorkspace.updateMany({ where: { id: row.id, globalUserId: row.globalUserId, merchantId: row.merchantId, revision: row.revision },
      data: { state: state as unknown as Prisma.InputJsonValue, revision: { increment: 1 }, nextCheckAt } });
    return result.count === 1;
  }
  async claimDue(now: Date, leaseId: string, limit: number): Promise<Workspace[]> {
    const candidates = await this.prisma.buyerShoppingWorkspace.findMany({ where: { nextCheckAt: { lte: now }, OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] },
      orderBy: { nextCheckAt: "asc" }, take: limit, select: { id: true } });
    const claimed: Workspace[] = [];
    for (const candidate of candidates) {
      const result = await this.prisma.buyerShoppingWorkspace.updateMany({ where: { id: candidate.id, OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] },
        data: { leaseId, leaseUntil: new Date(now.getTime() + 300_000) } });
      if (result.count) {
        const row = await this.prisma.buyerShoppingWorkspace.findUnique({ where: { id: candidate.id } });
        if (row) claimed.push(row as unknown as Workspace);
      }
    }
    return claimed;
  }
  async release(id: string, leaseId: string): Promise<void> {
    await this.prisma.buyerShoppingWorkspace.updateMany({ where: { id, leaseId }, data: { leaseId: null, leaseUntil: null } });
  }
}

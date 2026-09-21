import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  CreateMerchantStoreResult,
  ManagedMerchantStore,
  MerchantStoreMembership,
  MerchantStoreRepository,
  MerchantStoreRole,
} from "../domain/ports/merchant-store.repository.port.js";

const MAX_STORES_PER_SCALE_ACCOUNT = 5;

export class PrismaMerchantStoreRepository implements MerchantStoreRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async resolveBillingAccountMerchantId(merchantId: string): Promise<string | undefined> {
    const merchant = await this.prisma.merchant.findUnique({
      where: { id: merchantId },
      select: { id: true, billingAccountMerchantId: true },
    });
    return merchant?.billingAccountMerchantId ?? merchant?.id;
  }

  async findMembership(userId: string, merchantId: string): Promise<MerchantStoreMembership | undefined> {
    const membership = await this.prisma.merchantTeamMember.findUnique({
      where: { merchantId_userId: { merchantId, userId } },
      select: { merchantId: true, role: true },
    });
    if (!membership) return undefined;
    const accountMerchantId = await this.resolveBillingAccountMerchantId(merchantId);
    if (!accountMerchantId) return undefined;
    return {
      merchantId: membership.merchantId,
      billingAccountMerchantId: accountMerchantId,
      role: membership.role.toLowerCase() as MerchantStoreRole,
    };
  }

  async listStores(accountMerchantId: string, userId: string): Promise<ManagedMerchantStore[]> {
    const memberships = await this.prisma.merchantTeamMember.findMany({
      where: { userId },
      select: { merchantId: true, role: true },
    });
    if (!memberships.length) return [];
    const stores = await this.prisma.merchant.findMany({
      where: {
        id: { in: memberships.map((membership) => membership.merchantId) },
        OR: [{ id: accountMerchantId }, { billingAccountMerchantId: accountMerchantId }],
      },
      select: { id: true, name: true, storeSlug: true },
      orderBy: { createdAt: "asc" },
    });
    const roles = new Map(memberships.map((membership) => [membership.merchantId, membership.role.toLowerCase() as MerchantStoreRole]));
    return stores.map((store) => ({
      id: store.id,
      name: store.name,
      slug: store.storeSlug ?? undefined,
      role: roles.get(store.id) ?? "staff",
    }));
  }

  async createStore(input: {
    accountMerchantId: string;
    actorUserId: string;
    name: string;
    slug: string;
  }): Promise<CreateMerchantStoreResult> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(async (transaction) => {
          await transaction.$queryRaw`SELECT id FROM merchants WHERE id = ${input.accountMerchantId} FOR UPDATE`;
          const count = await transaction.merchant.count({ where: { OR: [{ id: input.accountMerchantId }, { billingAccountMerchantId: input.accountMerchantId }] } });
          if (count >= MAX_STORES_PER_SCALE_ACCOUNT) return { status: "capacity_reached" };

          const existingSlug = await transaction.merchant.findUnique({
            where: { storeSlug: input.slug },
            select: { id: true },
          });
          if (existingSlug) return { status: "slug_taken" };

          const store = await transaction.merchant.create({
            data: {
              id: randomUUID(),
              name: input.name,
              storeSlug: input.slug,
              billingAccountMerchantId: input.accountMerchantId,
              plan: "BOTH",
              storeSettings: { created_from_multi_store: true },
            },
            select: { id: true, name: true, storeSlug: true },
          });
          await transaction.merchantTeamMember.create({
            data: { merchantId: store.id, userId: input.actorUserId, role: "OWNER" },
          });
          return {
            status: "created",
            store: { id: store.id, name: store.name, slug: store.storeSlug ?? undefined, role: "owner" },
          };
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          return { status: "slug_taken" };
        }
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034" && attempt < 2) continue;
        throw error;
      }
    }
    throw new Error("merchant_store_create_retry_exhausted");
  }
}

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
const MAX_SLUG_ALLOCATION_ATTEMPTS = 10_000;
const MAX_SLUG_LENGTH = 80;

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
    const billingAccountMerchantId = await this.resolveBillingAccountMerchantId(merchantId);
    if (!billingAccountMerchantId) return undefined;
    return {
      merchantId: membership.merchantId,
      billingAccountMerchantId,
      role: membership.role.toLowerCase() as MerchantStoreRole,
    };
  }

  async listStores(accountMerchantId: string, userId: string): Promise<ManagedMerchantStore[]> {
    const memberships = await this.prisma.merchantTeamMember.findMany({
      where: { userId }, select: { merchantId: true, role: true },
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
    return stores.map((store) => ({ id: store.id, name: store.name, slug: store.storeSlug ?? undefined, role: roles.get(store.id) ?? "staff" }));
  }

  async createStore(input: { accountMerchantId: string; actorUserId: string; name: string; slugBase: string }): Promise<CreateMerchantStoreResult> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        return await this.prisma.$transaction(async (transaction) => {
          await transaction.$queryRaw`SELECT id FROM merchants WHERE id = ${input.accountMerchantId} FOR UPDATE`;
          const count = await transaction.merchant.count({
            where: { OR: [{ id: input.accountMerchantId }, { billingAccountMerchantId: input.accountMerchantId }] },
          });
          if (count >= MAX_STORES_PER_SCALE_ACCOUNT) return { status: "capacity_reached" };

          const slug = await this.allocateSlug(transaction, input.slugBase);

          // Deliberately create only a new merchant identity and membership.
          // Payment connections, WhatsApp credentials, commerce, domains, theme,
          // catalog and any other integration remain absent until configured here.
          const store = await transaction.merchant.create({
            data: {
              id: randomUUID(),
              name: input.name,
              storeSlug: slug,
              billingAccountMerchantId: input.accountMerchantId,
              plan: "BOTH",
              storeSettings: { created_from_multi_store: true },
            },
            select: { id: true, name: true, storeSlug: true },
          });
          // This repository uses the account-scoped client: the membership must
          // belong to store.id, never be stamped with the previously active store.
          await transaction.merchantTeamMember.upsert({
            where: { merchantId_userId: { merchantId: store.id, userId: input.actorUserId } },
            create: { merchantId: store.id, userId: input.actorUserId, role: "OWNER" },
            update: { role: "OWNER" },
          });
          return { status: "created", store: { id: store.id, name: store.name, slug: store.storeSlug ?? undefined, role: "owner" } };
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error) {
        // Another Scale account can claim the public slug between the lookup
        // and insert. Retrying reserves the next suffix rather than failing.
        if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code) && attempt < 4) continue;
        throw error;
      }
    }
    throw new Error("merchant_store_create_retry_exhausted");
  }

  private async allocateSlug(transaction: Prisma.TransactionClient, base: string): Promise<string> {
    for (let ordinal = 1; ordinal <= MAX_SLUG_ALLOCATION_ATTEMPTS; ordinal += 1) {
      const suffix = ordinal === 1 ? "" : `-${ordinal}`;
      const candidate = `${base.slice(0, MAX_SLUG_LENGTH - suffix.length)}${suffix}`;
      const existing = await transaction.merchant.findUnique({ where: { storeSlug: candidate }, select: { id: true } });
      if (!existing) return candidate;
    }
    throw new Error("merchant_store_slug_allocation_exhausted");
  }
}

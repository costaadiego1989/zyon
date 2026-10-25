import type { PrismaClient } from "@prisma/client";
import { decryptPii, isPiiEncrypted } from "../../../shared/crypto/pii-cipher.service.js";
import {
  type BuyerAccountPort,
  type BuyerAccountExportRow,
  type BuyerAccountPurchaseStatRow,
  type BuyerAgentProfileExportRow,
  type BuyerPurchaseExportRow,
  type MerchantNameLookupRow,
} from "../domain/ports/buyer-account-port.js";

/**
 * Prisma adapter for the LGPD / data-export / data-deletion port.
 *
 * All `as unknown as` casts and Prisma `$transaction` plumbing live here so
 * that the application layer (use-cases) stays framework-free. The cast
 * shapes mirror the project schema as declared in
 * `apps/api/prisma/schema.prisma` (BuyerAccount, BuyerAddress,
 * BuyerConversation, BuyerAgentProfile, BuyerPurchaseRecord, Merchant).
 */
export class PrismaBuyerAccountLgpdRepository implements BuyerAccountPort {
  constructor(private readonly prisma: PrismaClient) {}

  async countAccountsByGlobalUserId(globalUserId: string): Promise<number> {
    const client = this.prisma as unknown as {
      buyerAccount: {
        count: (args: { where: { globalUserId: string } }) => Promise<number>;
      };
    };
    return client.buyerAccount.count({ where: { globalUserId } });
  }

  async cascadeDelete(input: { globalUserId: string }): Promise<void> {
    const tx = await this.prisma.$transaction(async (handle) => {
      // Cast only the transaction handle here, inside the adapter — never
      // leaks into the application layer.
      const t = handle as unknown as PrismaClient;
      const account = await (t.buyerAccount as unknown as {
        count: (args: { where: { globalUserId: string } }) => Promise<number>;
      }).count({ where: { globalUserId: input.globalUserId } });
      if (account === 0) throw new Error("buyer_account_not_found");

      // 1. Saved addresses
      await (t.buyerAddress as unknown as {
        deleteMany: (args: { where: { globalUserId: string } }) => Promise<unknown>;
      }).deleteMany({ where: { globalUserId: input.globalUserId } });

      // 2. Agent profile (M2M tokens, personality config)
      await (t.buyerAgentProfile as unknown as {
        deleteMany: (args: { where: { globalUserId: string } }) => Promise<unknown>;
      }).deleteMany({ where: { globalUserId: input.globalUserId } });

      // 3. Conversations + messages (chat history with agent)
      await (t.buyerConversation as unknown as {
        deleteMany: (args: { where: { globalUserId: string } }) => Promise<unknown>;
      }).deleteMany({ where: { globalUserId: input.globalUserId } });

      // 4. Purchase records: anonymize (keep totals/orders for merchant
      // analytics + legal obligation; null out buyer identity).
      await (t.buyerPurchaseRecord as unknown as {
        updateMany: (args: {
          where: { globalUserId: string };
          data: { globalUserId: null; merchantCustomerId: null };
        }) => Promise<unknown>;
      }).updateMany({
        where: { globalUserId: input.globalUserId },
        data: { globalUserId: null, merchantCustomerId: null },
      });

      // 5. Account row itself (must be last because of FK relations)
      await (t.buyerAccount as unknown as {
        delete: (args: { where: { globalUserId: string } }) => Promise<unknown>;
      }).delete({ where: { globalUserId: input.globalUserId } });
    });
    // Explicitly consume the transaction result so TS keeps the narrowing.
    void tx;
  }

  async findAccountForExport(globalUserId: string): Promise<BuyerAccountExportRow | null> {
    const row = await (this.prisma.buyerAccount as unknown as {
      findUnique: (args: {
        where: { globalUserId: string };
        select: Record<string, true>;
      }) => Promise<{
        globalUserId: string;
        email: string;
        displayName: string;
        phone: string | null;
        cpf: string | null;
        createdAt: Date;
      } | null>;
    }).findUnique({
      where: { globalUserId },
      select: {
        globalUserId: true,
        email: true,
        displayName: true,
        phone: true,
        cpf: true,
        createdAt: true,
      },
    });
    return row ? { ...row, phone: piiForExport(row.phone), cpf: piiForExport(row.cpf) } : null;
  }

  async findAgentForExport(globalUserId: string): Promise<BuyerAgentProfileExportRow | null> {
    const row = await (this.prisma.buyerAgentProfile as unknown as {
      findUnique: (args: {
        where: { globalUserId: string };
        select: Record<string, true>;
      }) => Promise<BuyerAgentProfileExportRow | null>;
    }).findUnique({
      where: { globalUserId },
      select: {
        name: true,
        personality: true,
        maxRounds: true,
        targetDiscountPercent: true,
        minimumAcceptableDiscountPercent: true,
        m2mEnabled: true,
      },
    });
    return row ? { ...row } : null;
  }

  async listPurchasesForExport(globalUserId: string): Promise<BuyerPurchaseExportRow[]> {
    const rows = await (this.prisma.buyerPurchaseRecord as unknown as {
      findMany: (args: {
        where: { globalUserId: string };
        select: Record<string, true>;
        orderBy: Record<string, "desc">;
      }) => Promise<BuyerPurchaseExportRow[]>;
    }).findMany({
      where: { globalUserId },
      select: {
        merchantId: true,
        orderId: true,
        totalAmount: true,
        currency: true,
        completedAt: true,
        items: true,
      },
      orderBy: { completedAt: "desc" },
    });
    return rows;
  }

  async listPurchaseStatsForBuyer(globalUserId: string): Promise<BuyerAccountPurchaseStatRow[]> {
    return (this.prisma.buyerPurchaseRecord as unknown as {
      findMany: (args: {
        where: { globalUserId: string };
        select: Record<string, true>;
      }) => Promise<BuyerAccountPurchaseStatRow[]>;
    }).findMany({
      where: { globalUserId },
      select: {
        merchantId: true,
        totalAmount: true,
        discountAmount: true,
      },
    });
  }

  async listMerchantNames(ids: string[]): Promise<MerchantNameLookupRow[]> {
    if (ids.length === 0) return [];
    return (this.prisma.merchant as unknown as {
      findMany: (args: {
        where: { id: { in: string[] } };
        select: Record<string, true>;
      }) => Promise<MerchantNameLookupRow[]>;
    }).findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    });
  }
}

function piiForExport(value: string | null): string | null {
  if (!value) return null;
  return isPiiEncrypted(value) ? decryptPii(value) : value;
}

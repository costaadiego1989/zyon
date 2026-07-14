import { Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { BUYER_ACCOUNT_PRISMA_CLIENT } from "../../buyer-account.tokens.js";

export interface DeleteBuyerAccountRequest {
  globalUserId: string;
}

export interface DeleteBuyerAccountResult {
  deleted: true;
  anonymizedPurchases: true;
}

/**
 * LGPD Art. 18 VI: deletion on request. Cascade-removes buyer PII while
 * preserving anonymized purchase records for merchant accounting/legal
 * obligations. Runs inside a Prisma $transaction so either everything
 * succeeds or nothing does (no half-deleted buyers).
 */
@Injectable()
export class DeleteBuyerAccountUseCase {
  constructor(@Inject(BUYER_ACCOUNT_PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async execute(input: DeleteBuyerAccountRequest): Promise<DeleteBuyerAccountResult> {
    if (!input || !input.globalUserId) {
      throw new Error("buyer_account_missing_global_user_id");
    }

    await this.prisma.$transaction(async (tx) => {
      const t = tx as unknown as PrismaClient;
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

    return { deleted: true, anonymizedPurchases: true };
  }
}
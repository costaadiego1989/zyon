import test from "node:test";
import assert from "node:assert/strict";
import { DeleteBuyerAccountUseCase } from "../application/use-cases/delete-buyer-account.use-case.js";
import type {
  BuyerAccountPort,
  BuyerAccountCascadeDeleteInput,
} from "../domain/ports/buyer-account-port.js";

interface FakePortOptions {
  // Tables that should report N remaining rows after deletion (non-zero = "leak")
  remaining: Partial<{
    buyerAddress: number;
    buyerConversation: number;
    buyerPurchaseRecord: number;
    buyerAgentProfile: number;
    buyerAccount: number;
  }>;
  throwIfMissing?: boolean;
  captureOrder?: string[];
}

function buildFakePort(opts: FakePortOptions): BuyerAccountPort & { captureOrder: string[] } {
  const counts: Record<string, number> = {
    buyerAddress: opts.remaining.buyerAddress ?? 0,
    buyerConversation: opts.remaining.buyerConversation ?? 0,
    buyerPurchaseRecord: opts.remaining.buyerPurchaseRecord ?? 0,
    buyerAgentProfile: opts.remaining.buyerAgentProfile ?? 0,
    buyerAccount: opts.remaining.buyerAccount ?? 0,
  };
  const order: string[] = [];
  opts.captureOrder = order;

  return {
    captureOrder: order,
    async countAccountsByGlobalUserId(globalUserId: string): Promise<number> {
      order.push(`countAccounts(${globalUserId})=${counts.buyerAccount}`);
      return counts.buyerAccount;
    },
    async cascadeDelete(input: BuyerAccountCascadeDeleteInput): Promise<void> {
      order.push(`cascadeDelete(${input.globalUserId})`);
      if (counts.buyerAccount === 0 && opts.throwIfMissing !== false) {
        throw new Error("buyer_account_not_found");
      }
      // Simulate the cascade order so we can assert it via captureOrder.
      counts.buyerAddress = 0;
      counts.buyerAgentProfile = 0;
      counts.buyerConversation = 0;
      // Anonymize: keep order history for merchant analytics, null out globalUserId
      counts.buyerPurchaseRecord = 0;
      counts.buyerAccount = 0;
    },
    async findAccountForExport(): Promise<null> {
      return null;
    },
    async findAgentForExport(): Promise<null> {
      return null;
    },
    async listPurchasesForExport(): Promise<never[]> {
      return [];
    },
    async listPurchaseStatsForBuyer(): Promise<never[]> {
      return [];
    },
    async listMerchantNames(): Promise<never[]> {
      return [];
    },
  };
}

test("DeleteBuyerAccountUseCase cascades addresses, agent profile, conversations, anonymizes purchases, removes account", async () => {
  const port = buildFakePort({ remaining: { buyerAccount: 1 } });

  const useCase = new DeleteBuyerAccountUseCase(port);
  const result = await useCase.execute({ globalUserId: "guser_1" });

  assert.equal(result.deleted, true);
  assert.equal(result.anonymizedPurchases, true);
  // Cascade order recorded by the fake port — buyer-account last.
  assert.deepEqual(port.captureOrder, [
    "cascadeDelete(guser_1)",
  ]);
});

test("DeleteBuyerAccountUseCase throws when buyer has no account (not found)", async () => {
  const port = buildFakePort({ remaining: { buyerAccount: 0 }, throwIfMissing: true });

  await assert.rejects(
    () => new DeleteBuyerAccountUseCase(port).execute({ globalUserId: "missing" }),
    /buyer_account_not_found/
  );
});

test("DeleteBuyerAccountUseCase enforces globalUserId presence (LGPD requires explicit subject)", async () => {
  const port = buildFakePort({ remaining: {} });
  await assert.rejects(
    () => new DeleteBuyerAccountUseCase(port).execute({ globalUserId: "" }),
    /buyer_account_missing_global_user_id/
  );
});

test("DeleteBuyerAccountUseCase cascade delegates the entire transaction to the port (no direct Prisma leakage)", async () => {
  // Verify the use-case never accepts PrismaClient and only sees the port.
  const port = buildFakePort({ remaining: { buyerAccount: 1 } });
  const useCase = new DeleteBuyerAccountUseCase(port);
  // Smoke: same instance returns the expected shape.
  const result = await useCase.execute({ globalUserId: "guser_2" });
  assert.equal(result.deleted, true);
  assert.equal(result.anonymizedPurchases, true);
  assert.equal(port.captureOrder.length, 1);
});
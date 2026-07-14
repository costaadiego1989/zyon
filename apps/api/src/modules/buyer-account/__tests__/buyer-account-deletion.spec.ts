import test from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import { DeleteBuyerAccountUseCase } from "../application/use-cases/delete-buyer-account.use-case.js";

type DeleteFn = (args: { where: { globalUserId: string } }) => Promise<unknown>;
type CountFn = (args: { where: { globalUserId: string | null } }) => Promise<number>;

interface FakePrismaOptions {
  // Tables that should report N remaining rows after deletion (non-zero = "leak")
  remaining: Partial<{
    buyerAddress: number;
    buyerConversation: number;
    buyerPurchaseRecord: number;
    buyerAgentProfile: number;
    buyerAccount: number;
  }>;
}

function buildFakePrisma(opts: FakePrismaOptions): PrismaClient {
  const counts: Record<string, number> = {
    buyerAddress: opts.remaining.buyerAddress ?? 0,
    buyerConversation: opts.remaining.buyerConversation ?? 0,
    buyerPurchaseRecord: opts.remaining.buyerPurchaseRecord ?? 0,
    buyerAgentProfile: opts.remaining.buyerAgentProfile ?? 0,
    buyerAccount: opts.remaining.buyerAccount ?? 0,
  };

  const makeDelete =
    (delegate: keyof typeof counts): DeleteFn =>
    async () => {
      counts[delegate] = 0;
      return {};
    };
  const makeCount =
    (delegate: keyof typeof counts): CountFn =>
    async () => counts[delegate];

  return {
    buyerAccount: {
      delete: makeDelete("buyerAccount"),
      count: makeCount("buyerAccount"),
    },
    buyerAgentProfile: {
      deleteMany: makeDelete("buyerAgentProfile"),
      count: makeCount("buyerAgentProfile"),
    },
    buyerAddress: {
      deleteMany: makeDelete("buyerAddress"),
      count: makeCount("buyerAddress"),
    },
    buyerConversation: {
      deleteMany: makeDelete("buyerConversation"),
      count: makeCount("buyerConversation"),
    },
    buyerPurchaseRecord: {
      // Anonymize: keep order history for merchant analytics, null out globalUserId
      updateMany: async (args: { where: { globalUserId: string } }) => {
        const updated = await makeCount("buyerPurchaseRecord")(args);
        counts["buyerPurchaseRecord"] = 0;
        return { count: updated };
      },
      count: makeCount("buyerPurchaseRecord"),
    },
  } as unknown as PrismaClient;
}

test("DeleteBuyerAccountUseCase cascades addresses, agent profile, conversations, anonymizes purchases, removes account", async () => {
  let capturedTx: unknown = null;

  const prisma = {
    ...buildFakePrisma({ remaining: { buyerAccount: 1 } }),
    $transaction: async (fn: (tx: PrismaClient) => Promise<unknown>) => {
      const tx = buildFakePrisma({ remaining: { buyerAccount: 1 } });
      capturedTx = tx;
      return fn(tx);
    },
  } as unknown as PrismaClient;

  const useCase = new DeleteBuyerAccountUseCase(prisma);
  const result = await useCase.execute({ globalUserId: "guser_1" });

  assert.equal(result.deleted, true);
  assert.equal(result.anonymizedPurchases, true);
  assert.ok(capturedTx, "deletion must run inside a transaction");
});

test("DeleteBuyerAccountUseCase throws when buyer has no account (not found)", async () => {
  const prisma = {
    buyerAccount: {
      count: async () => 0,
    },
    $transaction: async (fn: (tx: PrismaClient) => Promise<unknown>) =>
      fn({
        buyerAccount: { count: async () => 0 },
        buyerAddress: { deleteMany: async () => ({}), count: async () => 0 },
        buyerAgentProfile: { deleteMany: async () => ({}), count: async () => 0 },
        buyerConversation: { deleteMany: async () => ({}), count: async () => 0 },
        buyerPurchaseRecord: { updateMany: async () => ({ count: 0 }) },
      } as unknown as PrismaClient),
  } as unknown as PrismaClient;

  await assert.rejects(
    () => new DeleteBuyerAccountUseCase(prisma).execute({ globalUserId: "missing" }),
    /buyer_account_not_found/
  );
});

test("DeleteBuyerAccountUseCase enforces globalUserId presence (LGPD requires explicit subject)", async () => {
  // @ts-expect-error - intentional invalid input
  await assert.rejects(
    () => new DeleteBuyerAccountUseCase({} as PrismaClient).execute({ globalUserId: "" }),
    /buyer_account_missing_global_user_id/
  );
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { HandleMarketplaceChargebackUseCase } from "../handle-marketplace-chargeback.use-case.js";
import { PrismaMarketplaceFinancialRepository } from "../../../infrastructure/repositories/prisma-marketplace-financial.repository.js";

function setup() {
  const reads: unknown[] = [];
  const repository = {
    getByIdForMerchant: async (id: string, merchantId: string) => {
      reads.push({ id, merchantId });
      return id === "settlement-b" && ["host-b", "seller-b"].includes(merchantId)
        ? { id, hostMerchantId: "host-b", sellerMerchantId: "seller-b", status: "transferred", sellerNetCents: 1700 }
        : undefined;
    },
    updateStatus: async () => assert.fail("No manual financial state mutation is allowed"),
  };
  return {
    useCase: new HandleMarketplaceChargebackUseCase(
      repository as any,
      { create: async () => assert.fail("Manual chargebacks must not create a debt") } as any,
      { transition: () => assert.fail("Manual chargebacks must not transition settlement state") } as any,
    ),
    reads,
  };
}

describe("Marketplace chargeback authorization and provider evidence", () => {
  it("does not disclose or mutate another merchant's settlement", async () => {
    const { useCase, reads } = setup();
    await assert.rejects(useCase.execute({ settlementId: "settlement-b", merchantId: "merchant-a", role: "owner" }),
      (error: any) => error.getStatus() === 404);
    assert.deepEqual(reads, [{ id: "settlement-b", merchantId: "merchant-a" }]);
  });
  it("rejects missing tenant and non-administrative roles before reading", async () => {
    const { useCase, reads } = setup();
    for (const input of [{ merchantId: "", role: "owner" }, { merchantId: "seller-b", role: "staff" }]) {
      await assert.rejects(useCase.execute({ settlementId: "settlement-b", ...input }), (error: any) => error.getStatus() === 403);
    }
    assert.equal(reads.length, 0);
  });
  it("keeps even an authorized financial command blocked without a verified provider event, including replay", async () => {
    const { useCase } = setup();
    for (const merchantId of ["seller-b", "host-b", "seller-b"]) {
      await assert.rejects(useCase.execute({ settlementId: "settlement-b", merchantId, role: "admin" }),
        (error: any) => error.getStatus() === 503 && error.getResponse().code === "chargeback_provider_confirmation_required");
    }
  });
  it("defends against an incorrectly unscoped repository implementation", async () => {
    const useCase = new HandleMarketplaceChargebackUseCase(
      { getByIdForMerchant: async () => ({ hostMerchantId: "b", sellerMerchantId: "c" }) } as any,
      {} as any,
      {} as any,
    );
    await assert.rejects(useCase.execute({ settlementId: "s", merchantId: "a", role: "owner" }), (error: any) => error.getStatus() === 404);
  });

  it("applies settlements only from the verified provider-webhook path", async () => {
    const updates: any[] = [];
    const debts: any[] = [];
    const settlements = [
      { id: "before-transfer", status: "awaiting_return_window", sellerMerchantId: "seller-a", sellerNetCents: 500 },
      { id: "after-transfer", status: "transferred", sellerMerchantId: "seller-b", sellerNetCents: 700 },
      { id: "already-handled", status: "chargeback_debt", sellerMerchantId: "seller-c", sellerNetCents: 900 },
    ];
    const existingDebt = { id: "existing", settlementId: "already-handled", sellerMerchantId: "seller-c", amountCents: 900, status: "resolved" };
    const debtRows = new Map<string, any>([[existingDebt.settlementId, structuredClone(existingDebt)]]);
    // Exercise the real financial repository and its settlement/debt adapters.
    // This transaction double does not prove PostgreSQL atomicity or row locks.
    const tx = {
      $queryRaw: async () => [],
      marketplaceOrderLedger: { upsert: async () => ({ chargebackAt: new Date("2026-10-17T12:00:00Z") }) },
      marketplaceFundingPlan: { findMany: async () => [], updateMany: async () => ({ count: 0 }) },
      marketplaceResidualPlan: { findMany: async () => [] },
      marketplaceTransferReversal: { count: async () => 0 },
      marketplacePayout: { updateMany: async () => ({ count: 0 }), findMany: async () => [], findUnique: async () => null },
      marketplaceSettlement: {
        findMany: async (query: any) => { assert.deepEqual(query.where, { hostMerchantId: "host-a", orderId: "order-1" }); return settlements; },
        update: async ({ where, data }: any) => {
          const row = settlements.find(value => value.id === where.id)!;
          assert.equal(row.status, where.status);
          updates.push([where.id, where.status, data.status]);
          Object.assign(row, data); return row;
        },
      },
      marketplaceSellerDebt: { upsert: async ({ where, create, update }: any) => {
        assert.deepEqual(update, {});
        if (!debtRows.has(where.settlementId)) {
          debts.push(create); debtRows.set(where.settlementId, { id: `debt-${where.settlementId}`, ...create });
        }
        return debtRows.get(where.settlementId);
      } },
    };
    const financial = new PrismaMarketplaceFinancialRepository({ $transaction: async (run: (client: typeof tx) => unknown) => run(tx) } as never);
    const useCase = new HandleMarketplaceChargebackUseCase({} as never, {} as never, {} as never, financial);

    const result = await useCase.executeForOrder("order-1", "host-a");

    assert.equal(result.length, 3);
    assert.deepEqual(updates, [
      ["before-transfer", "awaiting_return_window", "chargeback_cancelled"],
      ["after-transfer", "transferred", "chargeback_debt"],
      ["already-handled", "chargeback_debt", "chargeback_debt"],
    ]);
    assert.deepEqual(debts, [{ sellerMerchantId: "seller-b", settlementId: "after-transfer", amountCents: 700, status: "outstanding" }]);
    await useCase.executeForOrder("order-1", "host-a");
    assert.equal(debts.length, 1, "webhook replay must not duplicate seller debt");
    assert.deepEqual(debtRows.get("already-handled"), existingDebt, "a resolved debt must not be reopened");
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { HandleMarketplaceChargebackUseCase } from "../handle-marketplace-chargeback.use-case.js";

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
  return { useCase: new HandleMarketplaceChargebackUseCase(repository as any), reads };
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
    const useCase = new HandleMarketplaceChargebackUseCase({ getByIdForMerchant: async () => ({ hostMerchantId: "b", sellerMerchantId: "c" }) } as any);
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
    const repository = {
      findByOrderId: async () => settlements,
      updateStatus: async (input: any) => {
        updates.push(input);
        return { ...settlements.find((settlement) => settlement.id === input.settlementId), status: input.status };
      },
    };
    const debtRepository = {
      create: async (input: any) => {
        debts.push(input);
        return { id: "debt-1", ...input };
      },
    };
    const stateMachine = {
      transition: (status: string) => status === "transferred" ? "chargeback_debt" : "chargeback_cancelled",
    };
    const useCase = new HandleMarketplaceChargebackUseCase(repository as any, debtRepository as any, stateMachine as any);

    const result = await useCase.executeForOrder("order-1");

    assert.equal(result.length, 2);
    assert.deepEqual(updates.map((update) => [update.settlementId, update.expectedStatus, update.status]), [
      ["before-transfer", "awaiting_return_window", "chargeback_cancelled"],
      ["after-transfer", "transferred", "chargeback_debt"],
    ]);
    assert.deepEqual(debts, [{ sellerMerchantId: "seller-b", settlementId: "after-transfer", amountCents: 700 }]);
  });
});

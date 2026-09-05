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
});

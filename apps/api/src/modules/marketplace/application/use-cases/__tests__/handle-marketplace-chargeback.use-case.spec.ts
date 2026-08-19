import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { HandleMarketplaceChargebackUseCase } from "../handle-marketplace-chargeback.use-case.js";
import { SettlementStateMachineService } from "../../../domain/services/settlement-state-machine.service.js";

describe("HandleMarketplaceChargebackUseCase", () => {
  const stateMachine = new SettlementStateMachineService();

  it("should throw when settlement not found", async () => {
    const mockSettlementRepo = {
      getById: async () => undefined,
    } as any;

    const useCase = new HandleMarketplaceChargebackUseCase(
      mockSettlementRepo,
      stateMachine,
    );

    await assert.rejects(
      () =>
        useCase.execute({
          settlementId: "s-1",
        }),
      { message: "Settlement not found" },
    );
  });

  it("should transition settlement to chargeback_debt", async () => {
    const settlement = {
      id: "s-1",
      status: "transferred" as const,
      sellerMerchantId: "m2",
      sellerNetCents: 1700,
    };
    const mockSettlementRepo = {
      getById: async () => settlement,
      updateStatus: async (input: any) => ({
        ...settlement,
        status: input.status,
      }),
    } as any;

    const useCase = new HandleMarketplaceChargebackUseCase(
      mockSettlementRepo,
      stateMachine,
    );

    const result = await useCase.execute({
      settlementId: "s-1",
    });

    assert.strictEqual(result.settlement.status, "chargeback_debt");
    assert.strictEqual(result.debtCreated, true);
  });
});

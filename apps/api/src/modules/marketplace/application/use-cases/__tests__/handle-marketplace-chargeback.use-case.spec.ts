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
    const mockDebtRepo = {} as any;

    const useCase = new HandleMarketplaceChargebackUseCase(
      mockSettlementRepo,
      mockDebtRepo,
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

  it("should transition awaiting_return_window → chargeback_cancelled", async () => {
    const settlement = {
      id: "s-1",
      status: "awaiting_return_window" as const,
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
    const mockDebtRepo = {} as any;

    const useCase = new HandleMarketplaceChargebackUseCase(
      mockSettlementRepo,
      mockDebtRepo,
      stateMachine,
    );

    const result = await useCase.execute({
      settlementId: "s-1",
    });

    assert.strictEqual(result.settlement.status, "chargeback_cancelled");
    assert.strictEqual(result.debtCreated, false);
    assert.strictEqual(result.debt, undefined);
  });

  it("should transition transfer_scheduled → chargeback_cancelled", async () => {
    const settlement = {
      id: "s-1",
      status: "transfer_scheduled" as const,
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
    const mockDebtRepo = {} as any;

    const useCase = new HandleMarketplaceChargebackUseCase(
      mockSettlementRepo,
      mockDebtRepo,
      stateMachine,
    );

    const result = await useCase.execute({
      settlementId: "s-1",
    });

    assert.strictEqual(result.settlement.status, "chargeback_cancelled");
    assert.strictEqual(result.debtCreated, false);
  });

  it("should transition transferred → chargeback_debt and create debt", async () => {
    const settlement = {
      id: "s-1",
      status: "transferred" as const,
      sellerMerchantId: "m2",
      sellerNetCents: 1700,
    };
    const debt = {
      id: "d-1",
      sellerMerchantId: "m2",
      settlementId: "s-1",
      amountCents: 1700,
      status: "outstanding",
      deductedFromSettlementId: null,
      createdAt: new Date(),
      resolvedAt: null,
    };
    const mockSettlementRepo = {
      getById: async () => settlement,
      updateStatus: async (input: any) => ({
        ...settlement,
        status: input.status,
      }),
    } as any;
    const mockDebtRepo = {
      create: async () => debt,
    } as any;

    const useCase = new HandleMarketplaceChargebackUseCase(
      mockSettlementRepo,
      mockDebtRepo,
      stateMachine,
    );

    const result = await useCase.execute({
      settlementId: "s-1",
    });

    assert.strictEqual(result.settlement.status, "chargeback_debt");
    assert.strictEqual(result.debtCreated, true);
    assert.strictEqual(result.debt?.id, "d-1");
    assert.strictEqual(result.debt?.amountCents, 1700);
  });

  it("should set chargebackAt timestamp", async () => {
    let capturedInput: any = null;
    const settlement = {
      id: "s-1",
      status: "transferred" as const,
      sellerMerchantId: "m2",
      sellerNetCents: 1700,
    };
    const mockSettlementRepo = {
      getById: async () => settlement,
      updateStatus: async (input: any) => {
        capturedInput = input;
        return { ...settlement, status: input.status };
      },
    } as any;
    const mockDebtRepo = {
      create: async () => ({}),
    } as any;

    const useCase = new HandleMarketplaceChargebackUseCase(
      mockSettlementRepo,
      mockDebtRepo,
      stateMachine,
    );

    await useCase.execute({ settlementId: "s-1" });

    assert.strictEqual(capturedInput.chargebackAt instanceof Date, true);
  });
});

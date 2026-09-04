import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ProcessScheduledTransfersUseCase } from "../process-scheduled-transfers.use-case.js";
import { SettlementStateMachineService } from "../../../domain/services/settlement-state-machine.service.js";

describe("ProcessScheduledTransfersUseCase", () => {
  const stateMachine = new SettlementStateMachineService();

  it("should process expired return windows (awaiting_return_window → transfer_scheduled)", async () => {
    const settlement = {
      id: "s-1",
      status: "awaiting_return_window" as const,
      sellerMerchantId: "m2",
      returnWindowUntil: new Date("2026-08-01"),
    };
    const mockSettlementRepo = {
      findExpiredReturnWindows: async () => [settlement],
      findDueTransfers: async () => [],
      updateStatus: async (input: any) => ({
        ...settlement,
        status: input.status,
      }),
    } as any;

    const useCase = new ProcessScheduledTransfersUseCase(
      mockSettlementRepo,
      stateMachine,
    );

    const result = await useCase.execute({
      nowDate: new Date("2026-08-02"),
    });

    assert.strictEqual(result.returnWindowsExpired, 1);
    assert.strictEqual(result.transfersExecuted, 0);
    assert.strictEqual(result.processed, 1);
  });

  it("should process due transfers (transfer_scheduled → transferred)", async () => {
    const settlement = {
      id: "s-1",
      status: "transfer_scheduled" as const,
      sellerMerchantId: "m2",
    };
    const mockSettlementRepo = {
      findExpiredReturnWindows: async () => [],
      findDueTransfers: async () => [settlement],
      updateStatus: async (input: any) => ({
        ...settlement,
        status: input.status,
      }),
    } as any;

    const useCase = new ProcessScheduledTransfersUseCase(
      mockSettlementRepo,
      stateMachine,
    );

    const result = await useCase.execute({
      nowDate: new Date(),
    });

    assert.strictEqual(result.returnWindowsExpired, 0);
    assert.strictEqual(result.transfersExecuted, 1);
    assert.strictEqual(result.processed, 1);
  });

  it("should handle both return window and transfer execution", async () => {
    const returnSettlement = {
      id: "s-1",
      status: "awaiting_return_window" as const,
      sellerMerchantId: "m2",
    };
    const transferSettlement = {
      id: "s-2",
      status: "transfer_scheduled" as const,
      sellerMerchantId: "m3",
    };
    const mockSettlementRepo = {
      findExpiredReturnWindows: async () => [returnSettlement],
      findDueTransfers: async () => [transferSettlement],
      updateStatus: async (input: any) => ({
        id: input.settlementId,
        status: input.status,
      }),
    } as any;

    const useCase = new ProcessScheduledTransfersUseCase(
      mockSettlementRepo,
      stateMachine,
    );

    const result = await useCase.execute({
      nowDate: new Date(),
    });

    assert.strictEqual(result.returnWindowsExpired, 1);
    assert.strictEqual(result.transfersExecuted, 1);
    assert.strictEqual(result.processed, 2);
  });

  it("should handle errors gracefully for return windows", async () => {
    const settlement = {
      id: "s-1",
      status: "awaiting_return_window" as const,
      sellerMerchantId: "m2",
    };
    const mockSettlementRepo = {
      findExpiredReturnWindows: async () => [settlement],
      findDueTransfers: async () => [],
      updateStatus: async () => {
        throw new Error("Database error");
      },
    } as any;

    const useCase = new ProcessScheduledTransfersUseCase(
      mockSettlementRepo,
      stateMachine,
    );

    const result = await useCase.execute({
      nowDate: new Date(),
    });

    assert.strictEqual(result.returnWindowsExpired, 0);
    assert.strictEqual(result.transfersExecuted, 0);
    assert.strictEqual(result.processed, 0);
  });

  it("should handle errors gracefully for transfers", async () => {
    const settlement = {
      id: "s-1",
      status: "transfer_scheduled" as const,
      sellerMerchantId: "m2",
    };
    const mockSettlementRepo = {
      findExpiredReturnWindows: async () => [],
      findDueTransfers: async () => [settlement],
      updateStatus: async () => {
        throw new Error("Database error");
      },
    } as any;

    const useCase = new ProcessScheduledTransfersUseCase(
      mockSettlementRepo,
      stateMachine,
    );

    const result = await useCase.execute({
      nowDate: new Date(),
    });

    assert.strictEqual(result.returnWindowsExpired, 0);
    assert.strictEqual(result.transfersExecuted, 0);
    assert.strictEqual(result.processed, 0);
  });

  it("should set transferredAt timestamp on transfer execution", async () => {
    let capturedInput: any = null;
    const settlement = {
      id: "s-1",
      status: "transfer_scheduled" as const,
      sellerMerchantId: "m2",
    };
    const mockSettlementRepo = {
      findExpiredReturnWindows: async () => [],
      findDueTransfers: async () => [settlement],
      updateStatus: async (input: any) => {
        capturedInput = input;
        return { ...settlement, status: input.status };
      },
    } as any;

    const useCase = new ProcessScheduledTransfersUseCase(
      mockSettlementRepo,
      stateMachine,
    );

    const beforeExecute = new Date();
    await useCase.execute({ nowDate: new Date() });
    const afterExecute = new Date();

    assert.strictEqual(capturedInput.status, "transferred");
    assert.strictEqual(capturedInput.transferredAt instanceof Date, true);
    assert(capturedInput.transferredAt >= beforeExecute);
    assert(capturedInput.transferredAt <= afterExecute);
  });
});

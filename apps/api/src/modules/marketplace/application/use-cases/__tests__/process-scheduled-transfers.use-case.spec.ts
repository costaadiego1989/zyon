import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ProcessScheduledTransfersUseCase } from "../process-scheduled-transfers.use-case.js";
import { SettlementStateMachineService } from "../../../domain/services/settlement-state-machine.service.js";

describe("ProcessScheduledTransfersUseCase", () => {
  const stateMachine = new SettlementStateMachineService();

  it("should process settlements due for transfer", async () => {
    const settlement = {
      id: "s-1",
      status: "transfer_scheduled" as const,
      sellerMerchantId: "m2",
    };
    const mockSettlementRepo = {
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

    assert.strictEqual(result.processed, 1);
  });

  it("should handle errors gracefully", async () => {
    const settlement = {
      id: "s-1",
      status: "transfer_scheduled" as const,
      sellerMerchantId: "m2",
    };
    const mockSettlementRepo = {
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

    assert.strictEqual(result.processed, 0);
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PlaceCrossStoreOrderUseCase } from "../place-cross-store-order.use-case.js";
import { SettlementStateMachineService } from "../../../domain/services/settlement-state-machine.service.js";

describe("PlaceCrossStoreOrderUseCase", () => {
  const stateMachine = new SettlementStateMachineService();

  it("should return empty settlements when marketplace disabled", async () => {
    const mockConfigRepo = {
      get: async () => ({ enabled: false } as any),
    };
    const mockOrderRepo = {} as any;
    const mockSettlementRepo = {} as any;

    const useCase = new PlaceCrossStoreOrderUseCase(
      mockOrderRepo,
      mockSettlementRepo,
      mockConfigRepo as any,
      stateMachine,
    );

    const result = await useCase.execute({
      checkoutSessionId: "cs-1",
      orderId: "ord-1",
      hostMerchantId: "m1",
    });

    assert.strictEqual(result.settlements.length, 0);
  });

  it("should create settlements for each line item", async () => {
    const mockConfigRepo = {
      get: async () => ({
        enabled: true,
        returnWindowDays: 7,
        payoutDelayDays: 14,
        chargebackWindowDays: 30,
      } as any),
    };
    const lineItems = [
      {
        id: "li-1",
        sellerMerchantId: "m2",
        quantity: 2,
        unitPriceCents: 1000,
        commissionCents: 300,
        sellerNetCents: 1700,
      },
    ];
    const mockOrderRepo = {
      findByCheckoutSessionId: async () => lineItems,
      updateOrderId: async () => ({}),
    } as any;
    const mockSettlementRepo = {
      create: async (input: any) => ({
        id: "s-1",
        ...input,
        status: "awaiting_return_window",
      }),
    } as any;

    const useCase = new PlaceCrossStoreOrderUseCase(
      mockOrderRepo,
      mockSettlementRepo,
      mockConfigRepo as any,
      stateMachine,
    );

    const result = await useCase.execute({
      checkoutSessionId: "cs-1",
      orderId: "ord-1",
      hostMerchantId: "m1",
    });

    assert.strictEqual(result.settlements.length, 1);
    const settlement = result.settlements[0]!;
    assert.equal(
      settlement.transferScheduledAt!.getTime() - settlement.returnWindowUntil.getTime(),
      14 * 24 * 60 * 60 * 1000,
    );
  });
});

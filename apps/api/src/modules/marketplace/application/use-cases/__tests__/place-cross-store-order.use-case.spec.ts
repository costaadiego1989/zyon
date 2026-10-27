import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PlaceCrossStoreOrderUseCase } from "../place-cross-store-order.use-case.js";
import { SettlementStateMachineService } from "../../../domain/services/settlement-state-machine.service.js";
import type { MarketplaceFinancialRepository, PlaceMarketplaceOrder } from "../../../domain/ports/marketplace-financial-repository.port.js";
import type { MarketplaceSettlementSnapshot } from "../../../domain/ports/marketplace-settlement-repository.port.js";

// Financial admission belongs to the transactional repository. No fallback to
// the former per-row settlement creation path is allowed at this boundary.
function placementFixture(placeOrder?: MarketplaceFinancialRepository["placeOrder"]) {
  let legacyCalls = 0;
  const legacy = () => { legacyCalls++; assert.fail("Legacy nontransactional placement must not be used"); };
  const financial: MarketplaceFinancialRepository | undefined = placeOrder ? {
    placeOrder,
    chargebackOrder: async () => assert.fail("Placement cannot create a chargeback"),
    registerReturn: async () => assert.fail("Placement cannot register a return"),
  } : undefined;
  return {
    useCase: new PlaceCrossStoreOrderUseCase(
      { findByCheckoutSessionId: legacy, updateOrderId: legacy } as never,
      { create: legacy } as never, { get: legacy } as never,
      new SettlementStateMachineService(), financial,
    ),
    legacyCalls: () => legacyCalls,
  };
}

describe("PlaceCrossStoreOrderUseCase", () => {
  const input: PlaceMarketplaceOrder = { checkoutSessionId: "cs-1", orderId: "provider_order_1", hostMerchantId: "host_1",
    purchasedAt: new Date("2026-10-01T12:00:00.000Z") };

  it("returns an empty admitted financial result without invoking legacy placement", async () => {
    const calls: PlaceMarketplaceOrder[] = [];
    const fixture = placementFixture(async received => { calls.push(received); return []; });
    assert.deepEqual(await fixture.useCase.execute(input), { settlements: [] });
    assert.deepEqual(calls, [input]);
    assert.equal(fixture.legacyCalls(), 0);
  });

  it("delegates the exact scope and preserves the repository's persisted settlements and windows", async () => {
    const calls: PlaceMarketplaceOrder[] = [];
    const settlements: MarketplaceSettlementSnapshot[] = [{
      id: "settlement_1", hostMerchantId: "host_1", sellerMerchantId: "seller_1", orderId: "provider_order_1", lineItemId: "line_1",
      totalAmountCents: 2000, commissionCents: 300, sellerNetCents: 1700, status: "awaiting_return_window",
      returnWindowUntil: new Date("2026-10-08T12:00:00.000Z"),
      transferScheduledAt: new Date("2026-10-22T12:00:00.000Z"),
      chargebackWindowUntil: new Date("2026-10-31T12:00:00.000Z"),
      transferredAt: null, finalizedAt: null, chargebackAt: null, returnAt: null, providerTransferId: null,
      createdAt: input.purchasedAt!, updatedAt: input.purchasedAt!,
    }];
    const fixture = placementFixture(async received => { calls.push(received); return settlements; });
    const result = await fixture.useCase.execute(input);
    assert.deepEqual(calls, [input]);
    assert.strictEqual(result.settlements, settlements);
    assert.strictEqual(result.settlements[0], settlements[0]);
    assert.equal(fixture.legacyCalls(), 0);
    // Window calculation is covered by the real state-machine tests. This
    // boundary must preserve admitted values rather than recalculating them.
  });

  it("fails closed when the transactional financial port is not wired", async () => {
    const fixture = placementFixture();
    await assert.rejects(() => fixture.useCase.execute(input), /marketplace_financial_repository_required/);
    assert.equal(fixture.legacyCalls(), 0);
  });

  it("propagates financial rejection without retry or legacy fallback", async () => {
    const rejection = new Error("synthetic_funding_rejected");
    let calls = 0;
    const fixture = placementFixture(async () => { calls++; throw rejection; });
    await assert.rejects(() => fixture.useCase.execute(input), error => error === rejection);
    assert.equal(calls, 1);
    assert.equal(fixture.legacyCalls(), 0);
  });

  it("keeps host, order and checkout scopes distinct across invocations", async () => {
    const calls: PlaceMarketplaceOrder[] = [];
    const fixture = placementFixture(async received => { calls.push({ ...received }); return []; });
    const other = { ...input, hostMerchantId: "host_2", orderId: "provider_order_2", checkoutSessionId: "cs-2" };
    await fixture.useCase.execute(input);
    await fixture.useCase.execute(other);
    assert.deepEqual(calls, [input, other]);
    assert.equal(fixture.legacyCalls(), 0);
  });
});

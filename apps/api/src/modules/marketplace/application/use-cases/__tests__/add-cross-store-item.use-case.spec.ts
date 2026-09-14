import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AddCrossStoreItemUseCase } from "../add-cross-store-item.use-case.js";
import { CommissionCalculatorService } from "../../../domain/services/commission-calculator.service.js";

describe("AddCrossStoreItemUseCase", () => {
  const commissionCalc = new CommissionCalculatorService();

  it("should throw when marketplace not enabled", async () => {
    const mockConfigRepo = {
      get: async () => ({ enabled: false } as any),
    };
    const mockProductRepo = { getById: async () => ({}) } as any;
    const mockOrderRepo = {} as any;

    const useCase = new AddCrossStoreItemUseCase(
      mockOrderRepo,
      mockConfigRepo as any,
      mockProductRepo,
      commissionCalc,
    );

    await assert.rejects(
      () =>
        useCase.execute({
          checkoutSessionId: "cs-1",
          hostMerchantId: "m1",
          sellerMerchantId: "m2",
          federatedProductId: "fp-1",
          quantity: 1,
          unitPriceCents: 1000,
        }),
      { message: "Marketplace not enabled for this merchant" },
    );
  });

  it("should throw when product not found", async () => {
    const mockConfigRepo = {
      get: async () => ({
        enabled: true,
        commissionRateBps: 1500,
        blockedMerchants: [],
      } as any),
    };
    const mockProductRepo = { getById: async () => undefined } as any;
    const mockOrderRepo = {} as any;

    const useCase = new AddCrossStoreItemUseCase(
      mockOrderRepo,
      mockConfigRepo as any,
      mockProductRepo,
      commissionCalc,
    );

    await assert.rejects(
      () =>
        useCase.execute({
          checkoutSessionId: "cs-1",
          hostMerchantId: "m1",
          sellerMerchantId: "m2",
          federatedProductId: "fp-1",
          quantity: 1,
          unitPriceCents: 1000,
        }),
      { message: "Product not found" },
    );
  });

  it("should throw when seller is blocked", async () => {
    const mockConfigRepo = {
      get: async () => ({
        enabled: true,
        commissionRateBps: 1500,
        blockedMerchants: ["m2"],
      } as any),
    };
    const mockProductRepo = {
      getById: async () => ({
        id: "fp-1",
        sourceMerchantId: "m2",
        stockAvailable: true,
        currency: "BRL",
        priceCents: 1000,
      }),
    } as any;
    const mockOrderRepo = {} as any;

    const useCase = new AddCrossStoreItemUseCase(
      mockOrderRepo,
      mockConfigRepo as any,
      mockProductRepo,
      commissionCalc,
    );

    await assert.rejects(
      () =>
        useCase.execute({
          checkoutSessionId: "cs-1",
          hostMerchantId: "m1",
          sellerMerchantId: "m2",
          federatedProductId: "fp-1",
          quantity: 1,
          unitPriceCents: 1000,
        }),
      { message: "Seller is blocked" },
    );
  });

  it("should create line item with commission", async () => {
    const mockConfigRepo = {
      get: async () => ({
        enabled: true,
        commissionRateBps: 1500,
        blockedMerchants: [],
      } as any),
    };
    const mockProductRepo = {
      getById: async () => ({
        id: "fp-1",
        sourceMerchantId: "m2",
        stockAvailable: true,
        currency: "BRL",
        priceCents: 1000,
      }),
    } as any;
    const created = {
      id: "li-1",
      commissionCents: 150,
      sellerNetCents: 850,
    };
    const mockOrderRepo = {
      create: async () => created,
    } as any;

    const useCase = new AddCrossStoreItemUseCase(
      mockOrderRepo,
      mockConfigRepo as any,
      mockProductRepo,
      commissionCalc,
    );

    const result = await useCase.execute({
      checkoutSessionId: "cs-1",
      hostMerchantId: "m1",
      sellerMerchantId: "m2",
      federatedProductId: "fp-1",
      quantity: 1,
      unitPriceCents: 1000,
    });

    assert.strictEqual(result.lineItem.id, "li-1");
  });
});

describe("cross-store authoritative catalog data", () => {
  const input = { checkoutSessionId: "cs-1", hostMerchantId: "host", sellerMerchantId: "seller", federatedProductId: "fp-1", quantity: 2, unitPriceCents: 1 };
  function setup(overrides = {}, sellerEnabled = true) {
    const writes: any[] = [];
    const useCase = new AddCrossStoreItemUseCase(
      { create: async (data: any) => { writes.push(data); return { id: "line", ...data }; } } as any,
      { get: async (id: string) => ({ enabled: id === "host" || sellerEnabled, blockedMerchants: [], commissionRateBps: id === "host" ? 1000 : 2000 }) } as any,
      { getById: async () => ({ sourceMerchantId: "seller", stockAvailable: true, currency: "BRL", priceCents: 5000, ...overrides }) } as any,
      new CommissionCalculatorService(),
    );
    return { useCase, writes };
  }
  it("uses server price and seller commission instead of caller values", async () => {
    const { useCase, writes } = setup();
    await useCase.execute(input);
    assert.equal(writes[0].unitPriceCents, 5000);
    assert.equal(writes[0].commissionRateBps, 2000);
    assert.equal(writes[0].commissionCents, 2000);
    assert.equal(writes[0].sellerNetCents, 8000);
  });
  it("rejects seller spoofing before persistence", async () => {
    const { useCase, writes } = setup();
    await assert.rejects(useCase.execute({ ...input, sellerMerchantId: "different" }), /Seller does not match/);
    assert.equal(writes.length, 0);
  });
  it("rejects unavailable stock, seller, currency, unsafe totals and quantities", async () => {
    for (const overrides of [{ stockAvailable: false }, { currency: "USD" }, { priceCents: Number.MAX_SAFE_INTEGER }]) {
      const { useCase, writes } = setup(overrides);
      await assert.rejects(useCase.execute(input));
      assert.equal(writes.length, 0);
    }
    const { useCase, writes } = setup();
    for (const quantity of [0, -1, 1.5, NaN, Number.MAX_SAFE_INTEGER + 1]) {
      await assert.rejects(useCase.execute({ ...input, quantity }));
    }
    assert.equal(writes.length, 0);
    await assert.rejects(setup({}, false).useCase.execute(input), /Seller is unavailable/);
  });
});

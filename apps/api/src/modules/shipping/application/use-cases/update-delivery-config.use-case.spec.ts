import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { UpdateDeliveryConfigUseCase } from "./update-delivery-config.use-case.js";
import type { OwnDeliveryConfig } from "../../domain/ports/own-delivery-config.port.js";

function validConfig(overrides: Partial<OwnDeliveryConfig> = {}): OwnDeliveryConfig {
  return {
    id: "own-delivery-merchant-1",
    merchantId: "merchant-1",
    enabled: true,
    mode: "flat",
    flatPriceCents: 800,
    freeAboveCents: 5_000,
    neighborhoods: null,
    radiusZones: null,
    estimatedValue: 60,
    estimatedUnit: "minutes",
    ...overrides,
  };
}

function setup(existingConfig: OwnDeliveryConfig | null = validConfig()) {
  const saved: OwnDeliveryConfig[] = [];
  const ownDeliveryRepo = {
    getByMerchantId: async () => existingConfig,
    save: async (config: OwnDeliveryConfig) => {
      saved.push(config);
      return config;
    },
  };
  const merchantRepo = {
    getById: async () => ({ id: "merchant-1" }),
  };

  return {
    useCase: new UpdateDeliveryConfigUseCase(ownDeliveryRepo as any, merchantRepo as any),
    saved,
  };
}

describe("UpdateDeliveryConfigUseCase validation", () => {
  it("rejects negative and fractional amounts before persisting", async () => {
    const cases = [
      { name: "negative flat price", ownDelivery: { enabled: true, mode: "flat" as const, flatPriceCents: -1 } },
      { name: "fractional flat price", ownDelivery: { enabled: true, mode: "flat" as const, flatPriceCents: 1.5 } },
      { name: "negative free-shipping threshold", ownDelivery: { enabled: true, freeAboveCents: -1 } },
      { name: "fractional free-shipping threshold", ownDelivery: { enabled: true, freeAboveCents: 12.5 } },
    ];

    for (const fixture of cases) {
      const { useCase, saved } = setup();

      await assert.rejects(
        useCase.execute({ merchantId: "merchant-1", ownDelivery: fixture.ownDelivery }),
        (error: any) => error.getStatus?.() === 400,
        fixture.name,
      );
      assert.equal(saved.length, 0, fixture.name);
    }
  });

  it("rejects blank, duplicate, negative, and fractional neighborhood pricing", async () => {
    const invalidNeighborhoods = [
      [{ name: "  ", priceCents: 500 }],
      [{ name: "Centro", priceCents: -1 }],
      [{ name: "Centro", priceCents: 100.5 }],
      [{ name: "Centro", priceCents: 500 }, { name: " centro ", priceCents: 700 }],
    ];

    for (const neighborhoods of invalidNeighborhoods) {
      const { useCase, saved } = setup();

      await assert.rejects(
        useCase.execute({
          merchantId: "merchant-1",
          ownDelivery: { enabled: true, mode: "neighborhood", neighborhoods },
        }),
        (error: any) => error.getStatus?.() === 400,
      );
      assert.equal(saved.length, 0);
    }
  });

  it("clears the free-shipping threshold when null is submitted", async () => {
    const { useCase, saved } = setup();

    await useCase.execute({
      merchantId: "merchant-1",
      ownDelivery: { enabled: true, freeAboveCents: null },
    });

    assert.equal(saved.length, 1);
    assert.equal(saved[0]?.freeAboveCents, null);
  });

  it("normalizes valid neighborhood names before persisting", async () => {
    const { useCase, saved } = setup();

    await useCase.execute({
      merchantId: "merchant-1",
      ownDelivery: {
        enabled: true,
        mode: "neighborhood",
        neighborhoods: [{ name: "  Centro  ", priceCents: 500 }],
      },
    });

    assert.deepEqual(saved[0]?.neighborhoods, [{ name: "Centro", priceCents: 500 }]);
  });

  it("rejects non-boolean delivery flags before persisting", async () => {
    const { useCase, saved } = setup();

    await assert.rejects(
      useCase.execute({ merchantId: "merchant-1", ownDelivery: { enabled: "false" as any } }),
      (error: any) => error.getStatus?.() === 400,
    );
    assert.equal(saved.length, 0);
  });

  it("rejects duplicate and multiple open-ended radius tiers", async () => {
    for (const radiusZones of [
      [{ maxKm: 5, priceCents: 500 }, { maxKm: 5, priceCents: 700 }],
      [{ maxKm: null, priceCents: 500 }, { maxKm: null, priceCents: 700 }],
    ]) {
      const { useCase, saved } = setup();
      await assert.rejects(
        useCase.execute({ merchantId: "merchant-1", ownDelivery: { enabled: true, mode: "radius", radiusZones } }),
        (error: any) => error.getStatus?.() === 400,
      );
      assert.equal(saved.length, 0);
    }
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ConflictException, NotFoundException } from "@nestjs/common";
import { ReserveStockUseCase } from "./reserve-stock.use-case.js";
import type {
  ReserveStockInput,
  ReserveStockResult,
  StockRepositoryPort,
} from "../../domain/ports/product-repository.port.js";

function makePortDouble(overrides: Partial<StockRepositoryPort> = {}): StockRepositoryPort {
  return {
    reserve: async (input): Promise<ReserveStockResult> => ({
      reservationId: `res_${input.variantId}`,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    }),
    confirm: async () => undefined,
    releaseExpired: async () => 0,
    getAvailableStock: async () => ({ quantity: 0, reserved: 0 }),
    decrementBySku: async () => ({ ok: true, quantity: 0 }),
    getStockBySku: async () => null,
    setQuantityBySku: async () => ({ ok: true }),
    ...overrides,
  };
}

const baseInput: ReserveStockInput = {
  merchantId: "mrc_1",
  variantId: "var_1",
  quantity: 2,
  idempotencyKey: "cart_abc",
};

describe("ReserveStockUseCase", () => {
  it("delegates to stockRepo.reserve on happy path", async () => {
    let captured: ReserveStockInput | undefined;
    const repo = makePortDouble({
      reserve: async (input) => {
        captured = input;
        return { reservationId: "res_x", expiresAt: new Date() };
      },
    });
    const useCase = new ReserveStockUseCase(repo);

    const result = await useCase.execute(baseInput);

    assert.ok(captured, "reserve should be invoked");
    assert.equal(captured?.variantId, "var_1");
    assert.equal(captured?.quantity, 2);
    assert.equal(result.reservationId, "res_x");
  });

  it("rejects non-positive quantity before calling repo", async () => {
    let called = false;
    const repo = makePortDouble({
      reserve: async () => {
        called = true;
        return { reservationId: "x", expiresAt: new Date() };
      },
    });
    const useCase = new ReserveStockUseCase(repo);

    await assert.rejects(
      () => useCase.execute({ ...baseInput, quantity: 0 }),
      (err: unknown) => err instanceof ConflictException && err.message === "quantity_must_be_positive",
    );
    assert.equal(called, false, "repo should not be invoked for invalid quantity");
  });

  it("maps insufficient_stock repository error to ConflictException", async () => {
    const repo = makePortDouble({
      reserve: async () => {
        throw new Error("insufficient_stock");
      },
    });
    const useCase = new ReserveStockUseCase(repo);

    await assert.rejects(
      () => useCase.execute(baseInput),
      (err: unknown) => err instanceof ConflictException && err.message === "insufficient_stock",
    );
  });

  it("maps absent or foreign stock to variant_not_found 404", async () => {
    const repo = makePortDouble({
      reserve: async () => {
        throw new Error("stock_not_found");
      },
    });
    const useCase = new ReserveStockUseCase(repo);

    await assert.rejects(
      () => useCase.execute(baseInput),
      (err: unknown) => err instanceof NotFoundException && err.message === "variant_not_found",
    );
  });

  it("rethrows unexpected repository errors unchanged", async () => {
    const repo = makePortDouble({
      reserve: async () => {
        throw new Error("boom");
      },
    });
    const useCase = new ReserveStockUseCase(repo);

    await assert.rejects(
      () => useCase.execute(baseInput),
      (err: unknown) => err instanceof Error && err.message === "boom",
    );
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { ConfirmStockUseCase } from "./confirm-stock.use-case.js";
import type { StockRepositoryPort } from "../../domain/ports/product-repository.port.js";

function makePortDouble(overrides: Partial<StockRepositoryPort> = {}): StockRepositoryPort {
  return {
    reserve: async () => ({ reservationId: "res_1", expiresAt: new Date() }),
    confirm: async () => undefined,
    releaseExpired: async () => 0,
    getAvailableStock: async () => ({ quantity: 0, reserved: 0 }),
    decrementBySku: async () => ({ ok: true, quantity: 0 }),
    getStockBySku: async () => null,
    setQuantityBySku: async () => ({ ok: true }),
    ...overrides,
  };
}

describe("ConfirmStockUseCase", () => {
  it("invokes stockRepo.confirm with merchantId and reservationId", async () => {
    let captured: { merchantId: string; reservationId: string } | null = null;
    const repo = makePortDouble({
      confirm: async (merchantId, reservationId) => {
        captured = { merchantId, reservationId };
      },
    });
    const useCase = new ConfirmStockUseCase(repo);

    await useCase.execute("mrc_1", "res_42");

    assert.deepEqual(captured, { merchantId: "mrc_1", reservationId: "res_42" });
  });

  it("maps absent or foreign reservation to 404", async () => {
    const repo = makePortDouble({
      confirm: async () => {
        throw new Error("reservation_not_found");
      },
    });
    const useCase = new ConfirmStockUseCase(repo);

    await assert.rejects(
      () => useCase.execute("mrc_1", "res_x"),
      (err: unknown) => err instanceof NotFoundException && err.message === "reservation_not_found",
    );
  });

  it("maps forbidden to ForbiddenException", async () => {
    const repo = makePortDouble({
      confirm: async () => {
        throw new Error("forbidden");
      },
    });
    const useCase = new ConfirmStockUseCase(repo);

    await assert.rejects(
      () => useCase.execute("mrc_1", "res_x"),
      (err: unknown) => err instanceof ForbiddenException && err.message === "reservation_not_owned",
    );
  });

  it("maps reservation_not_active to ConflictException", async () => {
    const repo = makePortDouble({
      confirm: async () => {
        throw new Error("reservation_not_active");
      },
    });
    const useCase = new ConfirmStockUseCase(repo);

    await assert.rejects(
      () => useCase.execute("mrc_1", "res_x"),
      (err: unknown) => err instanceof ConflictException && err.message === "reservation_not_active",
    );
  });

  it("rethrows unexpected errors unchanged", async () => {
    const repo = makePortDouble({
      confirm: async () => {
        throw new Error("unexpected_db_failure");
      },
    });
    const useCase = new ConfirmStockUseCase(repo);

    await assert.rejects(
      () => useCase.execute("mrc_1", "res_x"),
      (err: unknown) => err instanceof Error && err.message === "unexpected_db_failure",
    );
  });
});

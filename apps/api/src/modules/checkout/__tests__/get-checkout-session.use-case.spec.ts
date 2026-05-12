import test from "node:test";
import assert from "node:assert/strict";
import { NotFoundException } from "@nestjs/common";
import { checkoutSession } from "./checkout-test-fixtures.js";
import { InMemoryCheckoutRepository } from "../infrastructure/repositories/in-memory-checkout.repository.js";
import { GetCheckoutSessionUseCase } from "../application/use-cases/get-checkout-session.use-case.js";

test("GetCheckoutSessionUseCase returns only tenant-scoped sessions", async () => {
  const repository = new InMemoryCheckoutRepository();
  repository.saveSession(checkoutSession({ merchantId: "mrc_1", sessionId: "chk_1" }));
  const useCase = new GetCheckoutSessionUseCase(repository);

  assert.equal((await useCase.execute("mrc_1", "chk_1")).sessionId, "chk_1");
  await assert.rejects(() => useCase.execute("mrc_2", "chk_1"), NotFoundException);
});

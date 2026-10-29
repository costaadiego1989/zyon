import test from "node:test";
import assert from "node:assert/strict";
import { ListRecoveryAttemptsUseCase } from "../application/use-cases/list-recovery-attempts.use-case.js";
import { InMemoryRecoveryAttemptRepository } from "../infrastructure/repositories/in-memory-recovery-attempt.repository.js";
import { RecoveryAttempt } from "../domain/entities/recovery-attempt.entity.js";

function attempt(id: string, merchantId: string, status: "pending" | "sent" | "recovered", createdAt: string) {
  return new RecoveryAttempt({
    id, merchantId, sessionId: `session-${id}`, globalUserId: `buyer-${id}`,
    abandonmentReason: "price", abandonmentScore: 0.8,
    strategy: { type: "offer_coupon", coupon_code: "SAVE", coupon_percent: 10 },
    channel: "email", status, sentAt: null, recoveredAt: null, recoveredOrderId: null,
    createdAt: new Date(createdAt),
  });
}

test("lists only the authenticated merchant attempts with status and bounded pagination", async () => {
  const repo = new InMemoryRecoveryAttemptRepository();
  await repo.save(attempt("old", "merchant-a", "pending", "2026-09-01T00:00:00.000Z"));
  await repo.save(attempt("new", "merchant-a", "sent", "2026-09-02T00:00:00.000Z"));
  await repo.save(attempt("other", "merchant-b", "recovered", "2026-09-03T00:00:00.000Z"));
  const useCase = new ListRecoveryAttemptsUseCase(repo);

  const sent = await useCase.execute({ merchantId: "merchant-a", status: "sent", limit: 999, offset: -4 });
  assert.deepEqual(sent.map((item) => item.id), ["new"]);

  const page = await useCase.execute({ merchantId: "merchant-a", limit: 1, offset: 1 });
  assert.deepEqual(page.map((item) => item.id), ["old"]);
});

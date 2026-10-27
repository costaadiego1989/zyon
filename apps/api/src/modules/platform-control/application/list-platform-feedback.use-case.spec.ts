import assert from "node:assert/strict";
import test from "node:test";
import { ListPlatformFeedbackUseCase } from "./list-platform-feedback.use-case.js";
import type {
  ChangePlatformFeedbackTreatment,
  PlatformFeedbackPage,
  PlatformFeedbackQuery,
  PlatformFeedbackReadAudit,
  PlatformFeedbackRepository,
} from "../domain/ports/platform-feedback-repository.port.js";
import type { PlatformFeedback } from "../domain/platform-feedback.js";

test("records an operator audit event before returning the feedback queue", async () => {
  const repository = new InMemoryPlatformFeedbackRepository();
  const useCase = new ListPlatformFeedbackUseCase(repository);

  const page = await useCase.execute(
    { limit: "25", status: "planned", category: "suggestion" },
    auditContext(),
  );

  assert.equal(page.items.length, 1);
  assert.deepEqual(repository.query, {
    cursor: undefined,
    limit: 25,
    status: "planned",
    category: "suggestion",
  });
  assert.deepEqual(repository.readAudit, {
    ...auditContext(),
    action: "feedback.queue.read",
    targetType: "platform_feedback_queue",
    details: { itemCount: 1, limit: 25, status: "planned", category: "suggestion" },
  });
});

test("records the feedback target for a successful detail read", async () => {
  const repository = new InMemoryPlatformFeedbackRepository();
  const useCase = new ListPlatformFeedbackUseCase(repository);

  await useCase.findById(" feedback_1 ", auditContext());

  assert.deepEqual(repository.readAudit, {
    ...auditContext(),
    action: "feedback.detail.read",
    targetType: "merchant_platform_feedback",
    targetId: "feedback_1",
  });
});

test("does not return a feedback queue if its audit event cannot be persisted", async () => {
  const repository = new InMemoryPlatformFeedbackRepository();
  repository.auditFailure = new Error("audit_unavailable");
  const useCase = new ListPlatformFeedbackUseCase(repository);

  await assert.rejects(
    () => useCase.execute({}, auditContext()),
    /audit_unavailable/,
  );
});

class InMemoryPlatformFeedbackRepository implements PlatformFeedbackRepository {
  query?: PlatformFeedbackQuery;
  readAudit?: PlatformFeedbackReadAudit;
  auditFailure?: Error;

  async list(input: PlatformFeedbackQuery): Promise<PlatformFeedbackPage> {
    this.query = input;
    return { items: [feedback("feedback_1")] };
  }

  async findById(id: string): Promise<PlatformFeedback | undefined> {
    return feedback(id);
  }

  async recordRead(input: PlatformFeedbackReadAudit): Promise<void> {
    if (this.auditFailure) throw this.auditFailure;
    this.readAudit = input;
  }

  async changeTreatment(_input: ChangePlatformFeedbackTreatment): Promise<PlatformFeedback> {
    return feedback("feedback_1");
  }
}

function auditContext() {
  return {
    actorOperatorId: "operator_1",
    correlationId: "corr_1",
    environment: "test",
  };
}

function feedback(id: string): PlatformFeedback {
  return {
    id,
    merchantId: "merchant_1",
    authorUserId: "user_1",
    category: "suggestion",
    message: "Feedback",
    createdAt: new Date("2026-09-15T00:00:00.000Z"),
    treatment: { status: "new", priority: "normal" },
  };
}


import assert from "node:assert/strict";
import test from "node:test";
import { ChangePlatformFeedbackTreatmentUseCase } from "./change-platform-feedback-treatment.use-case.js";
import type {
  ChangePlatformFeedbackTreatment,
  PlatformFeedbackPage,
  PlatformFeedbackQuery,
  PlatformFeedbackRepository,
} from "../domain/ports/platform-feedback-repository.port.js";
import type { PlatformFeedback } from "../domain/platform-feedback.js";

test("allows a platform administrator to assign feedback and preserves the audit context for the transaction", async () => {
  const repository = new InMemoryPlatformFeedbackRepository();
  const useCase = new ChangePlatformFeedbackTreatmentUseCase(repository);

  await useCase.execute({
    feedbackId: "feedback_1",
    actorOperatorId: "operator_1",
    actorRole: "platform_admin",
    status: "in_progress",
    priority: "high",
    assignedOperatorId: "operator_2",
    note: " Investigating the storefront flow. ",
    correlationId: "corr_1",
    environment: "test",
  });

  assert.deepEqual(repository.command, {
    feedbackId: "feedback_1",
    actorOperatorId: "operator_1",
    status: "in_progress",
    priority: "high",
    assignedOperatorId: "operator_2",
    note: "Investigating the storefront flow.",
    correlationId: "corr_1",
    environment: "test",
  });
});

test("does not allow support to assign feedback to a different operator", async () => {
  const repository = new InMemoryPlatformFeedbackRepository();
  const useCase = new ChangePlatformFeedbackTreatmentUseCase(repository);

  await assert.rejects(() => useCase.execute({
    feedbackId: "feedback_1",
    actorOperatorId: "operator_1",
    actorRole: "support_ops",
    assignedOperatorId: "operator_2",
    correlationId: "corr_1",
    environment: "test",
  }), /platform_feedback_assignee_not_permitted/);
  assert.equal(repository.command, undefined);
});

test("allows a support operator to remove an existing assignee without changing another field", async () => {
  const repository = new InMemoryPlatformFeedbackRepository();
  const useCase = new ChangePlatformFeedbackTreatmentUseCase(repository);

  await useCase.execute({
    feedbackId: "feedback_1",
    actorOperatorId: "operator_1",
    actorRole: "support_ops",
    assignedOperatorId: null,
    correlationId: "corr_2",
    environment: "test",
  });

  assert.deepEqual(repository.command, {
    feedbackId: "feedback_1",
    actorOperatorId: "operator_1",
    assignedOperatorId: null,
    correlationId: "corr_2",
    environment: "test",
  });
});

test("rejects feedback treatment calls that do not change state or add a note", async () => {
  const useCase = new ChangePlatformFeedbackTreatmentUseCase(new InMemoryPlatformFeedbackRepository());
  await assert.rejects(() => useCase.execute({
    feedbackId: "feedback_1",
    actorOperatorId: "operator_1",
    actorRole: "support_ops",
    correlationId: "corr_1",
    environment: "test",
  }), /platform_feedback_empty_treatment/);
});

class InMemoryPlatformFeedbackRepository implements PlatformFeedbackRepository {
  command?: ChangePlatformFeedbackTreatment;

  async list(_input: PlatformFeedbackQuery): Promise<PlatformFeedbackPage> {
    return { items: [] };
  }

  async findById(): Promise<PlatformFeedback | undefined> {
    return undefined;
  }

  async recordRead(): Promise<void> {}

  async changeTreatment(input: ChangePlatformFeedbackTreatment): Promise<PlatformFeedback> {
    this.command = input;
    return feedback(input.feedbackId);
  }
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

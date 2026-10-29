
import { Inject, Injectable } from "@nestjs/common";
import {
  isPlatformFeedbackPriority,
  isPlatformFeedbackStatus,
  type PlatformFeedbackPriority,
  type PlatformFeedbackStatus,
} from "../domain/platform-feedback.js";
import {
  isPlatformOperatorRole,
  type PlatformOperatorRole,
} from "../domain/platform-operator.js";
import {
  PLATFORM_FEEDBACK_REPOSITORY,
  type PlatformFeedbackRepository,
} from "../domain/ports/platform-feedback-repository.port.js";

@Injectable()
export class ChangePlatformFeedbackTreatmentUseCase {
  constructor(
    @Inject(PLATFORM_FEEDBACK_REPOSITORY) private readonly feedback: PlatformFeedbackRepository,
  ) {}

  async execute(input: {
    feedbackId: string;
    actorOperatorId: string;
    actorRole: unknown;
    status?: unknown;
    priority?: unknown;
    assignedOperatorId?: unknown;
    note?: unknown;
    correlationId: string;
    environment: string;
  }) {
    const command = normalizeCommand(input);
    return this.feedback.changeTreatment(command);
  }
}

function normalizeCommand(input: {
  feedbackId: string;
  actorOperatorId: string;
  actorRole: unknown;
  status?: unknown;
  priority?: unknown;
  assignedOperatorId?: unknown;
  note?: unknown;
  correlationId: string;
  environment: string;
}) {
  const actorOperatorId = requiredText(input.actorOperatorId, "platform_operator_id");
  const actorRole = requiredRole(input.actorRole);
  const status = optionalStatus(input.status);
  const priority = optionalPriority(input.priority);
  const assignedOperatorId = optionalOperator(input.assignedOperatorId);
  const note = optionalNote(input.note);
  if (assignedOperatorId && assignedOperatorId !== actorOperatorId && actorRole !== "platform_admin") {
    throw new Error("platform_feedback_assignee_not_permitted");
  }
  if (status === undefined && priority === undefined && assignedOperatorId === undefined && note === undefined) {
    throw new Error("platform_feedback_empty_treatment");
  }
  return {
    feedbackId: requiredText(input.feedbackId, "platform_feedback_id"),
    actorOperatorId,
    ...(status ? { status } : {}),
    ...(priority ? { priority } : {}),
    ...(assignedOperatorId !== undefined ? { assignedOperatorId } : {}),
    ...(note ? { note } : {}),
    correlationId: requiredText(input.correlationId, "platform_correlation_id"),
    environment: requiredText(input.environment, "platform_environment"),
  };
}

function requiredRole(value: unknown): PlatformOperatorRole {
  if (typeof value !== "string" || !isPlatformOperatorRole(value)) throw new Error("platform_operator_role");
  return value;
}

function optionalStatus(value: unknown): PlatformFeedbackStatus | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !isPlatformFeedbackStatus(value)) throw new Error("platform_feedback_invalid_status");
  return value;
}

function optionalPriority(value: unknown): PlatformFeedbackPriority | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !isPlatformFeedbackPriority(value)) throw new Error("platform_feedback_invalid_priority");
  return value;
}

function optionalOperator(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return requiredTextType(value, "platform_feedback_invalid_assignee");
}

function optionalNote(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const note = requiredTextType(value, "platform_feedback_invalid_note");
  if (note.length > 4_000) throw new Error("platform_feedback_note_too_long");
  return note;
}

function requiredText(value: string, code: string): string {
  return requiredTextType(value, code);
}

function requiredTextType(value: unknown, code: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(code);
  return value.trim();
}
